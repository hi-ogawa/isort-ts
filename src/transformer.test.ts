import { describe, expect, it } from "vitest";
import { tsAnalyze, tsTransformIsort } from "./transformer";

describe("ts-transfomer", () => {
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
    expect(tsAnalyze(input)).toMatchInlineSnapshot(`
      [
        [
          {
            "end": 25,
            "source": "b",
            "specifiers": [
              {
                "end": 10,
                "name": "x",
                "start": 9,
              },
              {
                "end": 13,
                "name": "y",
                "start": 12,
              },
            ],
            "start": 0,
          },
          {
            "end": 37,
            "source": "c",
            "specifiers": undefined,
            "start": 26,
          },
          {
            "end": 63,
            "source": "a",
            "specifiers": [
              {
                "end": 48,
                "name": "z",
                "start": 47,
              },
              {
                "end": 51,
                "name": "w",
                "start": 50,
              },
            ],
            "start": 38,
          },
        ],
      ]
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
    expect(tsAnalyze(input)).toMatchInlineSnapshot(`
      [
        [
          {
            "end": 35,
            "source": "b",
            "specifiers": [
              {
                "end": 15,
                "name": "y",
                "start": 9,
              },
              {
                "end": 23,
                "name": "x",
                "start": 17,
              },
            ],
            "start": 0,
          },
        ],
      ]
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
    expect(tsAnalyze(input)).toMatchInlineSnapshot(`
      [
        [
          {
            "end": 25,
            "source": "b",
            "specifiers": [
              {
                "end": 10,
                "name": "x",
                "start": 9,
              },
              {
                "end": 13,
                "name": "y",
                "start": 12,
              },
            ],
            "start": 0,
          },
        ],
        [
          {
            "end": 79,
            "source": "a",
            "specifiers": [
              {
                "end": 64,
                "name": "z",
                "start": 63,
              },
              {
                "end": 67,
                "name": "w",
                "start": 66,
              },
            ],
            "start": 54,
          },
        ],
      ]
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
    expect(tsAnalyze(input)).toMatchInlineSnapshot(`
      [
        [
          {
            "end": 25,
            "source": "b",
            "specifiers": [
              {
                "end": 10,
                "name": "x",
                "start": 9,
              },
              {
                "end": 13,
                "name": "y",
                "start": 12,
              },
            ],
            "start": 0,
          },
        ],
        [
          {
            "end": 46,
            "source": "c",
            "specifiers": undefined,
            "start": 35,
          },
          {
            "end": 72,
            "source": "a",
            "specifiers": [
              {
                "end": 57,
                "name": "z",
                "start": 56,
              },
              {
                "end": 60,
                "name": "w",
                "start": 59,
              },
            ],
            "start": 47,
          },
        ],
      ]
    `);
  });

  it("tsx", () => {
    const input = `\
import "b";
import "a";

<input />
`;
    expect(tsTransformIsort(input)).toMatchInlineSnapshot(`
      "import \\"a\\";
      import \\"b\\";

      <input />
      "
    `);
    expect(tsAnalyze(input)).toMatchInlineSnapshot(`
      [
        [
          {
            "end": 11,
            "source": "b",
            "specifiers": undefined,
            "start": 0,
          },
          {
            "end": 23,
            "source": "a",
            "specifiers": undefined,
            "start": 12,
          },
        ],
      ]
    `);
  });
});
