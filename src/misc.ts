// cf. https://github.com/trivago/prettier-plugin-sort-imports/blob/89d66f706423e44f29d525529af37e5d41a74133/src/index.ts#L9
interface IsortOptions {
  isortOrder: RegExp[];
  isortSpecifiers: boolean;
  isortCaseInsensitive: boolean;
  isortIgnoreComments: string[];
}

// TODO: configurable
export const DEFAULT_OPTIONS: IsortOptions = {
  isortOrder: [/^[./]/],
  isortSpecifiers: true,
  isortCaseInsensitive: true,
  isortIgnoreComments: ["isort-ignore", "prettier-ignore"],
};

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
