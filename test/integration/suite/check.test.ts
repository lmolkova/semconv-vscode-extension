import * as assert from "assert";
import * as vscode from "vscode";

suite("weaver check", () => {
  // Commands register on activation; force it since this suite may run before any
  // YAML/Markdown document opens to trigger the activation events.
  suiteSetup(async () => {
    await vscode.extensions
      .getExtension("LiudmilaMolkova.opentelemetry-semconv-support")
      ?.activate();
  });

  test("contributes the Check Registry command", async () => {
    const cmds = await vscode.commands.getCommands(true);
    assert.ok(
      cmds.includes("semconv.checkRegistry"),
      "expected the extension to register semconv.checkRegistry",
    );
  });
});
