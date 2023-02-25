import { exec } from "node:child_process";
import fs from "node:fs";
import { performance } from "node:perf_hooks";
import process from "node:process";
import { promisify } from "node:util";
import { cac } from "cac";
import consola from "consola";
import { deserializeMap, hashString, LruCache, serializeMap } from "./misc";
import { tsTransformIsort } from "./transformer";

const cli = cac("isort-ts");

cli
  .help()
  .command("[...files]", "check import order")
  .option("--fix", "apply sorting in-place")
  .option("--git", "collect files based on git")
  .option("--cache", "enable caching (TODO)")
  .action(runCommand);

async function runCommand(
  files: string[],
  options: { fix: boolean; git: boolean; cache: boolean }
) {
  if (options.git) {
    files = files.concat(await collectFilesByGit());
  }

  const results = {
    fixable: 0,
    correct: 0,
    error: 0,
  };

  const lruCache = new LruCache({
    maxSize: 2 * files.length,
    cachedFn: tsTransformIsort, // TODO: avoid caching entire output
    hashFn: hashString, // TODO: hash options
  });
  const CACHE_PATH = "node_modules/.cache/@hiogawa/isort-ts/.cache-v1"; // TODO: configurable
  await lruCache.load(CACHE_PATH, deserializeMap);

  async function runTransform(filePath: string) {
    try {
      const input = await fs.promises.readFile(filePath, "utf-8");
      const [[cacheHit, output], time] = measureSync(() => lruCache.run(input));
      const message = [`${time.toFixed(0)} ms`, cacheHit && "(cached)"]
        .filter(Boolean)
        .join(" ");
      if (output !== input) {
        if (options.fix) {
          await fs.promises.writeFile(filePath, output);
        }
        consola.info(filePath, message);
        results.fixable++;
      } else {
        consola.success(filePath, message);
        results.correct++;
      }
    } catch (e) {
      consola.error(filePath, e);
      results.error++;
    }
  }

  await Promise.all(files.map((v) => runTransform(v)));
  await lruCache.store(CACHE_PATH, serializeMap);

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

const promisifyExec = promisify(exec);

async function collectFilesByGit(): Promise<string[]> {
  const COMMANDS = [
    "git grep -l . '*.ts' '*.tsx'",
    "git ls-files --others --exclude-standard '*.ts' '*.tsx'",
  ];
  let files: string[] = [];
  for (const command of COMMANDS) {
    const result = await promisifyExec(command);
    files = files.concat(result.stdout.split("\n").filter(Boolean));
  }
  return files;
}

function measureSync<T>(f: () => T): [T, number] {
  const t0 = performance.now();
  const y = f();
  const t1 = performance.now();
  return [y, t1 - t0];
}

async function main() {
  try {
    cli.parse(undefined, { run: false });
    await cli.runMatchedCommand();
  } catch (e: unknown) {
    consola.error(e);
    process.exit(1);
  }
}

main();
