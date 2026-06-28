import { runTests } from "@vscode/test-electron";
import * as path from "path";
import { pathToFileURL } from "url";

async function main(): Promise<void> {
  try {
    // When the runner itself is launched from an Electron host (e.g. VS Code's
    // integrated terminal), ELECTRON_RUN_AS_NODE leaks into the spawned test
    // instance and makes its Electron run as plain Node — it then rejects every
    // VS Code CLI flag. Strip it so the test host boots as real VS Code.
    delete process.env.ELECTRON_RUN_AS_NODE;

    const extensionDevelopmentPath = path.resolve(__dirname, "../../..");
    const extensionTestsPath = path.resolve(__dirname, "./suite/index");
    // Open the whole fixtures tree: the valid registry plus the sibling
    // diagnostics/ fixture that carries the deliberately broken ref.
    const workspace = path.resolve(extensionDevelopmentPath, "test/fixtures");

    await runTests({
      version: "1.96.4",
      extensionDevelopmentPath,
      extensionTestsPath,
      launchArgs: [`--folder-uri=${pathToFileURL(workspace).href}`, "--disable-workspace-trust"],
    });
  } catch (err) {
    console.error("Integration tests failed:", err);
    process.exit(1);
  }
}

void main();
