import fs from "node:fs";
import process from "node:process";
import { cac } from "cac";
import consola from "consola";
import { tsTransformIsort } from "./transformer";

const cli = cac("isort-ts");

cli
  .help()
  .command("[...files]", "check import order")
  .option("--fix", "apply sorting in-place")
  .option("--cache", "enable caching (TODO)")
  .option("--git", "collect files based on git (TODO)")
  .action(runCommand);

async function runCommand(
  files: string[],
  options: { fix: boolean; git: boolean; cache: boolean }
) {
  const results = {
    ok: 0,
    nochange: 0,
    error: 0,
  };

  async function runTransform(filePath: string) {
    try {
      const input = await fs.promises.readFile(filePath, "utf-8");
      const output = tsTransformIsort(input);
      if (output !== input) {
        if (options.fix) {
          await fs.promises.writeFile(filePath, output);
        }
        consola.info(filePath);
        results.ok++;
      } else {
        consola.success(filePath);
        results.nochange++;
      }
    } catch (e) {
      consola.error(filePath, e);
      results.error++;
    }
  }

  await Promise.all(files.map((v) => runTransform(v)));

  if (options.fix) {
    if (results.error) {
      process.exit(1);
    }
  } else {
    if (results.ok || results.error) {
      process.exit(1);
    }
  }
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
