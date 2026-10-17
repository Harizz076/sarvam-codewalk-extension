import type { AgentHandoff, Evidence } from "../domain/types";
import { handoffSchema } from "../domain/schemas";

export class EvidenceReducer {
  private readonly evidence: Evidence = { progress: [], changedPaths: [], observedTests: [], errors: [], exitCode: undefined, finalHandoff: undefined };

  public consume(line: string): void {
    let event: unknown;
    try { event = JSON.parse(line); } catch { return; }
    if (!isRecord(event) || typeof event.type !== "string") return;
    if (event.type === "turn.started") this.addProgress("Planning");
    if (event.type === "turn.completed") this.addProgress("Explaining");
    if (event.type === "error") this.evidence.errors.push("Codex reported an error.");
    if (!isRecord(event.item)) return;
    const item = event.item;
    if (item.type === "command_execution" && item.status === "completed") {
      const command = typeof item.command === "string" ? item.command : "";
      const exitCode = typeof item.exit_code === "number" ? item.exit_code : undefined;
      if (looksLikeTest(command) && exitCode !== undefined) {
        this.evidence.observedTests.push({ command: safeCommand(command), result: exitCode === 0 ? "passed" : "failed", note: exitCode === 0 ? "Observed command completed." : "Observed command failed." });
      }
      this.addProgress(looksLikeTest(command) ? "Running checks" : "Editing files");
    }
    if (item.type === "agent_message" && typeof item.text === "string") {
      const parsed = parseHandoff(item.text);
      if (parsed) this.evidence.finalHandoff = parsed;
    }
  }

  public finish(exitCode: number, changedPaths: readonly string[]): Evidence {
    this.evidence.exitCode = exitCode;
    this.evidence.changedPaths = [...new Set(changedPaths.filter(isSafeRelativePath))];
    if (exitCode !== 0) this.evidence.errors.push("Codex did not complete successfully.");
    return structuredClone(this.evidence);
  }

  public progress(): readonly string[] { return [...this.evidence.progress]; }

  private addProgress(label: string): void { if (!this.evidence.progress.includes(label)) this.evidence.progress.push(label); }
}

function parseHandoff(value: string): AgentHandoff | undefined {
  try { return handoffSchema.parse(JSON.parse(value)); } catch { return undefined; }
}
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null; }
function looksLikeTest(command: string): boolean { return /\b(npm\s+test|node\s+--test|test|pytest|vitest|mocha)\b/i.test(command); }
function safeCommand(command: string): string { return command.replace(/\s+/g, " ").slice(0, 300); }
function isSafeRelativePath(value: string): boolean { return value.length > 0 && value.length <= 300 && !value.startsWith("/") && !value.includes("..") && !value.includes("\0"); }
