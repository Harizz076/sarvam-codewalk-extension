import * as vscode from "vscode";
import { LinuxArecordRecorder } from "./services/AudioRecorder";
import { CodexRunner } from "./services/CodexRunner";
import { LessonService } from "./services/LessonService";
import { LocalHistoryStore } from "./services/LocalHistoryStore";
import { SarvamSttService } from "./services/SarvamService";
import { TranslationService } from "./services/TranslationService";
import { TtsService } from "./services/TtsService";
import { SarvamCodewalkViewProvider, VIEW_ID } from "./webview/SarvamCodewalkViewProvider";

const SARVAM_API_KEY = "sarvamCodewalk.apiKey";

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const recorder = new LinuxArecordRecorder(() => vscode.workspace.getConfiguration("sarvamCodewalk").get<string>("audioDevice", "default"));
  const stt = new SarvamSttService(async () => context.secrets.get(SARVAM_API_KEY));
  const getSarvamKey = async (): Promise<string | undefined> => context.secrets.get(SARVAM_API_KEY);
  const provider = new SarvamCodewalkViewProvider(
    context.extensionUri,
    new LocalHistoryStore(context.globalState),
    recorder,
    stt,
    new TranslationService(getSarvamKey),
    async () => Boolean(await getSarvamKey()),
    new CodexRunner(),
    new LessonService(getSarvamKey),
    new TtsService(getSarvamKey),
  );
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(VIEW_ID, provider, { webviewOptions: { retainContextWhenHidden: true } }),
    vscode.window.onDidChangeActiveTextEditor(() => provider.refreshEditorContext()),
    vscode.commands.registerCommand("sarvamCodewalk.startRecording", () => provider.startRecording()),
    vscode.commands.registerCommand("sarvamCodewalk.stopRecording", () => provider.stopRecording()),
    vscode.commands.registerCommand("sarvamCodewalk.useTranscript", () => provider.useTranscript()),
    vscode.commands.registerCommand("sarvamCodewalk.runApprovedTask", () => provider.runApprovedTask()),
    vscode.commands.registerCommand("sarvamCodewalk.playLesson", () => provider.playLesson()),
    vscode.commands.registerCommand("sarvamCodewalk.openFixtureFolder", () => provider.openFixtureFolder()),
    vscode.commands.registerCommand("sarvamCodewalk.deleteSession", () => provider.deleteSession()),
    vscode.commands.registerCommand("sarvamCodewalk.clearHistory", async () => {
      const choice = await vscode.window.showWarningMessage("Clear every local Sarvam Codewalk learning session? Repository files will not be changed.", { modal: true }, "Clear history");
      if (choice === "Clear history") {
        await provider.clearHistory();
      }
    }),
    vscode.commands.registerCommand("sarvamCodewalk.setSarvamApiKey", async () => {
      const key = await vscode.window.showInputBox({
        prompt: "Paste your Sarvam API key",
        password: true,
        ignoreFocusOut: true,
      });
      if (key?.trim()) {
        await context.secrets.store(SARVAM_API_KEY, key.trim());
        await provider.refreshApiKeyStatus();
        void vscode.window.showInformationMessage("Sarvam API key saved in VS Code SecretStorage.");
      }
    }),
    vscode.commands.registerCommand("sarvamCodewalk.clearSarvamApiKey", async () => {
      await context.secrets.delete(SARVAM_API_KEY);
      await provider.refreshApiKeyStatus();
      void vscode.window.showInformationMessage("Sarvam API key cleared from VS Code SecretStorage.");
    }),
    { dispose: () => { void provider.dispose(); } },
  );
}

export function deactivate(): void {
  // The registered provider cancels and removes any in-progress recording.
}
