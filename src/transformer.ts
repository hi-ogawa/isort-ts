import { tinyassert } from "@hiogawa/utils";
import { range, sortBy } from "lodash";
import ts from "typescript";
import { DEFAULT_OPTIONS, IsortOptions, groupNeighborBy } from "./misc";

// ts transformer only collects minimal AST data to allow sorting solely based on string afterward

interface ImportDeclarationInfo {
  start: number;
  end: number;
  source: string;
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

  run(code: string): string {
    const groups = this.analyze(code);
    for (const group of groups) {
      if (!this.options.isortIgnoreMemberSort) {
        for (const decl of group) {
          if (decl.specifiers) {
            code = this.sortImportSpecifiers(code, decl.specifiers);
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
      fileName: "__dummy.tsx",
      reportDiagnostics: true,
      transformers: {
        before: [transformer],
      },
    });
    if (transpiled.diagnostics && transpiled.diagnostics?.length > 0) {
      // TODO: display error position etc..?
      throw new Error("isort-ts parse error");
    }

    return result;
  }

  sortImportDeclarations(code: string, nodes: ImportDeclarationInfo[]): string {
    const sorted = sortBy(
      nodes,
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
      const info: ImportDeclarationInfo = {
        start: node.getStart(),
        end: node.end,
        source: node.moduleSpecifier.text,
        specifiers: extraceImportSpecifier(node),
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
