import {
  assertBentoContract,
  BentoContractError,
} from "../src/render/validate.ts";
import { projectAst } from "../src/render/project.ts";

type Obj = Record<string, unknown>;
function assert(value: unknown, message = "assertion failed"): asserts value {
  if (!value) throw new Error(message);
}
const frame = { x: 20, y: 30, w: 400, h: 180, rotation: 0, opacity: 1 };
function document(
  elements: Obj[] = [{ ...frame, id: "text", type: "text", html: "Hello" }],
): Obj {
  return {
    format: "bento/slides",
    version: 1,
    docId: "contract-fixture",
    title: "A native document",
    size: { width: 1280, height: 720 },
    theme: {
      background: "#fff",
      color: "#123",
      accent: "#456",
      fontFamily: "Arial, sans-serif",
    },
    slides: [{
      id: "slide",
      elements,
      notes: "",
      background: "#fff",
      transition: "fade",
    }],
  };
}
function rejects(doc: unknown, path?: string) {
  const before = JSON.stringify(doc);
  try {
    assertBentoContract(doc);
  } catch (error) {
    assert(error instanceof BentoContractError, String(error));
    assert(error.code === "BENTO_CONTRACT");
    if (path) {
      assert(
        error.details.some((d) => d.path === path),
        JSON.stringify(error.details),
      );
    }
    assert(JSON.stringify(doc) === before, "Rejected document was modified");
    return;
  }
  throw new Error("Expected a pinned contract rejection");
}

Deno.test("Bento contract accepts all nine native types, layouts, templates, motion and shape variants unchanged", () => {
  const elements: Obj[] = [
    {
      ...frame,
      id: "t",
      type: "text",
      html:
        '<b>Native</b> <code>x</code> <a href="https://example.org">link</a>',
      fontFamily: '"Segoe UI", sans-serif',
      color: "rgb(10, 20, 30)",
      morphId: "title",
      groupId: "card",
      themeRefs: { color: "accent1 -20%" },
      textStroke: { width: 1, color: "#fff", fill: "transparent" },
      shadow: [{ x: 2, y: 3, blur: 4, color: "rgba(0,0,0,.2)" }],
      fx: {
        enter: "fade-up",
        order: 1,
        countUp: true,
        loop: {
          type: "motion-path",
          path: "M0,0 C10,20 20,20 30,0",
          speeds: [1, 2],
        },
        ambient: "kenburns",
        ken: { dir: "drift", scale: 1.2, duration: 5 },
      },
    },
    {
      ...frame,
      id: "i",
      type: "image",
      src: "data:image/png;base64,AA==",
      crop: { x: .2, y: .3, scale: 1.5 },
      fit: "cover",
    },
    {
      ...frame,
      id: "v",
      type: "svg",
      markup:
        '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0 L10 10"/></svg>',
    },
    {
      ...frame,
      id: "ch",
      type: "chart",
      preset: "bar",
      option: {
        xAxis: { data: ["A", "B"] },
        series: [{ type: "bar", data: [1, 2] }],
      },
    },
    {
      ...frame,
      id: "ta",
      type: "table",
      columns: [{ w: 1 }],
      rows: [{ cells: [{ html: "Value", bold: true, bg: "#fff" }] }],
      header: true,
    },
    {
      ...frame,
      id: "m",
      type: "media",
      kind: "video",
      src: "asset:clip",
      autoplay: false,
      controls: true,
    },
    {
      ...frame,
      id: "e",
      type: "embed",
      app: "web",
      url: "https://example.org",
      live: false,
      view: "<svg/>",
      doc: { series: [1, 2] },
    },
    {
      ...frame,
      id: "c",
      type: "code",
      content: "print(1)",
      grammarName: "python",
    },
  ];
  for (
    const shape of ["rect", "ellipse", "triangle", "arrow", "line", "path"]
  ) {
    elements.push({
      ...frame,
      id: `s-${shape}`,
      type: "shape",
      shape,
      fill: 'url("#gradient")',
      stroke: "#123",
      strokeWidth: 2,
      ...(shape === "path"
        ? { d: "M0 0 L10 10", pathBox: [0, 0, 10, 10] }
        : {}),
      ...(shape === "line"
        ? {
          from: { el: "t", side: "bottom" },
          to: { el: "i", side: "auto" },
          lineStart: "circle-open",
          lineEnd: "triangle",
          heads: 2,
        }
        : {}),
    });
  }
  const doc = document(elements);
  doc.template = true;
  doc.assets = { clip: "data:video/mp4;base64,AA==" };
  doc.fonts = [{
    family: "Instrument Sans",
    asset: "builtin:instrument-sans",
    weight: "100 900",
    style: "normal",
  }];
  doc.layouts = [{
    id: "layout",
    name: "Reusable",
    elements: [elements[0]],
    notes: "Layout note",
    background: "linear-gradient(90deg, #fff, #eee)",
  }];
  (doc.slides as Obj[]).push({
    id: "morph-slide",
    elements: [elements[0]],
    transition: "morph",
    notes: "",
    stateOf: "slide",
    hover: { type: "focus-group", dim: .4 },
  });
  const before = JSON.stringify(doc);
  assertBentoContract(doc);
  assert(JSON.stringify(doc) === before, "Validation modified native data");
});

