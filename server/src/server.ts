import fg from "fast-glob";
import * as fs from "fs/promises";
import {
  createConnection,
  DefinitionParams,
  Diagnostic,
  DiagnosticSeverity,
  DocumentSymbol,
  DocumentSymbolParams,
  FileChangeType,
  Hover,
  HoverParams,
  InitializeParams,
  InitializeResult,
  Location,
  MarkupKind,
  PrepareRenameParams,
  ProposedFeatures,
  ReferenceParams,
  RenameParams,
  TextDocuments,
  TextDocumentSyncKind,
  WorkspaceSymbol,
  WorkspaceSymbolParams,
} from "vscode-languageserver/node";
import { TextDocument } from "vscode-languageserver-textdocument";
import { URI } from "vscode-uri";

import { defKindToSymbolKind } from "./document-symbols";
import { RegistryIndex } from "./index";
import { pathAtParsed } from "./key-path";
import { manifestDiagnostics } from "./manifest";
import { extractMarkdown, looksLikeWeaverDoc } from "./markdown";
import { extract } from "./model";
import { looksLikeSemconv, ParsedSemconv, parseSemconv } from "./parser";
import { buildRenameEdits, mentionRanges, mentionsAt, prepareRename } from "./rename";
import { definitionResolver, KeyDoc, manifestResolver } from "./schema-resolver";
import { schemaDiagnostics } from "./schema-validate";
import {
  buildMarkdownSemanticTokens,
  buildSemanticTokens,
  semanticTokensLegend,
} from "./semantic-tokens";
import { Definition, RESOLUTION } from "./types";

const connection = createConnection(ProposedFeatures.all);
const documents = new TextDocuments(TextDocument);
const index = new RegistryIndex();

let workspaceRoots: string[] = [];

const parseCache = new Map<string, { version: number; parsed: ParsedSemconv }>();

// Bound workspace/symbol responses; clients narrow by typing more of the query.
const MAX_WORKSPACE_SYMBOLS = 1000;

function isMarkdown(uri: string): boolean {
  return uri.endsWith(".md");
}

function parsedFor(doc: TextDocument): ParsedSemconv {
  const cached = parseCache.get(doc.uri);
  if (cached && cached.version === doc.version) return cached.parsed;
  const parsed = parseSemconv(doc.getText());
  parseCache.set(doc.uri, { version: doc.version, parsed });
  return parsed;
}

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
      documentSymbolProvider: true,
      workspaceSymbolProvider: true,
      renameProvider: { prepareProvider: true },
      semanticTokensProvider: { legend: semanticTokensLegend, full: true },
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
      files = await fg(["**/*.yaml", "**/*.yml", "**/*.md"], {
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
        const uri = URI.file(file).toString();
        if (documents.get(uri)) continue; // open docs are indexed from their buffer
        if (isMarkdown(uri)) {
          if (looksLikeWeaverDoc(text)) {
            const refs = extractMarkdown(text, uri);
            if (refs.length) index.setDocument(uri, [], refs, false);
          }
          continue;
        }
        if (!looksLikeSemconv(text)) continue;
        const { isSemconv, defs, refs, hasImports } = extract(text, uri);
        if (isSemconv) index.setDocument(uri, defs, refs, hasImports);
      } catch {
        // ignore unreadable / unparseable files
      }
    }
  }
}

function indexDocument(doc: TextDocument): void {
  if (isMarkdown(doc.uri)) {
    const refs = extractMarkdown(doc.getText(), doc.uri);
    if (refs.length) index.setDocument(doc.uri, [], refs, false);
    else index.removeDocument(doc.uri);
    return;
  }
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
  parseCache.delete(event.document.uri);
  // Keep the on-disk version indexed so cross-file nav still works.
  scanFile(event.document.uri).catch(() => undefined);
});

