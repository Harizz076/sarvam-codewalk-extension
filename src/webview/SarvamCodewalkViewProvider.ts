import { randomUUID } from "crypto";
import * as path from "path";
import * as vscode from "vscode";
import type { GeneratedLesson, LearningSession, PanelModel, WebviewMessage } from "../domain/types";
import { type AudioRecorder, AudioRecorderError, type RecordedAudio } from "../services/AudioRecorder";
import { CodexRunner } from "../services/CodexRunner";
import { LessonService } from "../services/LessonService";
import { LocalHistoryStore } from "../services/LocalHistoryStore";
import { SarvamSttError, SarvamSttService } from "../services/SarvamService";
import { buildSpokenResponse } from "../services/SpokenResponse";
import { TranslationError, TranslationService } from "../services/TranslationService";
import { TtsError, TtsService } from "../services/TtsService";
import { getWebviewHtml } from "./html";

export const VIEW_ID = "sarvam-codewalk.learningPanel";
const MAX_RECORDING_MS = 25_000;
const SPEECH_REQUEST_TIMEOUT_MS = 25_000;

export class SarvamCodewalkViewProvider implements vscode.WebviewViewProvider {
  private view: vscode.WebviewView | undefined;
  private model = this.createInitialModel();
  private recordingTimer: ReturnType<typeof setTimeout> | undefined;
  private cleanupBlocked = false;
  private currentSessionId: string | undefined;
  private cachedAudio: string | undefined;
  private lastRunWorkspacePath: string | undefined;
  private continuationContext: string | undefined;
  private inputLanguageCode = "en-IN";