Deno.test("Bento contract accepts the default projector output", async () => {
  const projection = await projectAst(
    {
      meta: {},
      blocks: [
        { t: "Header", c: [2, ["slide", [], []], [{ t: "Str", c: "Hello" }]] },
        { t: "Para", c: [{ t: "Str", c: "Plain text" }] },
      ],
    },
    "projected-id",
    [],
  );
  assertBentoContract(projection.document);
});

Deno.test("Bento contract keeps native optional/compact forms without inventing geometry", () => {
  const doc = {
    format: "bento/slides",
    version: 1,
    docId: "minimal",
    compact: true,
    slides: [{ id: "s", elements: [{ id: "p", type: "text", html: "Text" }] }],
  };
  const before = JSON.stringify(doc);
  assertBentoContract(doc);
  assert(JSON.stringify(doc) === before);
});

Deno.test("Bento contract rejects wrong format/version and missing project identity", () => {
  for (const version of [undefined, 0, 2, "1"]) {
    const doc = document();
    doc.version = version;
    rejects(doc);
  }
  const badFormat = document();
  badFormat.format = "other/slides";
  rejects(badFormat, "/format");
  const noId = document();
  noId.docId = "";
  rejects(noId, "/docId");
});

Deno.test("Bento contract rejects unknown types and lossy unknown keys", () => {
  rejects(
    document([{ id: "p", type: "unknown", html: "Text" }]),
    "/slides/0/elements/0",
  );
  rejects(
    document([{ id: "p", type: "text", html: "Text", fontSze: 20 }]),
    "/slides/0/elements/0/fontSze",
  );
  const doc = document();
  doc.unrecognizedSemanticState = "text";
  rejects(doc, "/unrecognizedSemanticState");
});

Deno.test("Bento contract rejects invalid coordinates, content, ranges and nested fields", () => {
  for (const bad of ["20", 1_000_001]) {
    rejects(
      document([{ id: "p", type: "text", html: "Text", x: bad }]),
      "/slides/0/elements/0/x",
    );
  }
  rejects(
    document([{ id: "p", type: "text", html: 3 }]),
    "/slides/0/elements/0/html",
  );
  rejects(document([{ id: "p", type: "text" }]), "/slides/0/elements/0/html");
  rejects(
    document([{ id: "p", type: "text", html: "x".repeat(65_537) }]),
    "/slides/0/elements/0/html",
  );
  rejects(
    document([{ id: "p", type: "text", html: "Text", opacity: 1.1 }]),
    "/slides/0/elements/0/opacity",
  );
  rejects(
    document([{
      id: "p",
      type: "text",
      html: "Text",
      fx: { loop: { type: "unknown" } },
    }]),
    "/slides/0/elements/0/fx/loop/type",
  );
  rejects(
    document([{
      id: "p",
      type: "image",
      src: "data:image/png;base64,AA==",
      crop: { x: 0, y: 0, scale: 0 },
    }]),
    "/slides/0/elements/0/crop/scale",
  );
});