async function scanFile(uri: string): Promise<void> {
  try {
    const text = await fs.readFile(URI.parse(uri).fsPath, "utf8");
    if (isMarkdown(uri)) {
      const refs = extractMarkdown(text, uri);
      if (refs.length) index.setDocument(uri, [], refs, false);
      else index.removeDocument(uri);
      return;
    }
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

  if (isMarkdown(doc.uri)) {
    void connection.sendDiagnostics({ uri: doc.uri, diagnostics });
    return;
  }

  for (const def of index.duplicateDefinitions(doc.uri)) {
    diagnostics.push({
      severity: DiagnosticSeverity.Warning,
      range: def.nameRange,
      message: `Duplicate ${def.kind} definition: '${def.id}' is defined more than once.`,
      source: "semconv",
    });
  }

  for (const finding of manifestDiagnostics(parsedFor(doc))) {
    diagnostics.push({
      severity: DiagnosticSeverity.Warning,
      range: finding.range,
      message: finding.message,
      source: "semconv",
    });
  }

  for (const finding of schemaDiagnostics(parsedFor(doc))) {
    diagnostics.push({
      severity: DiagnosticSeverity.Error,
      range: finding.range,
      message: finding.message,
      source: "semconv",
    });
  }

  void connection.sendDiagnostics({ uri: doc.uri, diagnostics });
}

connection.onDefinition(async (params: DefinitionParams): Promise<Location[]> => {
  const symbol = index.symbolAt(params.textDocument.uri, params.position);
  if (symbol) {
    if (symbol.kind === "reference") {
      return index
        .definitionsFor(symbol.ref.id, RESOLUTION[symbol.ref.refKind])
        .map((d) => Location.create(d.uri, d.nameRange));
    }
    // On a definition token, jump to itself (lets editors confirm the symbol).
    return [Location.create(symbol.def.uri, symbol.def.nameRange)];
  }

  // Off any structural symbol: jump from a `key`/{key} prose mention in
  // brief/note to whatever it names, if the wrapped id resolves to a definition.
  if (isMarkdown(params.textDocument.uri)) return [];
  const text = await docText(params.textDocument.uri);
  if (!text) return [];
  for (const { id } of mentionsAt(text, params.position)) {
    const defs = index.definitionsFor(id);
    if (defs.length) return defs.map((d) => Location.create(d.uri, d.nameRange));
  }
  return [];
});

connection.onReferences(async (params: ReferenceParams): Promise<Location[]> => {
  const symbol = index.symbolAt(params.textDocument.uri, params.position);
  if (!symbol) return [];

  const id = symbol.kind === "definition" ? symbol.def.id : symbol.ref.id;
  const defKind = symbol.kind === "definition" ? symbol.def.kind : undefined;
  const locations = index.referencesFor(id, defKind).map((r) => Location.create(r.uri, r.range));

  for (const uri of index.documentUris()) {
    if (isMarkdown(uri)) continue; // weaver refs already covered via referencesFor
    const text = await docText(uri);
    if (!text) continue;
    for (const range of mentionRanges(text, id)) locations.push(Location.create(uri, range));
  }

  if (params.context.includeDeclaration) {
    const kinds = symbol.kind === "definition" ? [symbol.def.kind] : RESOLUTION[symbol.ref.refKind];
    for (const d of index.definitionsFor(id, kinds)) {
      locations.push(Location.create(d.uri, d.nameRange));
    }
  }
  return locations;
});

connection.onDocumentSymbol((params: DocumentSymbolParams): DocumentSymbol[] =>
  index.documentSymbols(params.textDocument.uri),
);

connection.onWorkspaceSymbol((params: WorkspaceSymbolParams): WorkspaceSymbol[] =>
  index
    .searchDefinitions(params.query, MAX_WORKSPACE_SYMBOLS)
    .map((d) => WorkspaceSymbol.create(d.id, defKindToSymbolKind(d.kind), d.uri, d.nameRange)),
);

connection.onPrepareRename((params: PrepareRenameParams) =>
  prepareRename(index, params.textDocument.uri, params.position),
);

connection.onRenameRequest((params: RenameParams) =>
  buildRenameEdits(index, params.textDocument.uri, params.position, params.newName, docText),
);

async function docText(uri: string): Promise<string | undefined> {
  const open = documents.get(uri);
  if (open) return open.getText();
  try {
    return await fs.readFile(URI.parse(uri).fsPath, "utf8");
  } catch {
    return undefined;
  }
}

connection.languages.semanticTokens.on((params) => {
  const doc = documents.get(params.textDocument.uri);
  if (!doc) return { data: [] };
  if (isMarkdown(doc.uri)) {
    const { refs } = index.localSymbols(doc.uri);
    return buildMarkdownSemanticTokens(refs, new Set(index.unresolvedReferences(doc.uri)));
  }
  // Plain YAML (no kind) is left to the YAML extension.
  if (!parsedFor(doc).kind) return { data: [] };
  const { defs, refs } = index.localSymbols(doc.uri);
  const unresolved = new Set(index.unresolvedReferences(doc.uri));
  return buildSemanticTokens(parsedFor(doc), defs, refs, unresolved, (id) =>
    index.hasDefinition(id),
  );
});

connection.onHover((params: HoverParams): Hover | null => {
  const symbol = index.symbolAt(params.textDocument.uri, params.position);
  if (symbol) {
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
  }

  // No id/ref symbol here — try schema-key (or enum-value) hover (YAML only).
  if (isMarkdown(params.textDocument.uri)) return null;
  return schemaHover(params);
});

/** Hover docs for a YAML schema key, or an enum value, pulled from the bundled schema. */
function schemaHover(params: HoverParams): Hover | null {
  const doc = documents.get(params.textDocument.uri);
  if (!doc) return null;
  const hit = pathAtParsed(parsedFor(doc), params.position);
  if (!hit) return null;
  const resolver = hit.kind === "manifest" ? manifestResolver : definitionResolver;
  const info = resolver.describeKeyPath(hit.steps);
  if (!info) return null;

  if (hit.onValue) {
    // Annotate a value only when its field is a closed enum and the value is a member.
    if (!hit.value || !info.enumValues?.includes(hit.value)) return null;
    return {
      contents: {
        kind: MarkupKind.Markdown,
        value: renderEnumValueHover(hit.key, hit.value, info),
      },
    };
  }
  if (!info.description && !info.enumValues) return null;
  return { contents: { kind: MarkupKind.Markdown, value: renderKeyHover(hit.key, info) } };
}

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

function renderKeyHover(key: string, info: KeyDoc): string {
  const lines: string[] = [`**${key}**${info.deprecated ? " _(deprecated)_" : ""}`];
  if (info.description) lines.push("", info.description);
  if (info.enumValues?.length) {
    lines.push("", `Allowed values: ${info.enumValues.map((v) => `\`${v}\``).join(", ")}`);
  }
  return lines.join("\n");
}

function renderEnumValueHover(key: string, value: string, info: KeyDoc): string {
  const lines: string[] = [`**${value}** — a \`${key}\` value`];
  if (info.description) lines.push("", info.description);
  if (info.enumValues?.length) {
    lines.push("", `Allowed values: ${info.enumValues.map((v) => `\`${v}\``).join(", ")}`);
  }
  return lines.join("\n");
}

documents.listen(connection);
connection.listen();
