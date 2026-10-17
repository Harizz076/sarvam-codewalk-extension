import { SarvamAIClient, SarvamAIError } from "sarvamai";

export class TtsError extends Error {
  public constructor(
    public readonly category: "missing-key" | "length" | "request" | "empty-audio" | "network",
    message: string,
    public readonly statusCode?: number,
  ) {
    super(message);
    this.name = "TtsError";
  }
}

export class TtsService {
  public constructor(private readonly getApiKey: () => Promise<string | undefined>) {}

  public async synthesize(ttsScript: string, requestedLanguageCode: string): Promise<string> {
    const key = await this.getApiKey();
    if (!key) throw new TtsError("missing-key", "Set a Sarvam API key before using Listen.");
    if (!ttsScript) throw new TtsError("length", "There is no response text to speak.");
    const voice = voiceFor(requestedLanguageCode);
    const client = new SarvamAIClient({ apiSubscriptionKey: key });
    try {
      const response = await client.textToSpeech.convert({
        text: clampTtsText(ttsScript),
        language_code: voice.languageCode as never,
        model: voice.model,
        speaker: voice.speaker as never,
        ...(voice.model === "bulbul:v4-flash" ? { enable_preprocessing: true } : {}),
        output_audio_codec: "wav",
      });
      const audio = response.audios[0];
      if (!audio) throw new TtsError("empty-audio", "Sarvam returned no playable audio.");
      return audio;
    } catch (error) {
      if (error instanceof TtsError) throw error;
      const statusCode = getStatusCode(error);
      if (statusCode !== undefined) throw new TtsError("request", "Sarvam rejected the speech request.", statusCode);
      throw new TtsError("network", "Sarvam could not be reached for speech.");
    }
  }
}

export function clampTtsText(text: string): string {
  if (text.length <= 2_300) return text;
  const clipped = text.slice(0, 2_300);
  const sentenceEnd = Math.max(clipped.lastIndexOf(". "), clipped.lastIndexOf("। "), clipped.lastIndexOf("! "), clipped.lastIndexOf("? "));
  return (sentenceEnd > 500 ? clipped.slice(0, sentenceEnd + 1) : clipped).trim();
}

function voiceFor(languageCode: string): { languageCode: string; model: "bulbul:v3" | "bulbul:v4-flash"; speaker: string } {
  const voices: Record<string, { model: "bulbul:v3" | "bulbul:v4-flash"; speaker: string }> = {
    "en-IN": { model: "bulbul:v4-flash", speaker: "simran_en_customer" },
    "hi-IN": { model: "bulbul:v4-flash", speaker: "aparna_hi_customer" },
    "bn-IN": { model: "bulbul:v4-flash", speaker: "arnab_bn_conversation" },
    "gu-IN": { model: "bulbul:v4-flash", speaker: "bhavik_gu_conversation" },
    "kn-IN": { model: "bulbul:v4-flash", speaker: "chaitra_kn_conversation" },
    "mr-IN": { model: "bulbul:v4-flash", speaker: "ishita_mr_conversational" },
    "pa-IN": { model: "bulbul:v4-flash", speaker: "anand_pa_conversation" },
    "ta-IN": { model: "bulbul:v4-flash", speaker: "gokul_ta_narration" },
    "te-IN": { model: "bulbul:v4-flash", speaker: "kavitha_te_conversation" },
    "ml-IN": { model: "bulbul:v3", speaker: "anushka" },
    "od-IN": { model: "bulbul:v3", speaker: "anushka" },
  };
  const voice = voices[languageCode];
  return voice ? { languageCode, ...voice } : { languageCode: "en-IN", ...voices["en-IN"] };
}

function getStatusCode(error: unknown): number | undefined {
  if (error instanceof SarvamAIError) return error.statusCode;
  if (typeof error === "object" && error !== null && "statusCode" in error) {
    const statusCode = (error as { statusCode?: unknown }).statusCode;
    return typeof statusCode === "number" ? statusCode : undefined;
  }
  return undefined;
}
