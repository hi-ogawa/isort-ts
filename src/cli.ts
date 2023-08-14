import { exec } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import { dirname } from "node:path";
import { performance } from "node:perf_hooks";
import process from "node:process";
import { promisify } from "node:util";
import {
  type ArgSchemaRecord,
  TinyCliCommand,
  TinyCliParseError,
  type TypedArgs,
  arg,
} from "@hiogawa/tiny-cli";
import {
  LruCache,
  arrayFromAsyncGenerator,
  formatError,
  mapToAsyncGenerator,
  tinyassert,
} from "@hiogawa/utils";
import { version } from "../package.json";
import { DEFAULT_OPTIONS, IsortOptions } from "./misc";
import { IsortError, tsTransformIsort } from "./transformer";

const argsSchema = {
  files: arg.stringArray("typescript files to lint"),
  fix: arg.boolean("apply sorting in-place"),
  git: arg.boolean("collect files based on git"),
  cache: arg.boolean("enable caching"),
  concurrency: arg.number("concurrency", { default: 10 }),
  isortIgnoreDeclarationSort: arg.boolean(
    "disable sorting import declarations"
  ),
  isortIgnoreMemberSort: arg.boolean("disable sorting import specifiers"),
  isortIgnoreCase: arg.boolean("sort case insensitive"),
  isortIgnoreDuplicateDeclaration: arg.boolean("allow duplicate imports"),
} satisfies ArgSchemaRecord;

const command = new TinyCliCommand(
  {
    program: "isort-ts",
    version,
    description: "Lint ESM module import order",
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
        console.log(
          STATUS.success,
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
        console.log(STATUS.info, filePath, timeMessage);
        results.fixable++;
      }
    } catch (e) {
      if (e instanceof IsortError) {
        const details = e.getDiagnostics();
        tinyassert(details.length > 0);
        for (const detail of details) {
          console.error(
            STATUS.error,
            `${filePath}:${detail.line}:${detail.column}`,
            detail.message
          );
        }
      } else {
        console.error(STATUS.error, filePath, e);
      }
      results.error++;
    }
  }

  // bounded Promise.all
  await arrayFromAsyncGenerator(
    mapToAsyncGenerator(files, (file) => runTransform(file), {
      concurrency: options.concurrency,
    })
  );

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

// cf. https://github.com/unjs/consola/blob/e4a37c1cd2c8d96b5f30d8c13ff2df32244baa6a/src/reporters/fancy.ts#L26-L38
const STATUS = {
  info: "ℹ",
  success: "✔",
  error: "✖",
};

//
// cache
//

// each entry is 44 bytes (based encoded 256 bits = 32 bytes), so maximum is around 4MB
// practically it should be reasonable to hard-code this.
const CACHE_MAX_SIZE = 100_000;
const CACHE_PATH = `node_modules/.cache/@hiogawa/isort-ts/.cache-v${version}`; // TODO: configurable

export class LruCacheSet<I, V> {
  private cacheMap = new LruCache<string, true>(CACHE_MAX_SIZE);

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
    const keys = JSON.parse(content);
    tinyassert(Array.isArray(keys));
    tinyassert(keys.every((e: unknown) => typeof e === "string"));
    this.cacheMap._map = new Map(keys.map((k) => [k, true]));
  }

  async store(file: string) {
    const filedir = dirname(file);
    if (!fs.existsSync(filedir)) {
      await fs.promises.mkdir(filedir, { recursive: true });
    }
    const keys = this.cacheMap._map.keys();
    await fs.promises.writeFile(file, JSON.stringify([...keys]));
  }

  run(input: I): { ok: true; hit?: boolean } | { ok: false; output: V } {
    const key = this.options.hashFn(input);
    if (this.cacheMap.get(key)) {
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
    this.cacheMap.set(key, true);
  }
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
    console.log(formatError(e));
    if (e instanceof TinyCliParseError) {
      console.log("See '--help' for more info.\n\n" + command.help());
    }
    process.exit(1);
  }
}

main();