  public constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly history: LocalHistoryStore,
    private readonly recorder: AudioRecorder,
    private readonly stt: SarvamSttService,
    private readonly translator: TranslationService,
    private readonly hasSarvamApiKey: () => Promise<boolean>,
    private readonly codex: CodexRunner,
    private readonly lessons: LessonService,
    private readonly tts: TtsService,
  ) {}

  public resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    webviewView.webview.options = { enableScripts: true, localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, "media")] };
    webviewView.webview.html = getWebviewHtml(webviewView.webview, this.extensionUri);
    webviewView.onDidChangeVisibility(() => {
      if (!webviewView.visible) {
        this.cachedAudio = undefined;
        void webviewView.webview.postMessage({ type: "disposeAudio" });
      }
    });
    webviewView.onDidDispose(() => { this.view = undefined; this.clearRecordingTimer(); this.cachedAudio = undefined; void this.cancelRecording(); });
    webviewView.webview.onDidReceiveMessage((message: unknown) => { void this.handleMessage(message); });
  }

  public async dispose(): Promise<void> { this.clearRecordingTimer(); this.cachedAudio = undefined; await this.cancelRecording(); }

  public refreshEditorContext(): void {
    const editor = vscode.window.activeTextEditor;
    const workspacePath = this.getCurrentWorkspacePath();
    this.model.workspacePath = workspacePath ?? "No workspace folder open";
    this.model.activeFilePath = editor ? this.displayPath(editor.document.uri.fsPath, workspacePath) : "No active file";
    this.model.hasSelection = Boolean(editor && !editor.selection.isEmpty && editor.document.getText(editor.selection).length <= 4000);
    if (!this.model.hasSelection) this.model.includeSelection = false;
    this.postState();
  }

  public async refreshApiKeyStatus(): Promise<void> {
    this.model.apiKeyConfigured = await this.hasSarvamApiKey();
    this.postState();
  }

  public async openSarvamApiKeyPrompt(): Promise<void> {
    await vscode.commands.executeCommand("sarvamCodewalk.setSarvamApiKey");
    await this.refreshApiKeyStatus();
  }

  public async startRecording(): Promise<void> {
    if (this.model.isRecording || this.model.isTranscribing || this.model.isRunning || this.cleanupBlocked) return;
    this.model.state = "ready"; this.model.isRecording = true; this.model.status = "Recording — speak your task (up to 25 seconds)."; this.postState();
    try {
      await this.recorder.start();
      this.recordingTimer = setTimeout(() => { void this.stopRecording("The 25-second recording limit was reached."); }, MAX_RECORDING_MS);
    } catch (error) { this.model.isRecording = false; this.model.status = this.describeRecorderError(error); this.postState(); }
  }

  public async stopRecording(prefix = "Recording stopped."): Promise<void> {
    if (!this.model.isRecording || this.model.isTranscribing) return;
    this.clearRecordingTimer(); this.model.isRecording = false; this.model.isTranscribing = true; this.model.status = `${prefix} Transcribing…`; this.postState();
    let recording: RecordedAudio | undefined;
    try {
      recording = await this.recorder.stop();
      const transcription = await this.stt.transcribe(recording.filePath);
      this.model.task = transcription.transcript;
      this.inputLanguageCode = supportedTtsLanguage(transcription.languageCode) ?? "en-IN";
      this.model.romanizedTranscript = this.model.task;
      this.model.state = "review"; this.model.status = "Transcript ready. Review or correct it before continuing.";
    } catch (error) {
      this.model.state = "ready";
      this.model.status = error instanceof AudioRecorderError ? this.describeRecorderError(error) : this.describeTranscriptionError(error);
    }
    finally { this.model.isTranscribing = false; if (recording) await this.cleanupRecording(recording); this.postState(); }
  }

  public returnToReady(): void {
    if (this.model.isRecording || this.model.isTranscribing || this.model.isRunning) return;
    this.model.state = "ready"; this.model.status = "Ready to record a new task."; this.postState();
  }

  public async useTranscript(transcript?: string): Promise<void> {
    const task = transcript?.trim() || this.model.task.trim();
    if (!task) { this.model.status = "Add a task before continuing."; this.postState(); return; }
    this.model.romanizedTranscript = task;
    this.model.isTranscribing = true;
    this.model.status = "Translating to English…";
    this.postState();
    try {
      this.model.task = await this.translator.toEnglish(task);
      this.model.state = "confirm";
      this.model.status = "English translation ready.";
    } catch (error) {
      this.model.state = "review";
      this.model.status = this.describeTranslationError(error);
    } finally {
      this.model.isTranscribing = false;
      this.postState();
    }
  }

  public async runApprovedTask(): Promise<void> {
    if (this.model.state !== "confirm" || this.model.isRunning || !this.model.task.trim()) return;
    const workspacePath = this.getCurrentWorkspacePath();
    if (!workspacePath) {
      this.model.status = "Open the folder you want to change in VS Code, then try again.";
      this.postState();
      return;
    }
    this.cachedAudio = undefined;
    this.lastRunWorkspacePath = workspacePath;
    this.model.isRunning = true; this.model.state = "working"; this.model.progress = ["Planning"]; this.model.status = "Planning"; this.postState();
    const approvedTask = this.withOptionalContext(this.model.task);
    try {
      if (!await this.codex.isAuthenticated(workspacePath)) {
        this.model.state = "confirm";
        this.model.status = "Codex is not logged in. Run 'codex login' in a terminal, then retry.";
        return;
      }
      const evidence = await this.codex.run(approvedTask, workspacePath, (progress) => { this.model.progress = [...progress]; this.model.status = progress.at(-1) ?? "Working"; this.postState(); });
      this.model.isGeneratingLesson = true; this.model.status = "Explaining"; this.postState();
      const lesson = await this.lessons.create({ task: this.model.task, evidence });
      this.model.lesson = lesson;
      this.model.changedFiles = evidence.finalHandoff?.filesChanged ?? evidence.changedPaths.map((filePath) => ({ path: filePath, purpose: "Observed change" }));
      this.model.progress = [...new Set([...evidence.progress, "Explaining"])];
      this.model.lessonReady = true; this.model.state = "lesson";
      this.model.status = evidence.errors.length ? "Lesson ready with an honest partial result." : "Lesson ready.";
      await this.saveSession(lesson, evidence);
    } catch {
      this.model.state = "confirm"; this.model.status = "Codex could not start. Confirm the local Codex setup, then retry.";
    } finally { this.model.isRunning = false; this.model.isGeneratingLesson = false; this.postState(); }
  }

  public async playLesson(): Promise<void> {
    if (!this.model.lessonReady || this.model.isGeneratingSpeech) return;
    if (this.cachedAudio) { this.postAudio(this.cachedAudio); return; }
    const englishScript = buildSpokenResponse(this.model.lesson);
    this.model.isGeneratingSpeech = true;
    try {
      this.model.status = "Generating speech in your input language…"; this.postState();
      const script = await withTimeout(
        this.translator.fromEnglish(englishScript, this.inputLanguageCode),
        SPEECH_REQUEST_TIMEOUT_MS,
        () => new TranslationError("network", "Timed out while preparing the spoken recap."),
      );
      this.cachedAudio = await withTimeout(
        this.tts.synthesize(script, this.inputLanguageCode),
        SPEECH_REQUEST_TIMEOUT_MS,
        () => new TtsError("network", "Timed out while generating speech."),
      );
      this.postAudio(this.cachedAudio);
      this.model.status = "Spoken recap ready.";
    } catch (error) {
      if (this.inputLanguageCode !== "en-IN") {
        try {
          this.cachedAudio = await withTimeout(
            this.tts.synthesize(englishScript, "en-IN"),
            SPEECH_REQUEST_TIMEOUT_MS,
            () => new TtsError("network", "Timed out while generating fallback speech."),
          );
          this.postAudio(this.cachedAudio);
          this.model.status = "Your language's voice was unavailable, so Listen is playing the English fallback.";
          return;
        } catch { /* Keep the original language-specific failure for a useful message. */ }
      }
      this.model.status = this.describeSpeechError(error);
    } finally {
      this.model.isGeneratingSpeech = false;
      this.postState();
    }
  }

  public async openChangedFile(fileReference: string): Promise<void> {
    const { relativePath, line } = parseFixtureReference(fileReference);
    if (!isSafeFixturePath(relativePath)) return;
    const workspacePath = this.lastRunWorkspacePath ?? this.getCurrentWorkspacePath();
    if (!workspacePath) return;
    const candidate = vscode.Uri.joinPath(vscode.Uri.file(workspacePath), ...relativePath.split("/"));
    const document = await vscode.workspace.openTextDocument(candidate);
    const editor = await vscode.window.showTextDocument(document, { preview: true });
    if (line !== undefined) {
      const targetLine = Math.min(Math.max(line - 1, 0), Math.max(document.lineCount - 1, 0));
      const position = new vscode.Position(targetLine, 0);
      editor.selection = new vscode.Selection(position, position);
      editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
    }
  }

  public async openFixtureFolder(): Promise<void> {
    const workspacePath = this.lastRunWorkspacePath ?? this.getCurrentWorkspacePath();
    if (!workspacePath) {
      this.model.status = "There is no workspace folder open.";
      this.postState();
      return;
    }
    await vscode.env.openExternal(vscode.Uri.file(workspacePath));
  }

  public continueSession(): void {
    if (!this.model.lessonReady) return;
    const files = this.model.changedFiles.map((file) => file.path).join(", ");
    this.continuationContext = [
      `Previous task: ${this.model.task}`,
      `What changed: ${this.model.lesson.whatChanged}`,
      files ? `Changed files: ${files}` : "",
    ].filter(Boolean).join("\n");
    this.model.task = "";
    this.model.romanizedTranscript = "";
    this.model.state = "ready";
    this.model.status = "Continue the session with a new task.";
    this.postState();
  }

  public async deleteSession(): Promise<void> {
    if (this.currentSessionId) await this.history.delete(this.currentSessionId);
    this.currentSessionId = undefined; await this.refreshHistory(); this.model.status = "The local learning session was deleted. Repository files were untouched."; this.postState();
  }

  public async clearHistory(): Promise<void> { await this.history.clear(); this.currentSessionId = undefined; await this.refreshHistory(); this.model.status = "All local learning history was cleared. Repository files were untouched."; this.postState(); }

  public useNextExercise(): void {
    if (!this.model.lesson.tryNext) return;
    this.model.task = this.model.lesson.tryNext.replace(/^Suggested next step:\s*/i, "").trim();
    this.model.romanizedTranscript = this.model.task;
    this.model.state = "review"; this.model.status = "Review the suggested follow-up task before approving it."; this.postState();
  }

  public async openSession(id: string): Promise<void> {
    const session = (await this.history.list()).find((item) => item.id === id);
    if (!session) return;
    this.currentSessionId = session.id; this.model.task = session.approvedTask; this.model.lesson = session.lesson;
    this.inputLanguageCode = supportedTtsLanguage(session.inputLanguageCode) ?? "en-IN";
    this.model.changedFiles = session.changedFiles; this.model.lessonReady = true; this.model.state = "lesson";
    this.model.status = "Opened a local learning session. Repository files were untouched."; this.postState();
  }

  private async saveSession(lesson: GeneratedLesson, evidence: Awaited<ReturnType<CodexRunner["run"]>>): Promise<void> {
    const id = randomUUID(); this.currentSessionId = id;
    const session: LearningSession = { id, createdAt: new Date().toISOString(), approvedTask: this.model.task, lesson, changedFiles: this.model.changedFiles, reportedTest: evidence.observedTests[0]?.command ?? evidence.finalHandoff?.tests[0]?.command ?? "not run", outcome: evidence.exitCode === 0 ? "completed" : "partial", inputLanguageCode: this.inputLanguageCode };
    await this.history.add(session);
    await this.refreshHistory();
  }

  private async refreshHistory(): Promise<void> { this.model.history = [...await this.history.list()]; }

  private withOptionalContext(task: string): string {
    const lines = [task]; const editor = vscode.window.activeTextEditor;
    if (this.continuationContext) lines.push(`Earlier session context (background only):\n${this.continuationContext}`);
    if (this.model.includeActiveFile && editor) lines.push(`Active file path only: ${this.model.activeFilePath}`);
    if (this.model.includeSelection && editor && !editor.selection.isEmpty) {
      const selected = editor.document.getText(editor.selection).slice(0, 4000);
      if (selected) lines.push(`Learner-selected code (explicitly included):\n${selected}`);
    }
    return lines.join("\n\n");
  }

  private async cancelRecording(): Promise<void> {
    if (!this.recorder.isRecording) return;
    try { await this.recorder.cancel(); }
    catch { this.cleanupBlocked = true; this.model.isRecording = false; this.model.status = "Privacy error: temporary audio cleanup failed. Resolve it before recording again."; this.postState(); }
  }
  private async cleanupRecording(recording: RecordedAudio): Promise<void> {
    try { await this.recorder.cleanup(recording); this.cleanupBlocked = false; }
    catch { this.cleanupBlocked = true; this.model.state = "ready"; this.model.status = "Privacy error: temporary audio cleanup failed. Resolve it before recording again."; }
  }
  private describeRecorderError(error: unknown): string {
    if (error instanceof AudioRecorderError) {
      if (error.category === "cleanup") { this.cleanupBlocked = true; return "Privacy error: temporary audio cleanup failed. Resolve it before recording again."; }
      return error.message;
    }
    return "Recording could not start or stopped unexpectedly. Check that arecord can access a Linux microphone, then retry.";
  }
  private describeTranscriptionError(error: unknown): string {
    if (isSarvamSttError(error)) {
      if (error.category === "missing-key") return "No Sarvam API key is configured. Use Set Sarvam API key, then record again.";
      if (error.category === "unauthorized") return "Sarvam rejected the API key. Use Set Sarvam API key to replace it, then record again.";
      if (error.category === "network") return "Sarvam could not be reached. Check your connection, then record again.";
      if (error.category === "empty-transcript") return error.message;
      if (error.category === "request") return describeSarvamRequestError(error.statusCode);
    }
    return "Sarvam could not transcribe this recording. Check the key and service access, then record again.";
  }
  private describeTranslationError(error: unknown): string {
    if (error instanceof TranslationError) {
      if (error.category === "missing-key") return "No Sarvam API key is configured. Update the API key, then try again.";
      if (error.category === "unauthorized") return "Sarvam rejected the API key. Update the API key, then try again.";
      if (error.category === "network") return "Sarvam could not be reached for translation. Check your connection, then try again.";
      if (error.category === "empty-translation") return error.message;
      return error.statusCode ? `Sarvam could not translate this transcript (HTTP ${error.statusCode}). Try again.` : "Sarvam could not translate this transcript. Try again.";
    }
    return "Sarvam could not translate this transcript. Review it and try again.";
  }
  private describeSpeechError(error: unknown): string {
    if (error instanceof TtsError) {
      if (error.category === "missing-key") return "No Sarvam API key is configured for Listen. Update the API key, then retry.";
      if (error.category === "length") return error.message;
      if (error.category === "empty-audio") return "Sarvam returned no playable audio. Try Listen again.";
      if (error.category === "network") return "Sarvam could not be reached for speech. Check your connection, then retry.";
      return error.statusCode ? `Sarvam could not generate speech (HTTP ${error.statusCode}). Check TTS access for this API key, then retry.` : "Sarvam could not generate speech. Check TTS access for this API key, then retry.";
    }
    if (error instanceof TranslationError) return "Sarvam could not translate the response for speech. Check the API key and service access, then retry.";
    return "Sarvam could not generate speech. Check TTS access for this API key, then retry.";
  }
  private postAudio(base64: string): void { void this.view?.webview.postMessage({ type: "audio", mimeType: "audio/wav", base64 }); }
  private postState(): void { void this.view?.webview.postMessage({ type: "state", model: this.model }); }
  private clearRecordingTimer(): void { if (this.recordingTimer) { clearTimeout(this.recordingTimer); this.recordingTimer = undefined; } }
  private getCurrentWorkspacePath(): string | undefined { return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath; }
  private displayPath(filePath: string, workspacePath: string | undefined): string { return workspacePath && filePath.startsWith(workspacePath) ? path.relative(workspacePath, filePath) || path.basename(filePath) : filePath; }
  private createInitialModel(): PanelModel {
    const emptyLesson: GeneratedLesson = { taskRestatement: "", whatChanged: "", why: "", concept: "", verification: "", tryNext: "", limitation: null, ttsScript: "" };
    return { state: "ready", task: "", romanizedTranscript: "", workspacePath: "No workspace folder open", apiKeyConfigured: false, activeFilePath: "No active file", hasSelection: false, includeActiveFile: false, includeSelection: false, isRecording: false, isTranscribing: false, isRunning: false, isGeneratingLesson: false, isGeneratingSpeech: false, lessonReady: false, progress: [], status: "Ready.", changedFiles: [], lesson: emptyLesson, history: [] };
  }

  private async handleMessage(raw: unknown): Promise<void> {
    if (!isWebviewMessage(raw)) return;
    switch (raw.type) {
      case "webviewReady": await this.refreshHistory(); await this.refreshApiKeyStatus(); this.refreshEditorContext(); return;
      case "startRecording": await this.startRecording(); return;
      case "stopRecording": await this.stopRecording(); return;
      case "returnToReady": this.returnToReady(); return;
      case "useTranscript": await this.useTranscript(raw.transcript); return;
      case "runApprovedTask": await this.runApprovedTask(); return;
      case "playLesson": await this.playLesson(); return;
      case "continueSession": this.continueSession(); return;
      case "useNextExercise": this.useNextExercise(); return;
      case "setSarvamApiKey": await this.openSarvamApiKeyPrompt(); return;
      case "setContext": this.model.includeActiveFile = raw.includeActiveFile; this.model.includeSelection = raw.includeSelection && this.model.hasSelection; this.postState(); return;
      case "openChangedFile": await this.openChangedFile(raw.path); return;
      case "openFixtureFolder": await this.openFixtureFolder(); return;
      case "openSession": await this.openSession(raw.id); return;
      case "deleteSession": await this.deleteSession(); return;
      case "clearHistory": await this.clearHistory(); return;
    }
  }
}

