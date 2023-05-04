import { tinyassert, wrapError } from "@hiogawa/utils";
import { describe, expect, it } from "vitest";
import {
  DuplicateSourceError,
  ParseError,
  tsAnalyze,
  tsTransformIsort,
} from "./transformer";

describe("tsAnalyze", () => {
  it("comment", () => {
    const input = `\
// hey
import { x, y } from "b";
import someDefault from "d"; // xxx
import "c"; // side effect
// foo
import { z, w } from "a";
`;
    expect(tsAnalyze(input)).toMatchInlineSnapshot(`
      [
        [
          {
            "clause": {
              "name": undefined,
              "specifiers": [
                {
                  "end": 17,
                  "name": "x",
                  "start": 16,
                },
                {
                  "end": 20,
                  "name": "y",
                  "start": 19,
                },
              ],
            },
            "end": 32,
            "source": "b",
            "start": 7,
          },
          {
            "clause": {
              "name": "someDefault",
              "specifiers": undefined,
            },
            "end": 61,
            "source": "d",
            "start": 33,
          },
          {
            "clause": undefined,
            "end": 80,
            "source": "c",
            "start": 69,
          },
          {
            "clause": {
              "name": undefined,
              "specifiers": [
                {
                  "end": 113,
                  "name": "z",
                  "start": 112,
                },
                {
                  "end": 116,
                  "name": "w",
                  "start": 115,
                },
              ],
            },
            "end": 128,
            "source": "a",
            "start": 103,
          },
        ],
      ]
    `);
  });
});

describe("tsTransformIsort", () => {
  it("basic", () => {
    const input = `\
import { x, y } from "b";
import d from "c";
import { z, w } from "a";
`;
    expect(tsTransformIsort(input)).toMatchInlineSnapshot(`
      "import { w, z } from \\"a\\";
      import { x, y } from \\"b\\";
      import d from \\"c\\";
      "
    `);
  });

  it("rename", () => {
    const input = `\
import { y as a, x as b } from "b";
`;
    expect(tsTransformIsort(input)).toMatchInlineSnapshot(`
      "import { x as b, y as a } from \\"b\\";
      "
    `);
  });

  it("comment", () => {
    const input = `\
// hey
import { x, y } from "b";
import someDefault from "d"; // xxx
import "c"; // side effect
// foo
import { z, w } from "a";
`;
    expect(tsTransformIsort(input)).toMatchInlineSnapshot(`
      "// hey
      import \\"c\\";
      import { w, z } from \\"a\\"; // xxx
      import { x, y } from \\"b\\"; // side effect
      // foo
      import someDefault from \\"d\\";
      "
    `);
  });

  it("ignore", () => {
    const input = `\
import { x, y } from "b";
// isort-ignore
import { p } from  "c";
import { z, w } from "a";
`;
    expect(tsTransformIsort(input)).toMatchInlineSnapshot(`
      "import { x, y } from \\"b\\";
      // isort-ignore
      import { p } from  \\"c\\";
      import { w, z } from \\"a\\";
      "
    `);
  });

  it("multiple groups", () => {
    const input = `\
import { x, y } from "b";
"hello";
import { p } from "c";
import { z, w } from "a";
`;
    expect(tsTransformIsort(input)).toMatchInlineSnapshot(`
      "import { x, y } from \\"b\\";
      \\"hello\\";
      import { w, z } from \\"a\\";
      import { p } from \\"c\\";
      "
    `);
  });

  it("tsx", () => {
    const input = `\
import "b";
import "a";

<input /> satisfies unknown;
`;
    expect(tsTransformIsort(input)).toMatchInlineSnapshot(`
      "import \\"a\\";
      import \\"b\\";

      <input /> satisfies unknown;
      "
    `);
  });

  it("ts only syntax", () => {
    const input = `\
import "b";
import "a";

const f = async <T>(x: T) => x;
`;
    expect(tsTransformIsort(input)).toMatchInlineSnapshot(`
      "import \\"a\\";
      import \\"b\\";

      const f = async <T>(x: T) => x;
      "
    `);
  });

  it("syntax-error", () => {
    const input = `\
some-random # stuff
`;
    const result = wrapError(() => tsTransformIsort(input));
    expect(result).toMatchInlineSnapshot(`
      {
        "ok": false,
        "value": [Error: ParseError],
      }
    `);
    tinyassert(result.value instanceof ParseError);
    expect(result.value.getDiagnostics()).toMatchInlineSnapshot(`
      [
        {
          "column": 12,
          "line": 1,
          "message": "Invalid character.",
        },
        {
          "column": 14,
          "line": 1,
          "message": "';' expected.",
        },
      ]
    `);
  });

  it("default-order", () => {
    const input = `\
import x from "./local-z";
import y from "./local-a";
import z from "external";
import { D, C, b, a } from "a";
import "side-effect";
import process1 from "process";
import process2 from "node:process";
`;
    expect(tsTransformIsort(input)).toMatchInlineSnapshot(`
      "import \\"side-effect\\";
      import process2 from \\"node:process\\";
      import process1 from \\"process\\";
      import { C, D, a, b } from \\"a\\";
      import z from \\"external\\";
      import y from \\"./local-a\\";
      import x from \\"./local-z\\";
      "
    `);
  });

  it(DuplicateSourceError.name, () => {
    const input = `\
import { a1 } from "a";
import { b1 } from "b";
import { c3 } from "c";
import { b2 } from "b";
import { a2 } from "a";
import { b3 } from "b";
`;
    const result = wrapError(() => tsTransformIsort(input));
    expect(result).toMatchInlineSnapshot(`
      {
        "ok": false,
        "value": [Error: DuplicateSourceError],
      }
    `);
    tinyassert(result.value instanceof DuplicateSourceError);
    expect(result.value.getDiagnostics()).toMatchInlineSnapshot(`
      [
        {
          "column": 0,
          "line": 1,
          "message": "Duplicate import source \\"a\\"",
        },
        {
          "column": 0,
          "line": 5,
          "message": "Duplicate import source \\"a\\"",
        },
        {
          "column": 0,
          "line": 2,
          "message": "Duplicate import source \\"b\\"",
        },
        {
          "column": 0,
          "line": 4,
          "message": "Duplicate import source \\"b\\"",
        },
        {
          "column": 0,
          "line": 6,
          "message": "Duplicate import source \\"b\\"",
        },
      ]
    `);
  });
});
