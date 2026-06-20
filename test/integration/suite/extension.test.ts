import * as assert from 'assert';
import * as path from 'path';
import * as vscode from 'vscode';

const REG = path.resolve(__dirname, '../../../../test/fixtures/registry');
const uri = (name: string) => vscode.Uri.file(path.join(REG, name));

/** Wait until `predicate` is true or time runs out (server indexes async). */
async function eventually<T>(fn: () => PromiseLike<T>, ok: (v: T) => boolean, ms = 10000): Promise<T> {
  const deadline = Date.now() + ms;
  let last = await fn();
  while (!ok(last) && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 250));
    last = await fn();
  }
  return last;
}

function findOffset(doc: vscode.TextDocument, line: number, token: string): vscode.Position {
  const text = doc.lineAt(line).text;
  const col = text.indexOf(token);
  assert.ok(col >= 0, `token '${token}' not found on line ${line}`);
  return new vscode.Position(line, col + 1);
}

suite('semconv language features', () => {
  test('Go to Definition jumps from a ref to the attribute key in another file', async () => {
    const spans = await vscode.workspace.openTextDocument(uri('spans.yaml'));
    await vscode.window.showTextDocument(spans);

    // Position on a `ref: gen_ai.provider.name` line in spans.yaml.
    const line = spans
      .getText()
      .split('\n')
      .findIndex((l) => l.includes('ref: gen_ai.provider.name'));
    const pos = findOffset(spans, line, 'gen_ai.provider.name');

    const locations = await eventually(
      () =>
        vscode.commands.executeCommand<vscode.Location[]>(
          'vscode.executeDefinitionProvider',
          spans.uri,
          pos
        ),
      (l) => Array.isArray(l) && l.length > 0
    );

    assert.ok(locations.length > 0, 'expected a definition location');
    assert.strictEqual(path.basename(locations[0].uri.fsPath), 'registry.yaml');
  });

  test('Find All References lists refs across files', async () => {
    const registry = await vscode.workspace.openTextDocument(uri('registry.yaml'));
    const line = registry
      .getText()
      .split('\n')
      .findIndex((l) => l.includes('key: gen_ai.provider.name'));
    const pos = findOffset(registry, line, 'gen_ai.provider.name');

    const refs = await eventually(
      () =>
        vscode.commands.executeCommand<vscode.Location[]>(
          'vscode.executeReferenceProvider',
          registry.uri,
          pos
        ),
      (l) => Array.isArray(l) && l.length >= 2
    );

    assert.ok(refs.length >= 2, `expected >=2 references, got ${refs.length}`);
  });

  test('Diagnostics flag the deliberately broken ref', async () => {
    const spansUri = uri('spans.yaml');
    await vscode.workspace.openTextDocument(spansUri);

    const diags = await eventually(
      async () => vscode.languages.getDiagnostics(spansUri),
      (d) => d.some((x) => x.message.includes('gen_ai.does.not.exist'))
    );

    assert.ok(
      diags.some((d) => d.message.includes('gen_ai.does.not.exist')),
      'expected an unresolved-reference diagnostic'
    );
  });
});
