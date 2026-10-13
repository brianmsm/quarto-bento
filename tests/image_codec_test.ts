import { imageCaptionSyntax } from "../src/source/image.ts";
import {
  assertAuthoredSvgData,
  assertImageShape,
  executedImageShape,
  originalImageShape,
} from "../src/render/images.ts";
import type { Node } from "../src/render/types.ts";
function assert(value: unknown, message = "assertion failed"): asserts value {
  if (!value) throw new Error(message);
}
function refuses(fn: () => unknown, code: string) {
  try {
    fn();
  } catch (e) {
    assert(String(e).includes(code), String(e));
    return;
  }
  throw new Error("Expected refusal");
}
Deno.test("standalone image caption span preserves URI/title bytes and handles UTF8 brackets/code", () => {
  for (
    const raw of [
      "![Local β **caption**](plot.svg)\r\n",
      '  ![A [link](https://example.org) and `]` caption](<plot file.svg> "source title")\n',
      "![Escaped \\] caption](plot.svg)\n",
    ]
  ) {
    const span = imageCaptionSyntax(raw);
    assert(span);
    const bytes = new TextEncoder().encode(raw);
    assert(
      new TextDecoder().decode(bytes.subarray(span.start, span.end)) ===
        span.caption,
    );
    const replaced = new TextDecoder().decode(bytes.subarray(0, span.start)) +
      "Reviewed caption" + new TextDecoder().decode(bytes.subarray(span.end));
    assert(replaced.includes("![Reviewed caption]("));
    assert(
      replaced.slice(replaced.indexOf("](")) ===
        raw.slice(raw.indexOf("](", raw.indexOf("caption"))),
    );
  }
  for (
    const raw of [
      "Paragraph ![inline](plot.svg)",
      "![reference][ref]",
      "![open `code](plot.svg)",
    ]
  ) assert(imageCaptionSyntax(raw) === undefined);
});
Deno.test("original and executed image proof retains rich caption and rejects altered path, raw markup and extras", () => {
  const caption: Node[] = [{ t: "Str", c: "Local" }, { t: "Space" }, {
    t: "Strong",
    c: [{ t: "Str", c: "β" }],
  }];
  const source: Node = {
    t: "Figure",
    c: [["", [], []], [null, [{ t: "Plain", c: caption }]], [{
      t: "Plain",
      c: [{ t: "Image", c: [["", [], []], caption, ["plot.svg", ""]] }],
    }]],
  };
  const executed: Node = {
    t: "Div",
    c: [["", ["quarto-figure", "quarto-figure-center"], []], [{
      t: "RawBlock",
      c: ["html", "<figure>"],
    }, {
      t: "Para",
      c: [{ t: "Image", c: [["", ["img-fluid"], []], [], ["plot.svg", ""]] }],
    }, {
      t: "Plain",
      c: [{ t: "RawInline", c: ["html", "<figcaption>"] }, ...caption, {
        t: "RawInline",
        c: ["html", "</figcaption>"],
      }],
    }, { t: "RawBlock", c: ["html", "</figure>"] }]],
  };
  const original = originalImageShape(source),
    result = executedImageShape(executed);
  assert(original.captionHtml === "Local <b>β</b>");
  assertImageShape(original, result);
  refuses(
    () => assertImageShape(original, { ...result, target: "foreign.svg" }),
    "UNMAPPED_AUTHORED_IMAGE",
  );
  const changed = structuredClone(executed);
  (changed.c as [unknown, Node[]])[1][2].c = [
    { t: "RawInline", c: ["html", '<figcaption style="color:red">'] },
    ...caption,
    { t: "RawInline", c: ["html", "</figcaption>"] },
  ];
  refuses(() => executedImageShape(changed), "UNSUPPORTED_AUTHORED_IMAGE");
  const injected = structuredClone(executed);
  (injected.c as [unknown, Node[]])[1].splice(2, 0, {
    t: "Para",
    c: [{ t: "Str", c: "foreign text" }],
  });
  refuses(() => executedImageShape(injected), "UNSUPPORTED_AUTHORED_IMAGE");
});
Deno.test("authored SVG assets permit internal fragments and refuse companion resources or active markup", () => {
  const data = (svg: string) => "data:image/svg+xml;base64," + btoa(svg);
  assertAuthoredSvgData(
    data(
      '<svg xmlns="http://www.w3.org/2000/svg"><use href="#safe"/><path fill="url(#clip)"/></svg>',
    ),
  );
  for (
    const value of [
      '<svg><use href="other.svg#shape"/></svg>',
      '<svg><image href="https://example.org/image.png"/></svg>',
      "<svg><style>@font-face{src:url(file.ttf)}</style></svg>",
      '<svg><style>@import "companion.css";</style></svg>',
      '<svg><style>@im\\70ort "companion.css";</style></svg>',
      '<svg><style>&#64;import "companion.css";</style></svg>',
      "<svg><rect style=\"font-family: 'A'; fill:u\\72l(companion.svg#paint)\"/></svg>",
      "<svg><style>rect{fill:u&#114;l(companion.svg#paint)}</style></svg>",
      "<svg><style>rect{fill:&#99999999;}</style></svg>",
      "<svg><script/></svg>",
      '<!DOCTYPE svg SYSTEM "external.dtd"><svg/>',
    ]
  ) refuses(() => assertAuthoredSvgData(data(value)), "UNSAFE_SVG");
});

import { assetData } from "../src/render/assets.ts";
Deno.test("local image URI resolution decodes once and keeps canonical filesystem boundaries", async () => {
  const dir = await Deno.makeTempDir({ prefix: "qbento-image-uri-" });
  try {
    const value =
      '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="60"/>';
    for (const name of ['figure "β".svg', "literal%20.svg"]) {
      await Deno.writeTextFile(dir + "/" + name, value);
    }
    const expected = "data:image/svg+xml;base64," + btoa(value);
    if (await assetData("figure%20%22β%22.svg", [dir]) !== expected) {
      throw new Error("quoted Unicode URI");
    }
    if (await assetData("literal%2520.svg", [dir]) !== expected) {
      throw new Error("double decoded literal percent");
    }
    for (
      const target of [
        "%2E%2E/outside.svg",
        "%2F%2Fserver/share.svg",
        "https%3A%2F%2Fexample.org/a.svg",
        "bad%2.svg",
      ]
    ) {
      let refused = false;
      try {
        await assetData(target, [dir]);
      } catch {
        refused = true;
      }
      if (!refused) throw new Error("accepted " + target);
    }
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
