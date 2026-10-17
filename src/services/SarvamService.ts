import * as fs from "fs";
import { SarvamAIClient, SarvamAIError } from "sarvamai";

const STT_KEYTERMS = [
  "Sarvam Codewalk", "Sarvam", "Codex", "VS Code", "TypeScript", "JavaScript", "npm", "API",
  "function", "test", "component", "emailValidator", "isEmailAddress",
] as const;

export class SarvamSttError extends Error {
  public constructor(
    public readonly category: "missing-key" | "unauthorized" | "network" | "request" | "empty-transcript",
    message: string,
    public readonly statusCode?: number,
  ) {
    super(message);
    this.name = "SarvamSttError";
  }
}

export interface Transcription {
  transcript: string;
  languageCode: string | undefined;
}

export class SarvamSttService {
  public constructor(private readonly getApiKey: () => Promise<string | undefined>) {}

  public async transcribe(audioPath: string): Promise<Transcription> {
    const apiKey = await this.getApiKey();
    if (!apiKey) {
      throw new SarvamSttError("missing-key", "Set a Sarvam API key before transcribing a recording.");
    }

    try {
      const client = new SarvamAIClient({ apiSubscriptionKey: apiKey });
      try {
        return await this.requestTranscript(client, audioPath, "saaras:v4", true);
      } catch (error) {
        const statusCode = getStatusCode(error);
        // Saaras v3 remains the recommended broadly available REST model. Keep
        // v4/keyterms as the preferred path, then use v3 only for endpoint/model
        // availability failures; this is not a retry for authentication failures.
        if (statusCode === 400 || statusCode === 404) {
          return await this.requestTranscript(client, audioPath, "saaras:v3", false);
        }
        throw error;
      }
    } catch (error) {
      if (error instanceof SarvamSttError) {
        throw error;
      }
      const statusCode = getStatusCode(error);
      if (statusCode === 401 || statusCode === 403) {
        throw new SarvamSttError("unauthorized", "Sarvam rejected the saved API key.");
      }
      if (statusCode !== undefined) {
        throw new SarvamSttError("request", "Sarvam could not transcribe this recording.", statusCode);
      }
      throw new SarvamSttError("network", "Sarvam could not be reached.");
    }
  }

  private async requestTranscript(client: SarvamAIClient, audioPath: string, model: "saaras:v3" | "saaras:v4", includeKeyterms: boolean): Promise<Transcription> {
    const file = fs.createReadStream(audioPath);
    try {
      const response = await client.speechToText.transcribe({
        file,
        model,
        // Let Saaras detect any supported spoken language and return its words
        // in Latin/Roman script, rather than constraining learners to one locale.
        mode: "translit",
        ...(includeKeyterms ? { keyterms: [...STT_KEYTERMS] } : {}),
      });
      const transcript = response.transcript?.trim();
      if (!transcript) throw new SarvamSttError("empty-transcript", "Sarvam returned an empty transcript. Try recording again.");
      return { transcript, languageCode: response.language_code };
    } finally { file.destroy(); }
  }
}

function getStatusCode(error: unknown): number | undefined {
  if (error instanceof SarvamAIError) return error.statusCode;
  if (typeof error === "object" && error !== null && "statusCode" in error) {
    const statusCode = (error as { statusCode?: unknown }).statusCode;
    return typeof statusCode === "number" ? statusCode : undefined;
  }
  return undefined;
}
