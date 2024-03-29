import { builtinModules } from "node:module";

//
// options
//

// relevant options of exising tools
//   https://github.com/import-js/eslint-plugin-import/blob/main/docs/rules/order.md
//   https://eslint.org/docs/latest/rules/sort-imports
//   https://github.com/trivago/prettier-plugin-sort-imports/blob/89d66f706423e44f29d525529af37e5d41a74133/src/index.ts#L9

const NODE_BUILTIN_RE = new RegExp(
  "^(" + ["node:", ...builtinModules.map((m) => m + "$")].join("|") + ")",
);

export interface IsortOptions {
  isortOrder: RegExp[];
  isortIgnoreDeclarationSort?: boolean;
  isortIgnoreMemberSort?: boolean;
  isortIgnoreCase?: boolean;
  isortIgnoreDuplicateSource?: boolean;
  isortIgnoreComments: string[];
}

// TODO: test with non-default options
// TODO: make `isortOrder` and `isortIgnoreComments` configurable
export const DEFAULT_OPTIONS: IsortOptions = {
  // prettier-ignore
  isortOrder: [      // -- examples --
    NODE_BUILTIN_RE, // node:process, process
    /^.*:/,          // virtual:uno.css
    /^[^.#]/,        // any-external
    /^#/,            // #internal (cf. https://nodejs.org/api/packages.html#imports)
    /^\./,            // ./any-local
  ],
  isortIgnoreDeclarationSort: false,
  isortIgnoreMemberSort: false,
  isortIgnoreCase: false,
  isortIgnoreDuplicateSource: false,
  isortIgnoreComments: ["isort-ignore", "prettier-ignore"],
};

//
// utils
//

export function groupNeighborBy<T, K>(ls: T[], f: (x: T) => K): [K, T[]][] {
  if (ls.length === 0) {
    return [];
  }
  const first = ls.shift() as T;
  const groups: [K, T[]][] = [[f(first), [first]]];
  for (const x of ls) {
    const y = f(x);
    if (y === groups.at(-1)![0]) {
      groups.at(-1)![1].push(x);
    } else {
      groups.push([y, [x]]);
    }
  }
  return groups;
}
