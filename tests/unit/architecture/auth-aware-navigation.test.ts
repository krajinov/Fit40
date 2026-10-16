/**
 * Architectural exceptions to behavioral testing: dependency boundaries and
 * ownership of authentication cannot be inferred from rendered DOM. Parse the
 * TypeScript tree so these guards do not depend on JSX or source formatting.
 */
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const NAV_MODEL = 'src/components/shared/nav-items.ts';
const SHELL_FILES = [
  NAV_MODEL,
  'src/components/shared/AppNavLinks.tsx',
  'src/components/shared/MobileTabBar.tsx',
  'src/components/shared/AppHeader.tsx',
  'src/components/shared/MobileHeader.tsx',
];

function parse(file: string): ts.SourceFile {
  return ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
}

function imports(source: ts.SourceFile): string[] {
  return source.statements.flatMap((statement) =>
    ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)
      ? [statement.moduleSpecifier.text]
      : [],
  );
}

function calls(source: ts.SourceFile): string[] {
  const names: string[] = [];
  function visit(node: ts.Node): void {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      names.push(node.expression.text);
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return names;
}

describe('navigation dependency and authentication boundaries', () => {
  it('keeps the shared shell independent of feature modules', () => {
    for (const file of SHELL_FILES) {
      expect(imports(parse(file)).filter((name) => name.startsWith('@/features/')), file).toEqual([]);
    }
  });

  it('keeps the navigation model usable on the server without router or React state', () => {
    const model = parse(NAV_MODEL);
    expect(imports(model).filter((name) => name.startsWith('next/')), NAV_MODEL).toEqual([]);
    const directives = model.statements.flatMap((statement) =>
      ts.isExpressionStatement(statement) && ts.isStringLiteral(statement.expression)
        ? [statement.expression.text]
        : [],
    );
    expect(directives).not.toContain('use client');
    expect(directives).not.toContain('use server');
    expect(calls(model).filter((name) => /^use(State|Effect|Reducer|SyncExternalStore)$/.test(name)))
      .toEqual([]);
  });

  it('resolves authentication once in the layout rather than fetching it in the shared shell', () => {
    // A DOM test could pass even if every header fetched its own session.
    for (const file of SHELL_FILES) {
      expect(calls(parse(file)).filter((name) =>
        ['getCurrentUser', 'requireUser', 'fetch'].includes(name)), file).toEqual([]);
    }
    const layout = parse('src/app/(app)/layout.tsx');
    expect(calls(layout).filter((name) => name === 'getCurrentUser')).toHaveLength(1);
  });
});
