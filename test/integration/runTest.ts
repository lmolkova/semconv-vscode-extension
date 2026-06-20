import { runTests } from "@vscode/test-electron";
import * as path from "path";

async function main(): Promise<void> {
  try {
    const extensionDevelopmentPath = path.resolve(__dirname, "../../..");
    const extensionTestsPath = path.resolve(__dirname, "./suite/index");
    const workspace = path.resolve(extensionDevelopmentPath, "test/fixtures/registry");

    await runTests({
      // Pin a known-good build; newer VS Code + older test-electron combos
      // can mis-handle the workspace positional arg.
      version: "1.96.4",
      extensionDevelopmentPath,
      extensionTestsPath,
      launchArgs: [workspace, "--disable-workspace-trust"],
    });
  } catch (err) {
    console.error("Integration tests failed:", err);
    process.exit(1);
  }
}

void main();