function describeSarvamRequestError(statusCode: number | undefined): string {
  if (statusCode === 400) return "Sarvam rejected the audio request (HTTP 400). Try a clear 3–20 second recording; if it repeats, confirm STT access for this key.";
  if (statusCode === 402) return "Sarvam reports no available STT credit (HTTP 402). Check the account plan or credit balance, then retry.";
  if (statusCode === 404) return "Saaras v4 is unavailable for this API key (HTTP 404). Confirm that the key has Sarvam STT access, then retry.";
  if (statusCode === 429) return "Sarvam is rate-limiting this key (HTTP 429). Wait briefly, then retry.";
  if (statusCode && statusCode >= 500) return `Sarvam is temporarily unavailable (HTTP ${statusCode}). Try again shortly.`;
  return statusCode ? `Sarvam rejected the transcription request (HTTP ${statusCode}). Check STT access for this key, then retry.` : "Sarvam could not transcribe this recording. Check the key and service access, then record again.";
}

function isSarvamSttError(error: unknown): error is SarvamSttError {
  if (typeof error !== "object" || error === null) return false;
  const value = error as { category?: unknown; message?: unknown; statusCode?: unknown };
  return typeof value.message === "string"
    && ["missing-key", "unauthorized", "network", "request", "empty-transcript"].includes(value.category as string)
    && (value.statusCode === undefined || typeof value.statusCode === "number");
}

