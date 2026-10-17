import { promises as fs } from "fs";
import * as os from "os";
import * as path from "path";
import type { Evidence } from "../domain/types";
import { handoffJsonSchema } from "../domain/schemas";
import { EvidenceReducer } from "./EvidenceReducer";
import { ProcessRunner } from "./ProcessRunner";

export class CodexRunner {
  public constructor(private readonly processRunner = new ProcessRunner()) {}

  public async run(approvedTask: string, workspacePath: string, onProgress: (progress: readonly string[]) => void): Promise<Evidence> {
    await this.assertWorkspaceRepository(workspacePath);
    const schemaDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "sarvam-codewalk-schema-"));
    const schemaPath = path.join(schemaDirectory, "handoff.json");
    await fs.writeFile(schemaPath, JSON.stringify(handoffJsonSchema), { encoding: "utf8", mode: 0o600 });
    const reducer = new EvidenceReducer();
    try {
      const result = await this.processRunner.run("codex", [
        "exec", "--ephemeral", "--json", "--sandbox", "workspace-write", "--output-schema", schemaPath, "-C", workspacePath,
        buildPrompt(approvedTask),
      ], workspacePath, (line) => { reducer.consume(line); onProgress(reducer.progress()); });
      const changedPaths = await this.changedPaths(workspacePath);
      return reducer.finish(result.exitCode, changedPaths);
    } finally {
      await fs.rm(schemaDirectory, { recursive: true, force: true });
    }
  }

  /** Checks only Codex's exit status; account output is never stored or shown. */
  public async isAuthenticated(workspacePath: string): Promise<boolean> {
    try {
      const result = await this.processRunner.run("codex", ["login", "status"], workspacePath, () => undefined);
      return result.exitCode === 0;
    } catch { return false; }
  }

  private async assertWorkspaceRepository(workspacePath: string): Promise<void> {
    const packageFile = path.join(workspacePath, "package.json");
    const gitDir = path.join(workspacePath, ".git");
    await fs.access(packageFile);
    await fs.access(gitDir);
  }

  private async changedPaths(workspacePath: string): Promise<string[]> {
    const lines: string[] = [];
    const result = await this.processRunner.run("git", ["status", "--porcelain=v1"], workspacePath, (line) => lines.push(line.slice(3).trim()));
    if (result.exitCode !== 0) return [];
    return lines;
  }
}

function buildPrompt(task: string): string {
  return `You are working only inside the VS Code workspace supplied with -C. Inspect it before editing. Change only what is necessary for the user task below. Run the smallest relevant check when feasible. Never expose credentials. Return the required final JSON handoff with brief user-facing rationale only; do not include private reasoning. State failures and limitations honestly.\n\nUser task (English):\n${task}`;
}
