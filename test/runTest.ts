import * as path from "path";
import { existsSync } from "fs";
import { runTests } from "@vscode/test-electron";

async function main(): Promise<void> {
  const extensionDevelopmentPath = path.resolve(__dirname, "../..");
  const extensionTestsPath = path.resolve(__dirname, "suite/index");
  const downloadedCli = path.join(extensionDevelopmentPath, ".vscode-test", "vscode-linux-x64-1.142.0", "bin", "code");
  await runTests({ extensionDevelopmentPath, extensionTestsPath, vscodeExecutablePath: existsSync(downloadedCli) ? downloadedCli : undefined, launchArgs: ["--disable-extensions"] });
}

void main();
