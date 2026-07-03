import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";

const FIXTURES = path.resolve(__dirname, "../../../../test/fixtures");

interface McpConfig {
  mcpServers?: Record<string, { command: string; args: string[] }>;
}

async function eventually<T>(fn: () => T, ok: (v: T) => boolean, ms = 10000): Promise<T> {
  const deadline = Date.now() + ms;
  let last = fn();
  while (!ok(last) && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 250));
    last = fn();
  }
  return last;
}

suite("weaver MCP", () => {
  // Points weaver.path at a stub so resolution skips the version probe and Docker,
  // and the written config is deterministic regardless of the host's tooling.
  const stub = path.join(os.tmpdir(), "semconv-weaver-stub");
  const configPath = path.join(FIXTURES, ".mcp.json");

  suiteSetup(async () => {
    fs.writeFileSync(stub, "");
    await vscode.workspace
      .getConfiguration("semconv")
      .update("weaver.path", stub, vscode.ConfigurationTarget.Global);
  });

  suiteTeardown(async () => {
    fs.rmSync(stub, { force: true });
    fs.rmSync(configPath, { force: true });
    await vscode.workspace
      .getConfiguration("semconv")
      .update("weaver.path", undefined, vscode.ConfigurationTarget.Global);
  });

  test("contributes the Add Weaver MCP Server command", async () => {
    const cmds = await vscode.commands.getCommands(true);
    assert.ok(
      cmds.includes("semconv.addWeaverMcpServer"),
      "expected the extension to register semconv.addWeaverMcpServer",
    );
  });

  test("adds a weaver server entry per registry to the target agent config", async () => {
    // Not awaited: addServer ends on a showInformationMessage that stays pending
    // until dismissed, so the command promise never resolves under test.
    void vscode.commands.executeCommand("semconv.addWeaverMcpServer", "claude");

    const config = await eventually<McpConfig>(
      () => {
        try {
          return JSON.parse(fs.readFileSync(configPath, "utf8")) as McpConfig;
        } catch {
          return {};
        }
      },
      (c) => !!c.mcpServers?.["semconv-weaver"],
    );

    const server = config.mcpServers?.["semconv-weaver"];
    assert.ok(server, "expected a semconv-weaver entry in .mcp.json");
    assert.strictEqual(server.command, stub);
    assert.deepStrictEqual(server.args, ["registry", "mcp", "--v2", "-r", "registry"]);
  });
});
