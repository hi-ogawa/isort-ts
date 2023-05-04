import { groupBy, range, sortBy, tinyassert } from "@hiogawa/utils";
import ts from "typescript";
import { DEFAULT_OPTIONS, IsortOptions, groupNeighborBy } from "./misc";

// ts transformer only collects minimal AST data to allow sorting solely based on string afterward

interface ImportDeclarationInfo {
  start: number;
  end: number;
  source: string;
  clause?: ImportClauseInfo; // side effect import when undefined
}

interface ImportClauseInfo {
  name?: string; // default name
  specifiers?: ImportSpecifierInfo[];
}

interface ImportSpecifierInfo {
  start: number;
  end: number;
  name: string;
}

export function tsTransformIsort(
  code: string,
  options: IsortOptions = DEFAULT_OPTIONS
): string {
  return new TransformIsort(options).run(code);
}

export function tsAnalyze(
  code: string,
  options: IsortOptions = DEFAULT_OPTIONS
): ImportDeclarationInfo[][] {
  return new TransformIsort(options).analyze(code);
}

class TransformIsort {
  constructor(private options: IsortOptions) {}

  run(code: string) {
    const groups = this.analyze(code);

    if (!this.options.isortIgnoreDuplicateSource) {
      // check duplicate import source
      const duplicates = findDuplicateSource(groups);
      if (duplicates) {
        // TODO(refactor): probably we shouldn't abuse error to workaround control flow
        throw new DuplicateSourceError(code, duplicates);
      }
    }

    for (const group of groups) {
      if (!this.options.isortIgnoreMemberSort) {
        for (const decl of group) {
          if (decl.clause?.specifiers) {
            code = this.sortImportSpecifiers(code, decl.clause.specifiers);
          }
        }
      }
      if (!this.options.isortIgnoreDeclarationSort) {
        code = this.sortImportDeclarations(code, group);
      }
    }

    return code;
  }

  analyze(code: string): ImportDeclarationInfo[][] {
    // runs both in tsx and ts mode since `tsx` is not a super set of `ts`
    // just like what prettier does in https://github.com/prettier/prettier/blob/bc098779c4e457b1454895973196cffb3b1cdedf/src/language-js/parse/typescript.js#L40-L45
    try {
      return this.analyzeInternal(code, true);
    } catch {}
    return this.analyzeInternal(code, false);
  }

  analyzeInternal(code: string, tsx: boolean): ImportDeclarationInfo[][] {
    let result: ImportDeclarationInfo[][] = [];

    // cf. https://gist.github.com/hi-ogawa/cb338b4765d25321b120b2a47819abcc

    // define typescript transformer
    const transformer: ts.TransformerFactory<ts.SourceFile> =
      (_ctx: ts.TransformationContext) => (sourceFile: ts.SourceFile) => {
        // we don't have to visit all AST recursively
        result = extractImportDeclaration(sourceFile, this.options);
        return sourceFile;
      };

    // run transpilation with transformer
    const transpiled = ts.transpileModule(code, {
      compilerOptions: {},
      fileName: tsx ? "__dummy.tsx" : "__dummy.ts",
      reportDiagnostics: true,
      transformers: {
        before: [transformer],
      },
    });
    if (transpiled.diagnostics && transpiled.diagnostics?.length > 0) {
      throw new ParseError(code, transpiled.diagnostics);
    }

    return result;
  }

  sortImportDeclarations(code: string, nodes: ImportDeclarationInfo[]): string {
    const sorted = sortBy(
      nodes,
      (node) => (node.clause ? 1 : 0), // side effect first
      (node) =>
        this.options.isortOrder.findIndex((re) => node.source.match(re)),
      (node) =>
        this.options.isortIgnoreCase ? node.source.toLowerCase() : node.source
    );
    return replaceSortedNodes(code, nodes, sorted);
  }

  sortImportSpecifiers(code: string, nodes: ImportSpecifierInfo[]): string {
    const sorted = sortBy(nodes, (node) =>
      this.options.isortIgnoreCase ? node.name.toLowerCase() : node.name
    );
    return replaceSortedNodes(code, nodes, sorted);
  }
}

