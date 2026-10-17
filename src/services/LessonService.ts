import { SarvamAIClient } from "sarvamai";
import type { Evidence, GeneratedLesson } from "../domain/types";
import { lessonSchema } from "../domain/schemas";

export interface LessonTruth { task: string; evidence: Evidence; }

export class LessonService {
  public constructor(private readonly getApiKey: () => Promise<string | undefined>) {}

  public async create(truth: LessonTruth): Promise<GeneratedLesson> {
    const fallback = deterministicLesson(truth);
    const key = await this.getApiKey();
    if (!key) return fallback;
    try {
      const client = new SarvamAIClient({ apiSubscriptionKey: key });
      const response = await client.chat.completions({
        model: "sarvam-105b-conversations",
        reasoning_effort: null as never,
        temperature: 0.2,
        messages: [{ role: "user", content: prompt(truth) }],
      });
      const content = response.choices[0]?.message.content;
      if (typeof content !== "string") return fallback;
      const parsed = lessonSchema.safeParse(JSON.parse(content));
      if (!parsed.success) return fallback;
      return {
        taskRestatement: parsed.data.taskRestatement,
        whatChanged: parsed.data.whatChanged,
        why: parsed.data.whyThisApproach,
        concept: `${parsed.data.conceptTitle}: ${parsed.data.conceptExplanation}`,
        verification: parsed.data.verification,
        tryNext: parsed.data.nextExercise,
        limitation: parsed.data.limitation,
        ttsScript: parsed.data.ttsScript,
      };
    } catch {
      return fallback;
    }
  }
}

export function deterministicLesson(truth: LessonTruth): GeneratedLesson {
  const handoff = truth.evidence.finalHandoff;
  const paths = truth.evidence.changedPaths.length ? truth.evidence.changedPaths.join(", ") : "no changed file was observed";
  const test = truth.evidence.observedTests[0] ?? handoff?.tests[0];
  const verification = test
    ? `The agent reported that its verification check ${test.result === "passed" ? "passed" : "did not pass"}. ${test.note || ""}`.trim()
    : "No test result was available.";
  const limitation = handoff?.limitation ?? (truth.evidence.exitCode && truth.evidence.exitCode !== 0 ? "Codex did not complete; this is a partial lesson." : null);
  const next = handoff?.nextStep ?? "Suggested next step: add a focused test for an expected edge case.";
  return {
    taskRestatement: `You said: ${truth.task}`,
    whatChanged: `Observed: ${paths}. ${handoff?.summary ?? "The agent did not return a complete teaching summary."}`,
    why: handoff?.decisions[0] ? `Agent reported: ${handoff.decisions[0].reason}` : "The agent did not report a rationale.",
    concept: "Concept — focused test: a small test clearly verifies one expected behavior.",
    verification,
    tryNext: `Suggested next step: ${next}`,
    limitation,
    ttsScript: "The change has been checked. Add one focused test next to understand the behavior.",
  };
}

function prompt(truth: LessonTruth): string {
  const safeTruth = {
    approvedTask: truth.task,
    observedChangedPaths: truth.evidence.changedPaths,
    observedTests: truth.evidence.observedTests,
    agentHandoff: truth.evidence.finalHandoff,
    exitCode: truth.evidence.exitCode,
    errors: truth.evidence.errors,
  };
  return `Create only JSON with taskRestatement, whatChanged, whyThisApproach, conceptTitle, conceptExplanation, verification, limitation, nextExercise, ttsScript. Write concise, clear English display fields. Only paraphrase this truth object; do not invent facts, motivations, tests, security claims, commands, paths, or identifiers. Explain exactly one concept. Prefix recommendations in nextExercise with Suggested next step:. The ttsScript must be below 500 characters and contain no code blocks, secrets, full terminal output, or source content.\n\nTruth object:\n${JSON.stringify(safeTruth)}`;
}
