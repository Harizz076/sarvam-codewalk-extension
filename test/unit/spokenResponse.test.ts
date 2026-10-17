import * as assert from "assert";
import { buildSpokenResponse } from "../../src/services/SpokenResponse";
import { clampTtsText } from "../../src/services/TtsService";

describe("buildSpokenResponse", () => {
  it("uses the same learner-facing response sections that the UI renders", () => {
    const speech = buildSpokenResponse({
      taskRestatement: "Create a Fibonacci generator.",
      whatChanged: "Added the generator and its tests.",
      why: "It keeps the change focused.",
      concept: "Generators yield values lazily.",
      verification: "The focused test passed.",
      limitation: null,
      tryNext: "Try a larger input.",
      ttsScript: "This older field is intentionally not used for Listen.",
    });
    assert.match(speech, /Create a Fibonacci generator/);
    assert.match(speech, /Added the generator and its tests/);
    assert.match(speech, /The focused test passed/);
    assert.doesNotMatch(speech, /older field/);
  });

  it("keeps translated speech input within Bulbul's request limit", () => {
    const longText = `${"One complete sentence. ".repeat(160)}Tail`;
    const clamped = clampTtsText(longText);
    assert.ok(clamped.length <= 2_300);
    assert.match(clamped, /\.$/);
  });
});