function supportedTtsLanguage(languageCode: string | undefined): string | undefined {
  return ["en-IN", "hi-IN", "bn-IN", "gu-IN", "kn-IN", "ml-IN", "mr-IN", "od-IN", "pa-IN", "ta-IN", "te-IN"].includes(languageCode ?? "") ? languageCode : undefined;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, createError: () => Error): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(createError()), timeoutMs);
    void promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error: unknown) => { clearTimeout(timer); reject(error); },
    );
  });
}

function isSafeFixturePath(value: string): boolean { return value.length > 0 && !value.startsWith("/") && !value.includes("..") && !value.includes("\\") && !value.includes("\0"); }
function parseFixtureReference(value: string): { relativePath: string; line: number | undefined } {
  const match = /^(.*):(\d+)$/.exec(value);
  if (!match) return { relativePath: value, line: undefined };
  const line = Number(match[2]);
  return { relativePath: match[1], line: Number.isSafeInteger(line) && line > 0 ? line : undefined };
}
function isWebviewMessage(value: unknown): value is WebviewMessage {
  if (typeof value !== "object" || value === null) return false;
  const message = value as Record<string, unknown>; if (typeof message.type !== "string") return false;
  if (["webviewReady", "startRecording", "stopRecording", "returnToReady", "runApprovedTask", "playLesson", "continueSession", "useNextExercise", "setSarvamApiKey", "openFixtureFolder", "deleteSession", "clearHistory"].includes(message.type)) return true;
  if (message.type === "useTranscript") return typeof message.transcript === "string" && message.transcript.length <= 4000;
  if (message.type === "openChangedFile") return typeof message.path === "string" && isSafeFixturePath(message.path);
  if (message.type === "openSession") return typeof message.id === "string" && /^[0-9a-f-]{36}$/i.test(message.id);
  if (message.type === "setContext") return typeof message.includeActiveFile === "boolean" && typeof message.includeSelection === "boolean";
  return false;
}
