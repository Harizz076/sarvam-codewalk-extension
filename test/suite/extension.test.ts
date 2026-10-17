import * as assert from "assert";
import * as vscode from "vscode";

suite("Sarvam Codewalk extension", () => {
  test("registers every learner-facing command", async () => {
    const extension = vscode.extensions.getExtension("sarvam-codewalk.sarvam-codewalk");
    await extension?.activate();
    const commands = await vscode.commands.getCommands(true);
    for (const command of ["startRecording", "stopRecording", "useTranscript", "runApprovedTask", "playLesson", "deleteSession", "clearHistory", "setSarvamApiKey", "clearSarvamApiKey"]) {
      assert.ok(commands.includes(`sarvamCodewalk.${command}`));
    }
  });
});

