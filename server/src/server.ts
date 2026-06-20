import fg from "fast-glob";
import * as fs from "fs/promises";
import {
  createConnection,
  DefinitionParams,
  Diagnostic,
  DiagnosticSeverity,
  FileChangeType,
  Hover,
  HoverParams,
  InitializeParams,
  InitializeResult,
  Location,
  MarkupKind,
  ProposedFeatures,
  ReferenceParams,
  TextDocuments,
  TextDocumentSyncKind,
} from "vscode-languageserver/node";
import { TextDocument } from "vscode-languageserver-textdocument";
import { URI } from "vscode-uri";

import { RegistryIndex } from "./index";
import { extract } from "./model";
import { looksLikeSemconv } from "./parser";
import { Definition, RESOLUTION } from "./types";

const connection = createConnection(ProposedFeatures.all);
const documents = new TextDocuments(TextDocument);
const index = new RegistryIndex();

let workspaceRoots: string[] = [];

connection.onInitialize((params: InitializeParams): InitializeResult => {
  workspaceRoots = (params.workspaceFolders ?? [])
    .map((f) => URI.parse(f.uri).fsPath)
    .filter(Boolean);
  return {
    capabilities: {
      textDocumentSync: TextDocumentSyncKind.Incremental,
      definitionProvider: true,
      referencesProvider: true,
      hoverProvider: true,
    },
  };
});

connection.onInitialized(() => {
  void scanWorkspace().then(() => {
    for (const doc of documents.all()) {
      indexDocument(doc);
      validate(doc);
    }
  });
});

async function scanWorkspace(): Promise<void> {
  for (const root of workspaceRoots) {
    let files: string[];
    try {
      files = await fg(["**/*.yaml", "**/*.yml"], {
        cwd: root,
        absolute: true,
        ignore: ["**/node_modules/**", "**/.git/**"],
      });
    } catch {
      continue;
    }
    for (const file of files) {
      try {
        const text = await fs.readFile(file, "utf8");
        if (!looksLikeSemconv(text)) continue;
        const uri = URI.file(file).toString();
        if (documents.get(uri)) continue; // open docs are indexed from their buffer
        const { isSemconv, defs, refs, hasImports } = extract(text, uri);
        if (isSemconv) index.setDocument(uri, defs, refs, hasImports);
      } catch {
        // ignore unreadable / unparseable files
      }
    }
  }
}

function indexDocument(doc: TextDocument): void {
  const { isSemconv, defs, refs, hasImports } = extract(doc.getText(), doc.uri);
  if (isSemconv) {
    index.setDocument(doc.uri, defs, refs, hasImports);
  } else {
    index.removeDocument(doc.uri);
  }
}

documents.onDidChangeContent((change) => {
  indexDocument(change.document);
  validate(change.document);
});

connection.onDidChangeWatchedFiles((params) => {
  void (async () => {
    for (const change of params.changes) {
      if (documents.get(change.uri)) continue; // open buffers win
      if (change.type === FileChangeType.Deleted) {
        index.removeDocument(change.uri);
      } else {
        await scanFile(change.uri);
      }
    }
  })();
});

documents.onDidClose((event) => {
  // Keep the on-disk version indexed so cross-file nav still works.
  scanFile(event.document.uri).catch(() => undefined);
});

async function scanFile(uri: string): Promise<void> {
  try {
    const text = await fs.readFile(URI.parse(uri).fsPath, "utf8");
    const { isSemconv, defs, refs, hasImports } = extract(text, uri);
    if (isSemconv) index.setDocument(uri, defs, refs, hasImports);
    else index.removeDocument(uri);
  } catch {
    index.removeDocument(uri);
  }
}

function validate(doc: TextDocument): void {
  const diagnostics: Diagnostic[] = [];

  for (const ref of index.unresolvedReferences(doc.uri)) {
    diagnostics.push({
      severity: DiagnosticSeverity.Warning,
      range: ref.range,
      message: `Unresolved reference: '${ref.id}' is not defined in this registry.`,
      source: "semconv",
    });
  }

  for (const def of index.duplicateDefinitions(doc.uri)) {
    diagnostics.push({
      severity: DiagnosticSeverity.Warning,
      range: def.nameRange,
      message: `Duplicate ${def.kind} definition: '${def.id}' is defined more than once.`,
      source: "semconv",
    });
  }

  void connection.sendDiagnostics({ uri: doc.uri, diagnostics });
}

connection.onDefinition((params: DefinitionParams): Location[] => {
  const symbol = index.symbolAt(params.textDocument.uri, params.position);
  if (!symbol) return [];
  if (symbol.kind === "reference") {
    return index
      .definitionsFor(symbol.ref.id, RESOLUTION[symbol.ref.refKind])
      .map((d) => Location.create(d.uri, d.nameRange));
  }
  // On a definition token, jump to itself (lets editors confirm the symbol).
  return [Location.create(symbol.def.uri, symbol.def.nameRange)];
});

connection.onReferences((params: ReferenceParams): Location[] => {
  const symbol = index.symbolAt(params.textDocument.uri, params.position);
  if (!symbol) return [];

  const id = symbol.kind === "definition" ? symbol.def.id : symbol.ref.id;
  const defKind = symbol.kind === "definition" ? symbol.def.kind : undefined;
  const locations = index.referencesFor(id, defKind).map((r) => Location.create(r.uri, r.range));

  if (params.context.includeDeclaration) {
    const kinds = symbol.kind === "definition" ? [symbol.def.kind] : RESOLUTION[symbol.ref.refKind];
    for (const d of index.definitionsFor(id, kinds)) {
      locations.push(Location.create(d.uri, d.nameRange));
    }
  }
  return locations;
});

connection.onHover((params: HoverParams): Hover | null => {
  const symbol = index.symbolAt(params.textDocument.uri, params.position);
  if (!symbol) return null;

  let def: Definition | undefined;
  if (symbol.kind === "definition") {
    def = symbol.def;
  } else {
    def = index.definitionsFor(symbol.ref.id, RESOLUTION[symbol.ref.refKind])[0];
  }
  if (!def) {
    if (symbol.kind === "reference") {
      return {
        contents: {
          kind: MarkupKind.Markdown,
          value: `**${symbol.ref.id}**\n\n_unresolved reference_`,
        },
      };
    }
    return null;
  }

  return { contents: { kind: MarkupKind.Markdown, value: renderHover(def) } };
});

function renderHover(def: Definition): string {
  const lines: string[] = [`**${def.id}** \`${def.kind}\``];
  const meta: string[] = [];
  if (def.type) meta.push(`type: \`${def.type}\``);
  if (def.instrument) meta.push(`instrument: \`${def.instrument}\``);
  if (def.unit) meta.push(`unit: \`${def.unit}\``);
  if (def.stability) meta.push(`stability: \`${def.stability}\``);
  if (meta.length) lines.push(meta.join(" · "));
  if (def.brief) lines.push("", def.brief);
  return lines.join("\n");
}

documents.listen(connection);
connection.listen();
