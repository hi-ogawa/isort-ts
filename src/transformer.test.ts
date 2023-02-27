import assert from "node:assert";
import { describe, expect, it } from "vitest";
import { ParseError, tsAnalyze, tsTransformIsort } from "./transformer";

describe("tsAnalyze", () => {
  it("comment", () => {
    const input = `\
// hey
import { x, y } from "b";
import "c"; // xxx
// foo
import { z, w } from "a";
`;
    expect(tsAnalyze(input)).toMatchInlineSnapshot(`
      [
        [
          {
            "end": 32,
            "source": "b",
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
            "start": 7,
          },
          {
            "end": 44,
            "source": "c",
            "specifiers": undefined,
            "start": 33,
          },
          {
            "end": 84,
            "source": "a",
            "specifiers": [
              {
                "end": 69,
                "name": "z",
                "start": 68,
              },
              {
                "end": 72,
                "name": "w",
                "start": 71,
              },
            ],
            "start": 59,
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
import "c";
import { z, w } from "a";
`;
    expect(tsTransformIsort(input)).toMatchInlineSnapshot(`
      "import { w, z } from \\"a\\";
      import { x, y } from \\"b\\";
      import \\"c\\";
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
import "c"; // xxx
// foo
import { z, w } from "a";
`;
    expect(tsTransformIsort(input)).toMatchInlineSnapshot(`
      "// hey
      import { w, z } from \\"a\\";
      import { x, y } from \\"b\\"; // xxx
      // foo
      import \\"c\\";
      "
    `);
  });

  it("ignore", () => {
    const input = `\
import { x, y } from "b";
// isort-ignore
import "c";
import { z, w } from "a";
`;
    expect(tsTransformIsort(input)).toMatchInlineSnapshot(`
      "import { x, y } from \\"b\\";
      // isort-ignore
      import \\"c\\";
      import { w, z } from \\"a\\";
      "
    `);
  });

  it("multiple groups", () => {
    const input = `\
import { x, y } from "b";
"hello";
import "c";
import { z, w } from "a";
`;
    expect(tsTransformIsort(input)).toMatchInlineSnapshot(`
      "import { x, y } from \\"b\\";
      \\"hello\\";
      import { w, z } from \\"a\\";
      import \\"c\\";
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

  it("syntax-error", () => {
    const input = `\
some-random # stuff
`;
    assert.throws(
      () => tsTransformIsort(input),
      (e) => {
        assert.ok(e instanceof ParseError);
        expect(e.getDetails()).toMatchInlineSnapshot(`
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
        return true;
      }
    );
  });

  it("default-order", () => {
    const input = `\
import "./z";
import "./a";
import "z";
import { D, C, b, a } from "a";
import "virtual:uno.css";
import "process";
import "node:process";
`;
    expect(tsTransformIsort(input)).toMatchInlineSnapshot(`
      "import \\"node:process\\";
      import \\"process\\";
      import \\"virtual:uno.css\\";
      import { C, D, a, b } from \\"a\\";
      import \\"z\\";
      import \\"./a\\";
      import \\"./z\\";
      "
    `);
  });
});
