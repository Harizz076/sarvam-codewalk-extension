import { z } from "zod";

export const changedFileSchema = z.object({ path: z.string().min(1).max(300), purpose: z.string().min(1).max(500) }).strict();
export const handoffSchema = z.object({
  summary: z.string().max(1200),
  filesChanged: z.array(changedFileSchema).max(20),
  decisions: z.array(z.object({ decision: z.string().max(500), reason: z.string().max(500) }).strict()).max(12),
  tradeoffs: z.array(z.string().max(500)).max(12),
  tests: z.array(z.object({ command: z.string().max(300), result: z.enum(["passed", "failed", "not-run"]), note: z.string().max(500) }).strict()).max(12),
  limitation: z.string().max(800).nullable(),
  nextStep: z.string().max(800),
}).strict();

export const lessonSchema = z.object({
  taskRestatement: z.string().min(1).max(1000),
  whatChanged: z.string().min(1).max(1400),
  whyThisApproach: z.string().min(1).max(1400),
  conceptTitle: z.string().min(1).max(160),
  conceptExplanation: z.string().min(1).max(1600),
  verification: z.string().min(1).max(1000),
  limitation: z.string().max(800).nullable(),
  nextExercise: z.string().min(1).max(800),
  ttsScript: z.string().min(1).max(500),
}).strict();

export const handoffJsonSchema = {
  type: "object", additionalProperties: false,
  required: ["summary", "filesChanged", "decisions", "tradeoffs", "tests", "limitation", "nextStep"],
  properties: {
    summary: { type: "string", maxLength: 1200 },
    filesChanged: { type: "array", maxItems: 20, items: { type: "object", additionalProperties: false, required: ["path", "purpose"], properties: { path: { type: "string", maxLength: 300 }, purpose: { type: "string", maxLength: 500 } } } },
    decisions: { type: "array", maxItems: 12, items: { type: "object", additionalProperties: false, required: ["decision", "reason"], properties: { decision: { type: "string", maxLength: 500 }, reason: { type: "string", maxLength: 500 } } } },
    tradeoffs: { type: "array", maxItems: 12, items: { type: "string", maxLength: 500 } },
    tests: { type: "array", maxItems: 12, items: { type: "object", additionalProperties: false, required: ["command", "result", "note"], properties: { command: { type: "string", maxLength: 300 }, result: { type: "string", enum: ["passed", "failed", "not-run"] }, note: { type: "string", maxLength: 500 } } } },
    limitation: { type: ["string", "null"], maxLength: 800 }, nextStep: { type: "string", maxLength: 800 },
  },
} as const;