Deno.test("Bento contract rejects duplicate IDs within their scope and permits morph repetitions", () => {
  rejects(
    document([{ id: "same", type: "text", html: "A" }, {
      id: "same",
      type: "text",
      html: "B",
    }]),
    "/slides/0/elements/1/id",
  );
  const doc = document();
  (doc.slides as Obj[]).push(structuredClone((doc.slides as Obj[])[0]));
  rejects(doc, "/slides/1/id");
  const valid = document();
  (valid.slides as Obj[]).push({
    id: "second",
    elements: [{ id: "text", type: "text", html: "B" }],
    transition: "morph",
  });
  assertBentoContract(valid);
});

Deno.test("Bento contract rejects invalid chart data rather than letting upstream drop it", () => {
  rejects(
    document([{ id: "chart", type: "chart" }]),
    "/slides/0/elements/0/option",
  );
  rejects(
    document([{ id: "chart", type: "chart", option: [] }]),
    "/slides/0/elements/0/option",
  );
  rejects(
    document([{
      id: "chart",
      type: "chart",
      option: { label: "a".repeat(65_537) },
    }]),
    "/slides/0/elements/0/option/label",
  );
  let deep: unknown = 1;
  for (let i = 0; i < 13; i++) deep = { next: deep };
  rejects(document([{ id: "chart", type: "chart", option: deep }]));
  rejects(
    document([{
      id: "chart",
      type: "chart",
      option: { data: Array(20_001).fill(1) },
    }]),
  );
});

Deno.test("Bento contract rejects values omitted by descriptive schema but dropped by native gates", () => {
  rejects(
    document([{
      id: "p",
      type: "text",
      html: "A",
      shadow: { x: 0, y: 0, blur: 2, color: "red) url(https://example.org/x)" },
    }]),
    "/slides/0/elements/0/shadow/color",
  );
  rejects(
    document([{
      id: "p",
      type: "text",
      html: "A",
      fontFamily: "Arial; display:none",
    }]),
    "/slides/0/elements/0/fontFamily",
  );
  rejects(
    document([{
      id: "p",
      type: "shape",
      shape: "path",
      fill: "#fff",
      d: "javascript:alert(1)",
    }]),
    "/slides/0/elements/0/d",
  );
  rejects(
    document([{ id: "p", type: "image", src: "javascript:alert(1)" }]),
    "/slides/0/elements/0/src",
  );
  rejects(
    document([{
      id: "p",
      type: "text",
      html: "A",
      themeRefs: { color: "not-a-palette-slot" },
    }]),
    "/slides/0/elements/0/themeRefs/color",
  );
  const doc = document();
  (doc.slides as Obj[])[0].background = "url(https://example.org/bg)";
  rejects(doc, "/slides/0/background");
});

Deno.test("Bento contract refuses embedded envelope stripping instead of leaking or silently altering it", () => {
  rejects(
    document([{
      id: "e",
      type: "embed",
      doc: { series: [1], collab: { key: "secret" } },
    }]),
    "/slides/0/elements/0/doc/collab",
  );
  rejects(
    document([{ id: "e", type: "embed", doc: { docId: "other" } }]),
    "/slides/0/elements/0/doc/docId",
  );
});

Deno.test("Bento contract rejects non-JSON values and unsafe prototype keys", () => {
  const doc = document();
  doc.bad = NaN;
  rejects(doc);
  const bad = document();
  bad.bad = new Date();
  rejects(bad);
  const injected = JSON.parse(
    JSON.stringify(document()).replace('"title":', '"__proto__":{},"title":'),
  );
  rejects(injected);
});

Deno.test("Bento contract checks assets/fonts/blob reference fields not fully described by schema", () => {
  const asset = document();
  asset.assets = { "": "data:image/png;base64,AA==" };
  rejects(asset, "/assets/");
  const font = document();
  font.fonts = [{
    family: "Custom",
    asset: "builtin:custom",
    weight: "400;display:none",
  }];
  rejects(font, "/fonts/0/weight");
  const blob = document();
  blob.blobs = {
    image: { key: "key", mime: "image/png", size: 5, unexpected: "lossy" },
  };
  rejects(blob, "/blobs/image");
});
