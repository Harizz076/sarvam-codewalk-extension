import { SarvamAIClient, SarvamAIError } from "sarvamai";

export class TranslationError extends Error {
  public constructor(
    public readonly category: "missing-key" | "unauthorized" | "network" | "request" | "empty-translation",
    message: string,
    public readonly statusCode?: number,
  ) {
    super(message);
    this.name = "TranslationError";
  }
}

/** Converts a Roman-script transcript from any supported spoken language into English for Codex. */
export class TranslationService {
  public constructor(private readonly getApiKey: () => Promise<string | undefined>) {}

  public async toEnglish(romanizedTranscript: string): Promise<string> {
    const apiKey = await this.getApiKey();
    if (!apiKey) throw new TranslationError("missing-key", "Set a Sarvam API key before translating a transcript.");

    try {
      const client = new SarvamAIClient({ apiSubscriptionKey: apiKey });
      const response = await client.text.translate({
        input: romanizedTranscript,
        source_language_code: "auto",
        target_language_code: "en-IN",
        model: "mayura:v1",
      });
      const translation = response.translated_text?.trim();
      if (!translation) throw new TranslationError("empty-translation", "Sarvam returned an empty English translation.");
      return translation;
    } catch (error) {
      if (error instanceof TranslationError) throw error;
      const statusCode = getStatusCode(error);
      if (statusCode === 401 || statusCode === 403) throw new TranslationError("unauthorized", "Sarvam rejected the saved API key.", statusCode);
      if (statusCode !== undefined) throw new TranslationError("request", "Sarvam could not translate this transcript.", statusCode);
      throw new TranslationError("network", "Sarvam could not be reached for translation.");
    }
  }

  /** Uses native script so Bulbul can speak the recap naturally in the input language. */
  public async fromEnglish(englishText: string, targetLanguageCode: string): Promise<string> {
    if (targetLanguageCode === "en-IN") return englishText;
    const apiKey = await this.getApiKey();
    if (!apiKey) throw new TranslationError("missing-key", "Set a Sarvam API key before translating a recap.");

    try {
      const client = new SarvamAIClient({ apiSubscriptionKey: apiKey });
      const response = await client.text.translate({
        input: englishText,
        source_language_code: "en-IN",
        target_language_code: targetLanguageCode as never,
        model: "sarvam-translate:v1",
      });
      const translation = response.translated_text?.trim();
      if (!translation) throw new TranslationError("empty-translation", "Sarvam returned an empty spoken recap.");
      return translation;
    } catch (error) {
      if (error instanceof TranslationError) throw error;
      const statusCode = getStatusCode(error);
      if (statusCode === 401 || statusCode === 403) throw new TranslationError("unauthorized", "Sarvam rejected the saved API key.", statusCode);
      if (statusCode !== undefined) throw new TranslationError("request", "Sarvam could not translate the spoken recap.", statusCode);
      throw new TranslationError("network", "Sarvam could not be reached for spoken translation.");
    }
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
