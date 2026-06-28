import * as path from "path";
import { ExtensionContext, workspace } from "vscode";
import {
  LanguageClient,
  LanguageClientOptions,
  ServerOptions,
  TransportKind,
} from "vscode-languageclient/node";

let client: LanguageClient;

export function activate(context: ExtensionContext): void {
  const serverModule = context.asAbsolutePath(path.join("out", "server", "server.js"));

  const serverOptions: ServerOptions = {
    run: { module: serverModule, transport: TransportKind.ipc },
    debug: {
      module: serverModule,
      transport: TransportKind.ipc,
      options: { execArgv: ["--nolazy", "--inspect=6009"] },
    },
  };

  const clientOptions: LanguageClientOptions = {
    // Attach to all YAML and Markdown; the server detects definition/2 YAML and
    // weaver snippets by content and filters out everything else.
    documentSelector: [
      { scheme: "file", language: "yaml" },
      { scheme: "file", pattern: "**/*.{yaml,yml}" },
      { scheme: "file", language: "markdown" },
      { scheme: "file", pattern: "**/*.md" },
    ],
    synchronize: {
      fileEvents: workspace.createFileSystemWatcher("**/*.{yaml,yml,md}"),
    },
  };

  client = new LanguageClient("semconv", "SemConv Language Server", serverOptions, clientOptions);
  void client.start();
}

export function deactivate(): Thenable<void> | undefined {
  return client?.stop();
}
