import { tinyassert } from "@hiogawa/utils";
import { range, sortBy } from "lodash";
import ts from "typescript";
import { DEFAULT_OPTIONS, groupNeighborBy } from "./misc";

// minimum parse data to allow sorting afterward
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

// cf. https://gist.github.com/hi-ogawa/cb338b4765d25321b120b2a47819abcc
class TransformerWrapper {
  result: ImportDeclarationInfo[][] = [];

  getTransformer =
    (): ts.TransformerFactory<ts.SourceFile> =>
    (_ctx: ts.TransformationContext) =>
    (sourceFile: ts.SourceFile) => {
      // we don't have to visit all AST recursively
      this.result = extraceImportDeclaration(sourceFile);
      return sourceFile;
    };
}

function extraceImportDeclaration(
  node: ts.SourceFile
): ImportDeclarationInfo[][] {
  const groups: [boolean, ts.Statement[]][] = groupNeighborBy(
    [...node.statements],
    (stmt) =>
      ts.isImportDeclaration(stmt) &&
      !DEFAULT_OPTIONS.isortIgnoreComments.some((comment) =>
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

//
// ts transformer driver
//

export function tsAnalyze(code: string) {
  const wrapper = new TransformerWrapper();
  const result = ts.transpileModule(code, {
    compilerOptions: {},
    fileName: "__dummy.tsx",
    reportDiagnostics: true,
    transformers: {
      before: [wrapper.getTransformer()],
    },
  });
  if (result.diagnostics && result.diagnostics?.length > 0) {
    throw new Error("isort-ts parse error");
  }
  return wrapper.result;
}

//
// codemod
//

export function tsTransformIsort(code: string): string {
  const groups = tsAnalyze(code);
  for (const group of groups) {
    if (DEFAULT_OPTIONS.isortSpecifiers) {
      for (const decl of group) {
        if (decl.specifiers) {
          code = sortImportSpecifiers(code, decl.specifiers);
        }
      }
    }
    code = sortImportDeclarations(code, group);
  }
  return code;
}

function sortImportDeclarations(
  code: string,
  nodes: ImportDeclarationInfo[]
): string {
  const sorted = sortBy(
    nodes,
    (node) =>
      DEFAULT_OPTIONS.isortOrder.findIndex((re) => node.source.match(re)),
    (node) =>
      DEFAULT_OPTIONS.isortCaseInsensitive
        ? node.source.toLowerCase()
        : node.source
  );
  return replaceSortedNodes(code, nodes, sorted);
}

function sortImportSpecifiers(
  code: string,
  nodes: ImportSpecifierInfo[]
): string {
  const sorted = sortBy(nodes, (node) =>
    DEFAULT_OPTIONS.isortCaseInsensitive ? node.name.toLowerCase() : node.name
  );
  return replaceSortedNodes(code, nodes, sorted);
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