function extractImportDeclaration(
  node: ts.SourceFile,
  options: IsortOptions
): ImportDeclarationInfo[][] {
  const groups: [boolean, ts.Statement[]][] = groupNeighborBy(
    [...node.statements],
    (stmt) =>
      ts.isImportDeclaration(stmt) &&
      !options.isortIgnoreComments.some((comment) =>
        getTrivia(stmt).includes(comment)
      )
  );
  const result: ImportDeclarationInfo[][] = [];
  for (const [ok, statements] of groups) {
    if (!ok) {
      continue;
    }
    const resultGroup = statements.map((node) => {
      tinyassert(ts.isImportDeclaration(node));
      tinyassert(ts.isStringLiteral(node.moduleSpecifier));
      node.importClause;
      const info: ImportDeclarationInfo = {
        start: node.getStart(),
        end: node.end,
        source: node.moduleSpecifier.text,
        clause: node.importClause && {
          name: node.importClause.name?.text,
          specifiers: extraceImportSpecifier(node),
        },
      };
      return info;
    });
    result.push(resultGroup);
  }
  return result;
}

function extraceImportSpecifier(
  node: ts.ImportDeclaration
): ImportSpecifierInfo[] | undefined {
  const namedImports = node.importClause?.namedBindings;
  if (namedImports && ts.isNamedImports(namedImports)) {
    return namedImports.elements.map((node) => ({
      start: node.getStart(),
      end: node.end,
      name: node.propertyName?.text ?? node.name.text,
    }));
  }
  return;
}

function getTrivia(node: ts.Node): string {
  return node.getFullText().slice(0, node.getLeadingTriviaWidth());
}

// keep existing trivia fixed since this seems the easiest way to handle new lines naturally
//   e.g.
//     (trivia y)     (trivia y)
//     (import y)  ⇒  (import x)
//     (trivia x)     (trivia x)
//     (import x)     (import y)
function replaceSortedNodes(
  code: string,
  nodes: { start: number; end: number }[],
  sorted: { start: number; end: number }[]
): string {
  const start = nodes[0]?.start;
  const end = nodes.at(-1)?.end;
  tinyassert(typeof start === "number");
  tinyassert(typeof end === "number");

  const ranges: [number, number][] = [];
  for (const i of range(nodes.length)) {
    ranges.push([sorted[i]!.start, sorted[i]!.end]);
    if (i < nodes.length - 1) {
      ranges.push([nodes[i]!.end, nodes[i + 1]!.start]);
    }
  }

  const result = [[0, start], ...ranges, [end, code.length]]
    .map((range) => code.slice(...range))
    .join("");
  return result;
}

//
// base error
//

export abstract class IsortError extends Error {
  abstract getDiagnostics(): DiagnosticsInfo[];
}

//
// duplicate source check
//

function findDuplicateSource(groups: ImportDeclarationInfo[][]) {
  const groupBySource = groupBy(groups.flat(), (decl) => decl.source);

  const duplicates = [...groupBySource.entries()]
    .map(([source, decls]) => ({ source, decls }))
    .filter((data) => data.decls.length >= 2);

  if (duplicates.length > 0) {
    return duplicates;
  }
  return;
}

interface DuplicateSourceInfo {
  source: string;
  decls: ImportDeclarationInfo[];
}

export class DuplicateSourceError extends IsortError {
  constructor(
    private input: string,
    private duplicates: DuplicateSourceInfo[]
  ) {
    super(DuplicateSourceError.name);
  }

  getDiagnostics(): DiagnosticsInfo[] {
    return this.duplicates.flatMap(({ decls }) =>
      decls.map((decl) => {
        const [line, column] = resolvePosition(this.input, decl.start);
        return {
          message: `Duplicate import source "${decl.source}"`,
          line,
          column,
        };
      })
    );
  }
}

//
// parse error
//

export class ParseError extends IsortError {
  constructor(private input: string, private diagnostics: ts.Diagnostic[]) {
    super(ParseError.name);
  }

  getDiagnostics(): DiagnosticsInfo[] {
    return this.diagnostics.map((d) => formatDiagnostic(this.input, d));
  }
}

interface DiagnosticsInfo {
  message?: string;
  line: number;
  column: number;
}

function formatDiagnostic(
  input: string,
  diagnostic: ts.Diagnostic
): DiagnosticsInfo {
  const { messageText, start } = diagnostic;
  tinyassert(typeof start === "number");
  const [line, column] = resolvePosition(input, start);
  return {
    message: typeof messageText === "string" ? messageText : undefined,
    line,
    column,
  };
}

function resolvePosition(input: string, offset: number): [number, number] {
  tinyassert(offset < input.length);

  // TODO: support CRLF?
  const acc = [0];
  for (const s of input.split("\n")) {
    acc.push(acc.at(-1)! + s.length + 1);
  }

  const line = acc.findIndex((s) => offset < s);
  tinyassert(line > 0);
  const column = offset - acc[line - 1]!;

  return [line, column];
}
