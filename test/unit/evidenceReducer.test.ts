import * as assert from "assert";
import { EvidenceReducer } from "../../src/services/EvidenceReducer";

describe("EvidenceReducer", () => {
  it("keeps safe evidence and discards reasoning payloads", () => {
    const reducer = new EvidenceReducer();
    reducer.consume(JSON.stringify({ type: "item.completed", item: { type: "reasoning", text: "private reasoning" } }));
    reducer.consume(JSON.stringify({ type: "item.completed", item: { type: "command_execution", command: "node --test test/emailValidator.test.js", status: "completed", exit_code: 0, aggregated_output: "raw output" } }));
    reducer.consume(JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: JSON.stringify({ summary: "Done", filesChanged: [], decisions: [], tradeoffs: [], tests: [], limitation: null, nextStep: "Next" }) } }));
    const evidence = reducer.finish(0, ["src/emailValidator.js", "../secret"]);
    assert.deepStrictEqual(evidence.changedPaths, ["src/emailValidator.js"]);
    assert.equal(evidence.observedTests[0]?.result, "passed");
    assert.equal(evidence.finalHandoff?.summary, "Done");
    assert.equal(JSON.stringify(evidence).includes("private reasoning"), false);
    assert.equal(JSON.stringify(evidence).includes("raw output"), false);
  });
});

