import { builtinModules } from "node:module";
import { z } from "zod";

//
// options
//

// relevant options of exising tools
//   https://github.com/import-js/eslint-plugin-import/blob/main/docs/rules/order.md
//   https://eslint.org/docs/latest/rules/sort-imports
//   https://github.com/trivago/prettier-plugin-sort-imports/blob/89d66f706423e44f29d525529af37e5d41a74133/src/index.ts#L9

const NODE_BUILTIN_RE = new RegExp(
  "^(" + ["node:", ...builtinModules.map((m) => m + "$")].join("|") + ")"
);

export type IsortOptions = {
  isortOrder: RegExp[];
  isortIgnoreComments: string[];
} & UserIsortOptions;

// TODO: test with non-default options
// TODO: make `isortOrder` and `isortIgnoreComments` configurable
export const DEFAULT_OPTIONS: IsortOptions = {
  // prettier-ignore
  isortOrder: [      // examples
    NODE_BUILTIN_RE, // node:process, process
    /^.*:/,          // virtual:uno.css
    /^[^./]/,        // any-external
    /[^./]/,         // ./any-local
  ],
  isortIgnoreDeclarationSort: false,
  isortIgnoreMemberSort: false,
  isortIgnoreCase: false,
  isortIgnoreComments: ["isort-ignore", "prettier-ignore"],
};

// prettier-ignore
export const Z_USER_ISORT_OPTIONS = z.object({
  isortIgnoreDeclarationSort: z.boolean().optional().describe("disable sorting import declarations"),
  isortIgnoreMemberSort: z.boolean().optional().describe("disable sorting import specifiers"),
  isortIgnoreCase: z.boolean().optional().describe("sort case insensitive"),
});

type UserIsortOptions = z.infer<typeof Z_USER_ISORT_OPTIONS>;

//
// zod
//

export function cacOptionsFromZod<T extends z.ZodObject<z.ZodRawShape>>(
  command: { option: (option: string, description: string) => void },
  schema: T
) {
  for (const [k, v] of Object.entries(schema.shape)) {
    command.option(`--${k}`, v.description ?? "");
  }
}

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
