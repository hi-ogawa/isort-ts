import { exec } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import { dirname } from "node:path";
import { performance } from "node:perf_hooks";
import process from "node:process";
import { promisify } from "node:util";
import {
  type ArgSchema,
  type ArgSchemaRecordBase,
  type TypedArgs,
  defineCommand,
} from "@hiogawa/tiny-cli";
import { tinyassert } from "@hiogawa/utils";
import consola from "consola";
import { version } from "../package.json";
import { DEFAULT_OPTIONS, IsortOptions } from "./misc";
import { IsortError, tsTransformIsort } from "./transformer";

const flag = (describe?: string): ArgSchema<boolean> => ({
  describe,
  type: "flag",
  parse: (v: unknown) => Boolean(v),
});

const argsSchema = {
  files: {
    type: "positional",
    variadic: true,
    describe: "typescript files",
    parse: (v: unknown) => v as string[],
  },
  fix: flag("apply sorting in-place"),
  git: flag("collect files based on git"),
  cache: flag("enable caching"),
  isortIgnoreDeclarationSort: flag("disable sorting import declarations"),
  isortIgnoreMemberSort: flag("disable sorting import specifiers"),
  isortIgnoreCase: flag("sort case insensitive"),
  isortIgnoreDuplicateDeclaration: flag("allow duplicate imports"),
} satisfies ArgSchemaRecordBase;

const command = defineCommand(
  {
    program: "isort-ts",
    describe: "Lint ESM module import order",
    autoHelp: true,
    args: argsSchema,
  },
  ({ args }) => runCommand(args)
);

async function runCommand(options: TypedArgs<typeof argsSchema>) {
  let files = options.files;
  if (options.git) {
    files = files.concat(await collectFilesByGit());
  }

  if (files.length === 0) {
    console.log(command.help());
    return;
  }

  const results = {
    fixable: 0,
    correct: 0,
    error: 0,
  };

  const isortOptions: IsortOptions = {
    ...DEFAULT_OPTIONS,
    isortIgnoreCase: options.isortIgnoreCase,
    isortIgnoreDeclarationSort: options.isortIgnoreDeclarationSort,
    isortIgnoreMemberSort: options.isortIgnoreMemberSort,
  };
  const isortOptionsString = JSON.stringify(isortOptions);

  const lruCache = new LruCacheSet({
    hashFn: (input: string) => hashString(isortOptionsString + "@" + input),
    cachedFn: (input: string) => {
      const output = tsTransformIsort(input, isortOptions);
      return { ok: input === output, output };
    },
  });
  if (options.cache) {
    await lruCache.load(CACHE_PATH);
  }

  async function runTransform(filePath: string) {
    try {
      const input = await fs.promises.readFile(filePath, "utf-8");
      const [result, time] = measureSync(() => lruCache.run(input));
      const timeMessage = `${time.toFixed(0)} ms`;
      if (result.ok) {
        consola.success(
          filePath,
          timeMessage + (result.hit ? " (cached)" : "")
        );
        results.correct++;
      } else {
        if (options.fix) {
          await fs.promises.writeFile(filePath, result.output);
          // since `output` will be a correct `input`, it can be added to cache.
          // note that, however, if prettier is follwoding isort-ts, then the output will be once more overwritten.
          lruCache.cache(result.output);
        }
        consola.info(filePath, timeMessage);
        results.fixable++;
      }
    } catch (e) {
      if (e instanceof IsortError) {
        const details = e.getDiagnostics();
        tinyassert(details.length > 0);
        for (const detail of details) {
          consola.error(
            `${filePath}:${detail.line}:${detail.column}`,
            detail.message
          );
        }
      } else {
        consola.error(filePath, e);
      }
      results.error++;
    }
  }

  // TODO
  // parallel in worker?
  // `Promise.all` is bad when there are too many files
  // since `fs.promises.writeFile` would contend the resouce and modified files become momentarily empty/purged.
  for (const file of files) {
    await runTransform(file);
  }

  if (options.cache) {
    await lruCache.store(CACHE_PATH);
  }

  if (options.fix) {
    if (results.error) {
      process.exit(1);
    }
  } else {
    if (results.fixable || results.error) {
      process.exit(1);
    }
  }
}

//
// cache
//

// each entry is 44 bytes (based encoded 256 bits = 32 bytes), so maximum is around 4MB
// practically it should be reasonable to hard-code this.
const CACHE_MAX_SIZE = 100_000;
const CACHE_PATH = `node_modules/.cache/@hiogawa/isort-ts/.cache-v${version}`; // TODO: configurable

export class LruCacheSet<I, V> {
  private cached = new Set<string>();

  constructor(
    private options: {
      cachedFn: (input: I) => { ok: boolean; output: V }; // we cache `hashFn(input)` when `ok: true`
      hashFn: (input: I) => string;
    }
  ) {}

  async load(file: string) {
    if (!fs.existsSync(file)) {
      return;
    }

    const content = await fs.promises.readFile(file, "utf-8");
    const set = deserializeSet(content);
    this.cached = set;
  }

  async store(file: string) {
    const filedir = dirname(file);
    if (!fs.existsSync(filedir)) {
      await fs.promises.mkdir(filedir, { recursive: true });
    }
    const s = serializeSet(this.cached);
    await fs.promises.writeFile(file, s);
  }

  run(input: I): { ok: true; hit?: boolean } | { ok: false; output: V } {
    const key = this.options.hashFn(input);
    if (this.cached.has(key)) {
      // need to delete/add to simualte LRU
      this.cached.delete(key);
      this.cached.add(key);
      return { ok: true, hit: true };
    }
    const result = this.options.cachedFn(input);
    if (result.ok) {
      this.cacheKey(key);
    }
    return result;
  }

  cache(input: I) {
    this.cacheKey(this.options.hashFn(input));
  }

  private cacheKey(key: string) {
    this.cached.add(key);
    this.popUntilMaxSize();
  }

  private popUntilMaxSize() {
    while (this.cached.size > CACHE_MAX_SIZE) {
      const next = this.cached.keys().next();
      if (next.done) {
        break;
      }
      this.cached.delete(next.value);
    }
  }
}

function serializeSet(s: Set<string>): string {
  const elements: string[] = [...s];
  return JSON.stringify(elements);
}

function deserializeSet(s: string): Set<string> {
  const elements: unknown = JSON.parse(s);
  tinyassert(Array.isArray(elements));
  tinyassert(elements.every((e: unknown) => typeof e === "string"));
  return new Set(elements);
}

function hashString(input: string): string {
  return createHash("sha256").update(input).digest("base64");
}

//
// git
//

const promisifyExec = promisify(exec);

async function collectFilesByGit(): Promise<string[]> {
  // fails when no-match but that's probably desired
  const COMMANDS = [
    "git grep -l --untracked --exclude-standard . '*.ts' '*.tsx'",
  ];
  let files: string[] = [];
  for (const command of COMMANDS) {
    const result = await promisifyExec(command);
    files = files.concat(result.stdout.split("\n").filter(Boolean));
  }
  return files;
}

//
// perf
//

function measureSync<T>(f: () => T): [T, number] {
  const t0 = performance.now();
  const y = f();
  const t1 = performance.now();
  return [y, t1 - t0];
}

//
// main
//

async function main() {
  try {
    await command.parse(process.argv.slice(2));
  } catch (e: unknown) {
    consola.error(e);
    process.exit(1);
  }
}

main();
