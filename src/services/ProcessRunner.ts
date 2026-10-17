import { spawn } from "child_process";

export interface ProcessResult { exitCode: number; }

/** Runs local programs with argument arrays and never through a shell. */
export class ProcessRunner {
  public async run(command: string, args: string[], cwd: string, onLine: (line: string) => void): Promise<ProcessResult> {
    return new Promise((resolve, reject) => {
      const child = spawn(command, args, { cwd, shell: false, stdio: ["ignore", "pipe", "pipe"] });
      let pending = "";
      const consume = (chunk: Buffer): void => {
        pending += chunk.toString("utf8");
        const lines = pending.split(/\r?\n/);
        pending = lines.pop() ?? "";
        for (const line of lines) if (line.trim()) onLine(line);
      };
      child.stdout.on("data", consume);
      child.stderr.on("data", consume);
      child.once("error", reject);
      child.once("close", (code) => {
        if (pending.trim()) onLine(pending);
        resolve({ exitCode: code ?? 1 });
      });
    });
  }
}

