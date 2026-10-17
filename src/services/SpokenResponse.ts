import type { GeneratedLesson } from "../domain/types";

/**
 * Keeps Listen faithful to the response the learner can see, while remaining
 * below Bulbul's REST character limit after translation.
 */
export function buildSpokenResponse(lesson: GeneratedLesson): string {
  const parts = [
    lesson.taskRestatement,
    `What changed: ${lesson.whatChanged}`,
    `Why: ${lesson.why}`,
    `Concept: ${lesson.concept}`,
    `Verification: ${lesson.verification}`,
    lesson.limitation ? `Limitation: ${lesson.limitation}` : "",
    `Try next: ${lesson.tryNext}`,
  ].filter(Boolean);
  return parts.join(" ").slice(0, 2_200);
}
