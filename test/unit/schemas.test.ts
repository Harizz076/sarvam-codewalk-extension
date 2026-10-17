import * as assert from "assert";
import { handoffSchema, lessonSchema } from "../../src/domain/schemas";

describe("schemas", () => {
  it("rejects malformed handoffs and unsafe lesson responses", () => {
    assert.equal(handoffSchema.safeParse({ summary: "missing fields" }).success, false);
    assert.equal(lessonSchema.safeParse({ taskRestatement: "x" }).success, false);
  });
});

