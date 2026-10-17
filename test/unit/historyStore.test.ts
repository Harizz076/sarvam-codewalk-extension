import * as assert from "assert";
import { LocalHistoryStore } from "../../src/services/LocalHistoryStore";

describe("LocalHistoryStore", () => {
  it("deletes only the requested text-only session", async () => {
    let value: unknown = [];
    const store = new LocalHistoryStore({ get: () => value, update: async (_key: string, next: unknown) => { value = next; } } as never);
    const lesson = { taskRestatement: "task", whatChanged: "changed", why: "why", concept: "concept", verification: "test", tryNext: "next", limitation: null, ttsScript: "बोलो" };
    await store.add({ id: "one", createdAt: "now", approvedTask: "task", lesson, changedFiles: [], reportedTest: "none", outcome: "completed" });
    await store.add({ id: "two", createdAt: "now", approvedTask: "task", lesson, changedFiles: [], reportedTest: "none", outcome: "completed" });
    await store.delete("one");
    assert.deepStrictEqual(store.list().map((item) => item.id), ["two"]);
  });
});

