import { createHash } from "node:crypto";
import { builtinModules } from "node:module";
import { tinyassert } from "@hiogawa/utils";

const NODE_BUILTIN_RE = new RegExp(
  "^(" + ["node:", ...builtinModules.map((m) => m + "$")].join("|") + ")"
);

// cf. https://github.com/trivago/prettier-plugin-sort-imports/blob/89d66f706423e44f29d525529af37e5d41a74133/src/index.ts#L9
interface IsortOptions {
  isortOrder: RegExp[];
  isortSpecifiers: boolean;
  isortCaseInsensitive: boolean;
  isortIgnoreComments: string[];
}

// TODO: configurable
export const DEFAULT_OPTIONS: IsortOptions = {
  isortOrder: [NODE_BUILTIN_RE, /^[^./]/, /[^./]/],
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

export class LruCache<I, K, V> {
  private map = new Map<K, V>();

  constructor(
    private options: {
      maxSize: number;
      cachedFn: (input: K) => V;
      hashFn: (input: I) => K;
    }
  ) {
    tinyassert(options.maxSize > 0);
  }

  run(key: K): [boolean, V] {
    let value: V;
    let hit = this.map.has(key);
    if (hit) {
      // need to delete/set to simualte LRU
      value = this.map.get(key)!;
      this.map.delete(key);
      this.map.set(key, value);
    } else {
      value = this.options.cachedFn(key);
      this.map.set(key, value);
      this.popUntilMaxSize();
    }
    return [hit, value];
  }

  private popUntilMaxSize() {
    while (this.map.size > this.options.maxSize) {
      const next = this.map.keys().next();
      if (next.done) {
        break;
      }
      this.map.delete(next.value);
    }
  }
}

export function hashString(input: string): string {
  return createHash("sha256").update(input).digest("base64");
}
