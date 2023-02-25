import { createHash } from "node:crypto";
import fs from "node:fs";
import { builtinModules } from "node:module";
import { dirname } from "node:path";
import { tinyassert } from "@hiogawa/utils";
import consola from "consola";

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
      cachedFn: (input: I) => V;
      hashFn: (input: I) => K;
    }
  ) {
    tinyassert(options.maxSize > 0);
  }

  async load(file: string, deserialize: (s: string) => Map<K, V>) {
    if (!fs.existsSync(file)) {
      return;
    }
    const content = await fs.promises.readFile(file, "utf-8");
    const map = deserialize(content);
    this.map = map;
    this.options.maxSize = Math.max(this.options.maxSize, 2 * map.size);
  }

  async store(file: string, serialize: (map: Map<K, V>) => string) {
    const s = serialize(this.map);
    const filedir = dirname(file);
    if (!fs.existsSync(filedir)) {
      await fs.promises.mkdir(filedir, { recursive: true });
    }
    await fs.promises.writeFile(file, s);
  }

  run(input: I): [boolean, V] {
    const key = this.options.hashFn(input);
    let value: V;
    let hit = this.map.has(key);
    if (hit) {
      // need to delete/set to simualte LRU
      value = this.map.get(key)!;
      this.map.delete(key);
      this.map.set(key, value);
    } else {
      value = this.options.cachedFn(input);
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

export function serializeMap(map: Map<string, string>): string {
  const pairs: [string, string][] = [...map];
  return JSON.stringify(pairs);
}

export function deserializeMap(s: string): Map<string, string> {
  try {
    const pairs: unknown = JSON.parse(s);
    if (
      Array.isArray(pairs) &&
      pairs.every(
        (pair: unknown) =>
          Array.isArray(pair) &&
          pair.length === 2 &&
          pair.every((el) => typeof el === "string")
      )
    ) {
      return new Map(pairs);
    }
  } catch (e) {
    consola.error(e);
  }
  return new Map();
}

export function hashString(input: string): string {
  return createHash("sha256").update(input).digest("base64");
}
