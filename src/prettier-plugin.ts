import type prettier from "prettier";
import parserTypescript from "prettier/parser-typescript";
import { tsTransformIsort } from "./transformer";

export const prettierPlugin: prettier.Plugin = {
  parsers: {
    typescript: {
      ...parserTypescript.parsers.typescript,
      // TODO: options
      preprocess: (text, _options) => {
        return tsTransformIsort(text);
      },
    },
  },
};
