export type PanelState = "ready" | "review" | "confirm" | "working" | "lesson";

export interface ChangedFile {
  path: string;
  purpose: string;
}

export interface LessonPreview {
  whatChanged: string;
  why: string;
  concept: string;
  verification: string;
  tryNext: string;
}

export interface AgentHandoff {
  summary: string;
  filesChanged: ChangedFile[];
  decisions: Array<{ decision: string; reason: string }>;
  tradeoffs: string[];
  tests: Array<{ command: string; result: "passed" | "failed" | "not-run"; note: string }>;
  limitation: string | null;
  nextStep: string;
}

export interface Evidence {
  progress: string[];
  changedPaths: string[];
  observedTests: Array<{ command: string; result: "passed" | "failed"; note: string }>;
  finalHandoff: AgentHandoff | undefined;
  errors: string[];
  exitCode: number | undefined;
}

export interface GeneratedLesson extends LessonPreview {
  taskRestatement: string;
  limitation: string | null;
  ttsScript: string;
}

export interface PanelModel {
  state: PanelState;
  task: string;
  romanizedTranscript: string;
  workspacePath: string;
  apiKeyConfigured: boolean;
  activeFilePath: string;
  hasSelection: boolean;
  includeActiveFile: boolean;
  includeSelection: boolean;
  isRecording: boolean;
  isTranscribing: boolean;
  isRunning: boolean;
  isGeneratingLesson: boolean;
  isGeneratingSpeech: boolean;
  lessonReady: boolean;
  progress: string[];
  status: string;
  changedFiles: ChangedFile[];
  lesson: GeneratedLesson;
  history: LearningSession[];
}

export interface LearningSession {
  id: string;
  createdAt: string;
  approvedTask: string;
  lesson: GeneratedLesson;
  changedFiles: ChangedFile[];
  reportedTest: string;
  outcome: "completed" | "partial" | "failed";
  inputLanguageCode?: string;
}

export type WebviewMessage =
  | { type: "webviewReady" }
  | { type: "startRecording" }
  | { type: "stopRecording" }
  | { type: "returnToReady" }
  | { type: "useTranscript"; transcript: string }
  | { type: "runApprovedTask" }
  | { type: "playLesson" }
  | { type: "continueSession" }
  | { type: "useNextExercise" }
  | { type: "setSarvamApiKey" }
  | { type: "setContext"; includeActiveFile: boolean; includeSelection: boolean }
  | { type: "openChangedFile"; path: string }
  | { type: "openFixtureFolder" }
  | { type: "openSession"; id: string }
  | { type: "deleteSession" }
  | { type: "clearHistory" };

export interface StateUpdateMessage {
  type: "state";
  model: PanelModel;
}
