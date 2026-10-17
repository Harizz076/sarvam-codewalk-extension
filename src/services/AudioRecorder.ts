import { randomUUID } from "crypto";
import { promises as fs } from "fs";
import * as os from "os";
import * as path from "path";
import { spawn, type ChildProcess } from "child_process";

export interface RecordedAudio {
  readonly directory: string;
  readonly filePath: string;
}

export interface AudioRecorder {
  readonly isRecording: boolean;
  start(): Promise<void>;
  stop(): Promise<RecordedAudio>;
  cancel(): Promise<void>;
  cleanup(recording: RecordedAudio): Promise<void>;
}

export class AudioRecorderError extends Error {
  public constructor(message: string, public readonly category: "recorder" | "cleanup") {
    super(message);
    this.name = "AudioRecorderError";
  }
}

/** Linux-only arecord implementation. It never invokes a shell. */
export class LinuxArecordRecorder implements AudioRecorder {
  private process: ChildProcess | undefined;
  private current: RecordedAudio | undefined;
  private closed: Promise<{ code: number | null; signal: NodeJS.Signals | null }> | undefined;
  private stderr = "";
  private stopRequested = false;

  public constructor(private readonly getDevice: () => string = () => "default") {}

  public get isRecording(): boolean {
    return this.process !== undefined;
  }

  public async start(): Promise<void> {
    if (this.process) {
      throw new AudioRecorderError("A recording is already active.", "recorder");
    }

    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "sarvam-codewalk-"));
    const recording: RecordedAudio = { directory, filePath: path.join(directory, `${randomUUID()}.wav`) };
    this.current = recording;

    try {
      const device = this.getDevice().trim() || "default";
      this.stderr = "";
      this.stopRequested = false;
      const child = spawn("arecord", [
        "--quiet",
        `--device=${device}`,
        "--format=S16_LE",
        "--channels=1",
        "--rate=16000",
        "--file-type=wav",
        recording.filePath,
      ], { shell: false, stdio: ["ignore", "ignore", "pipe"] });
      child.stderr?.on("data", (chunk: Buffer) => { this.stderr = `${this.stderr}${chunk.toString("utf8")}`.slice(0, 480); });
      this.process = child;
      this.closed = new Promise((resolve, reject) => {
        child.once("error", (error) => reject(new AudioRecorderError(`Could not start arecord: ${error.message}`, "recorder")));
        child.once("spawn", () => {
          child.once("close", (code, signal) => resolve({ code, signal }));
        });
      });
      await new Promise<void>((resolve, reject) => {
        child.once("spawn", resolve);
        child.once("error", reject);
      });
    } catch (error) {
      this.process = undefined;
      this.closed = undefined;
      await this.cleanupCurrent();
      throw error instanceof AudioRecorderError ? error : new AudioRecorderError("Could not start recording.", "recorder");
    }
  }

  public async stop(): Promise<RecordedAudio> {
    const recording = this.current;
    const child = this.process;
    const closed = this.closed;
    if (!recording || !child || !closed) {
      throw new AudioRecorderError("No recording is active.", "recorder");
    }

    if (!child.killed) {
      this.stopRequested = true;
      child.kill("SIGINT");
    }
    try {
      const result = await closed;
      const capturedAudio = await hasWavAudio(recording.filePath);
      if (!capturedAudio || (result.code !== 0 && result.signal !== "SIGINT" && !this.stopRequested)) {
        await this.cleanup(recording);
        const detail = sanitizeArecordError(this.stderr);
        throw new AudioRecorderError(`arecord could not capture from ALSA device '${this.getDevice().trim() || "default"}'${detail ? `: ${detail}` : "."}`, "recorder");
      }
      return recording;
    } finally {
      this.process = undefined;
      this.closed = undefined;
      this.current = undefined;
      this.stderr = "";
      this.stopRequested = false;
    }
  }

  public async cancel(): Promise<void> {
    const child = this.process;
    const closed = this.closed;
    if (child && !child.killed) {
      child.kill("SIGINT");
    }
    if (closed) {
      try {
        await closed;
      } catch {
        // The raw audio still has to be removed even when arecord itself fails.
      }
    }
    this.process = undefined;
    this.closed = undefined;
    this.stopRequested = false;
    await this.cleanupCurrent();
  }

  public async cleanup(recording: RecordedAudio): Promise<void> {
    await removeDirectoryWithRetry(recording.directory);
  }

  private async cleanupCurrent(): Promise<void> {
    const recording = this.current;
    this.current = undefined;
    if (recording) {
      await this.cleanup(recording);
    }
  }
}

function sanitizeArecordError(value: string): string {
  return value.replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 240);
}

async function hasWavAudio(filePath: string): Promise<boolean> {
  try { return (await fs.stat(filePath)).size > 44; }
  catch { return false; }
}

export async function removeDirectoryWithRetry(directory: string): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await fs.rm(directory, { recursive: true, force: true, maxRetries: 0 });
      return;
    } catch (error) {
      lastError = error;
    }
  }
  const detail = lastError instanceof Error ? lastError.message : "unknown error";
  throw new AudioRecorderError(`Temporary audio could not be deleted (${detail}).`, "cleanup");
}
