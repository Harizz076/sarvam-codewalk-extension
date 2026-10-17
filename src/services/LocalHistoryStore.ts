import * as vscode from "vscode";
import type { LearningSession } from "../domain/types";

const HISTORY_KEY = "sarvamCodewalk.learningHistory";

/** Stores only learner-facing text and metadata in VS Code global state. */
export class LocalHistoryStore {
  public constructor(private readonly globalState: vscode.Memento) {}

  public list(): readonly LearningSession[] {
    const history = this.globalState.get<unknown>(HISTORY_KEY, []);
    return Array.isArray(history) ? history.filter(isLearningSession) : [];
  }

  public async add(session: LearningSession): Promise<void> {
    await this.globalState.update(HISTORY_KEY, [...this.list(), session]);
  }

  public async delete(id: string): Promise<void> {
    await this.globalState.update(HISTORY_KEY, this.list().filter((session) => session.id !== id));
  }

  public async clear(): Promise<void> {
    await this.globalState.update(HISTORY_KEY, []);
  }
}

function isLearningSession(value: unknown): value is LearningSession {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return typeof record.id === "string" && typeof record.createdAt === "string" && typeof record.approvedTask === "string";
}

