import { spliceDocument } from "../src/render/html.ts";
import type { BentoDoc as RenderDoc } from "../src/render/types.ts";
import {
  assertProjectDocument,
  BentoContractError,
} from "../src/render/validate.ts";
import {
  captureProject,
  readProject,
  renderProject,
  saveProject,
} from "../src/core/project.ts";
import type { BentoDoc } from "../src/state/types.ts";

const pixel =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==";
const frame = { x: 20, y: 20, w: 80, h: 80, rotation: 0, opacity: 1 };
const image = (src: string) => ({
  ...frame,
  id: "picture",
  type: "image",
  src,
  fit: "contain",
  radius: 0,
});
function assert(value: unknown, message = "assertion failed"): asserts value {
  if (!value) throw new Error(message);
}
function doc(elements: Record<string, unknown>[] = [image(pixel)]): BentoDoc {
  return {
    format: "bento/slides",
    version: 1,
    docId: "offline-resources",
    title: "Resource fixture",
    size: { width: 1280, height: 720 },
    theme: {
      background: "#fff",
      color: "#123",
      accent: "#456",
      fontFamily: "Arial",
    },
    slides: [{
      id: "slide",
      elements,
      notes: "",
      background: "#fff",
      transition: "fade",
    }],
  } as unknown as BentoDoc;
}
function refuses(document: BentoDoc, path: string) {
  const before = JSON.stringify(document);
  try {
    assertProjectDocument(document);
  } catch (error) {
    assert(error instanceof BentoContractError, String(error));
    assert(
      error.details.some((item) => item.path === path),
      JSON.stringify(error.details),
    );
    assert(JSON.stringify(document) === before, "rejection mutated input");
    return;
  }
  throw new Error("expected project resource rejection at " + path);
}

Deno.test("project refuses external transient and missing image/media resources including layouts", () => {
  for (
    const src of [
      "https://example.org/image.png",
      "blob:https://studio.invalid/transient",
      "images/local.png",
      "asset:missing",
    ]
  ) {
    refuses(doc([image(src)]), "/slides/0/elements/0/src");
  }
  const indirect = doc([image("asset:picture")]);
  indirect.assets = { picture: "https://example.org/image.png" };
  refuses(indirect, "/slides/0/elements/0/src");
  indirect.assets.picture = "asset:another";
  indirect.assets.another = pixel;
  refuses(indirect, "/slides/0/elements/0/src");
  const layout = doc();
  layout.layouts = [{
    ...layout.slides[0],
    id: "layout",
    elements: [image("asset:missing")],
  }];
  refuses(layout, "/layouts/0/elements/0/src");
  const media = doc([{
    ...frame,
    id: "media",
    type: "media",
    src: "data:video/mp4;base64,AA==",
    poster: "blob:transient",
    kind: "video",
  }]);
  refuses(media, "/slides/0/elements/0/poster");
});

Deno.test("project requires referenced SVG embed code and font assets but retains embedded data and hyperlinks", () => {
  const cases: [Record<string, unknown>, string][] = [
    [{ ...frame, id: "svg", type: "svg", asset: "missing" }, "asset"],
    [{
      ...frame,
      id: "embed",
      type: "embed",
      app: "test",
      view: "asset:missing",
    }, "view"],
    [{
      ...frame,
      id: "code",
      type: "code",
      content: "x",
      grammarAssetId: "missing",
    }, "grammarAssetId"],
  ];
  for (const [element, field] of cases) {
    refuses(doc([element]), "/slides/0/elements/0/" + field);
  }
  const font = doc();
  font.fonts = [{ family: "Local", asset: "font" }];
  refuses(font, "/fonts/0/asset");
  font.assets = { font: "https://example.org/font.woff2" };
  refuses(font, "/fonts/0/asset");
  font.assets.font = "data:font/woff2;base64,AA==";
  assertProjectDocument(font);
  const embedded = doc([{
    ...image("asset:picture"),
    link: "https://example.org",
  }]);
  embedded.assets = { picture: pixel, unused: "retained raw asset metadata" };
  const before = JSON.stringify(embedded);
  assertProjectDocument(embedded);
  assert(JSON.stringify(embedded) === before);
});

Deno.test("project accepts the pinned shell fonts and case-insensitive data while checking overrides", () => {
  for (const key of ["builtin:fraunces-900", "builtin:instrument-sans"]) {
    const font = doc([image(pixel.replace("data:", "DATA:"))]);
    font.fonts = [{ family: "Native", asset: key }];
    assertProjectDocument(font);
    font.assets = { [key]: "https://example.org/replacement.woff2" };
    refuses(font, "/fonts/0/asset");
    font.assets[key] = "DATA:font/woff2;base64,AA==";
    assertProjectDocument(font);
  }
  const unknown = doc();
  unknown.fonts = [{ family: "Unknown", asset: "builtin:future-font" }];
  refuses(unknown, "/fonts/0/asset");
});

Deno.test("failed project resource save is atomic and embedded native image survives rebuild", async () => {
  const dir = await Deno.makeTempDir({ prefix: "qbento-resource-save-" });
  try {
    const source = dir + "/deck.qmd";
    const original =
      "## Local assets {#local}\n\n::: {#body}\nKeep the source.\n:::\n";
    await Deno.writeTextFile(source, original);
    const first = await renderProject(source);
    const stateBytes = await Deno.readTextFile(dir + "/.qbento/state.json");
    const outputBytes = await Deno.readTextFile(first.output);
    const edited = structuredClone(first.state.emitted);
    edited.slides[0].elements.push(image("asset:missing"));
    try {
      await saveProject(source, edited, first.state.revision);
      throw new Error("invalid resource save succeeded");
    } catch (error) {
      assert(error instanceof BentoContractError, String(error));
    }
    assert(await Deno.readTextFile(dir + "/.qbento/state.json") === stateBytes);
    assert(await Deno.readTextFile(first.output) === outputBytes);
    assert(await Deno.readTextFile(source) === original);
    edited.assets = {
      ...(edited.assets as Record<string, string> ?? {}),
      missing: pixel,
    };
    const saved = await saveProject(source, edited, first.state.revision);
    assert(saved.revision === first.state.revision + 1);
    await Deno.remove(first.output);
    await renderProject(source);
    const reopened = await readProject(source);
    assert(
      reopened.emitted.slides[0].elements.some((el) =>
        el.id === "picture" && el.src === "asset:missing"
      ),
    );
    assert(
      (reopened.emitted.assets as Record<string, string>)?.missing === pixel,
    );
    assert(await Deno.readTextFile(source) === original);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

const localSvg =
  `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"><defs><linearGradient id="paint"><stop offset="0" stop-color="red"/><stop offset="1" stop-color="blue"/></linearGradient><path id="stroke" d="M0 0 L80 80"/></defs><rect width="80" height="80" fill="url(#paint)"/><use href="#stroke"/><image href="${pixel}" width="10" height="10"/><a href="https://example.org"><text y="20">Open source</text></a></svg>`;
const svgElement = (markup: string) => ({
  ...frame,
  id: "diagram",
  type: "svg",
  markup,
});
Deno.test("project rejects nested native SVG resources across inline assets embeds CSS and layouts", () => {
  const bad = [
    '<svg><image href="https://audit.invalid/image"/></svg>',
    '<svg><feImage xlink:href="//audit.invalid/filter"/></svg>',
    '<svg><image href="https&#58;//audit.invalid/entity"/></svg>',
    '<svg><image href="&#104;ttps://audit.invalid/entity"/></svg>',
    '<svg><image href="h&Tab;ttps&colon;//audit.invalid/entity"/></svg>',
    "<svg><image href=https://audit.invalid/unquoted /></svg>",
    '<svg><use href="other.svg#node"/></svg>',
    '<svg><rect fill="url(https://audit.invalid/paint)"/></svg>',
    '<svg><rect fill="u&#114;l&#40;https://audit.invalid/paint&#41;"/></svg>',
    "<svg><style>.x{fill:url(\\68ttps://audit.invalid/paint)}</style></svg>",

    '<svg><rect style="filter: u\\72l(https://audit.invalid/filter)"/></svg>',
    '<svg><style>@im\\70ort "https://audit.invalid/sheet";</style></svg>',
    "<svg><style>.x{fill:url(&quot;https://audit.invalid/paint&quot;)}</style></svg>",
    '<svg><style>.x{background:image-set("https://audit.invalid/image" 1x)}</style></svg>',
    '<svg xml:base="https://audit.invalid"><use href="#local"/></svg>',
    '<!DOCTYPE svg [<!ENTITY external SYSTEM "https://audit.invalid/doctype">]><svg/>',
    '<svg><image href="data:image/svg+xml,%3Csvg%3E%3Cimage%20href%3D%22https%3A%2F%2Faudit.invalid%2Fnested%22%2F%3E%3C%2Fsvg%3E"/></svg>',
  ];
  for (const markup of bad) {
    refuses(doc([svgElement(markup)]), "/slides/0/elements/0/markup");
    const indirect = doc([{
      ...frame,
      id: "diagram",
      type: "svg",
      asset: "diagram",
    }]);
    indirect.assets = { diagram: markup };
    refuses(indirect, "/slides/0/elements/0/asset");
    refuses(
      doc([{ ...frame, id: "embed", type: "embed", app: "web", view: markup }]),
      "/slides/0/elements/0/view",
    );
    const embed = doc([{
      ...frame,
      id: "embed",
      type: "embed",
      app: "web",
      view: "asset:view",
    }]);
    embed.assets = { view: markup };
    refuses(embed, "/slides/0/elements/0/view");
    const layout = doc();
    layout.layouts = [{
      ...layout.slides[0],
      id: "template",
      elements: [svgElement(markup)],
    }];
    refuses(layout, "/layouts/0/elements/0/markup");
  }
  refuses(
    doc([{
      ...svgElement(localSvg),
      css: "rect{fill:url(https://audit.invalid/css)}",
    }]),
    "/slides/0/elements/0/css",
  );
  refuses(
    doc([image("data:image/svg+xml," + encodeURIComponent(bad[0]))]),
    "/slides/0/elements/0/src",
  );
});
Deno.test("project retains native local SVG references embedded raster gradients CSS and empty placeholders unchanged", () => {
  const nested = `<svg><rect width="20" height="20" fill="red"/></svg>`;
  const markup = [
    localSvg,
    "<svg/>",
    '<svg><a href="https://example.invalid/?x=1&filter=ok"><text>Link</text></a></svg>',
    '<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd"><svg/>',
    "<!-- <!ENTITY harmless> --><svg/>",
    '<svg><style>text::before{content:"image(url)"}</style><text>Label</text></svg>',

    "",
    `<svg><image href="data:image/svg+xml,${
      encodeURIComponent(nested)
    }"/></svg>`,
    `<svg><image href="data:image/svg+xml;base64,${btoa(nested)}"/></svg>`,
    '<svg><style><![CDATA[.p{fill:url(#paint);stroke:rgb(0, 40, 50)}]]></style><defs><linearGradient id="paint"/></defs><rect class="p"/></svg>',
    '<svg><use href="&num;local"/><defs><path id="local" d="M0 0 L20 20"/></defs></svg>',
  ];
  for (const value of markup) {
    const document = doc([
      {
        ...svgElement(value),
        css:
          '/* url(https://ignored.invalid) */ rect{filter:blur(1px);fill:url("#paint")}',
      },
      { ...frame, id: "embed", type: "embed", app: "web", view: "asset:view" },
    ]);
    document.assets = { view: value };
    const before = JSON.stringify(document);
    assertProjectDocument(document);
    assert(JSON.stringify(document) === before);
  }
});
Deno.test("external SVG Save and downloaded capture refuse atomically; embedded diagrams survive rebuild", async () => {
  const dir = await Deno.makeTempDir({ prefix: "qbento-svg-resource-" });
  try {
    const source = dir + "/deck.qmd";
    const original = "## Local {#local}\n\n::: {#body}\nKeep source.\n:::\n";
    await Deno.writeTextFile(source, original);
    const first = await renderProject(source);
    const state = await Deno.readTextFile(dir + "/.qbento/state.json");
    const output = await Deno.readTextFile(first.output);
    const remote =
      '<svg><image href="https://audit.invalid/save" width="10" height="10"/></svg>';
    for (
      const element of [
        svgElement(remote),
        { ...frame, id: "diagram", type: "svg", asset: "diagram" },
        { ...frame, id: "embed", type: "embed", app: "web", view: remote },
        {
          ...frame,
          id: "embed",
          type: "embed",
          app: "web",
          view: "asset:diagram",
        },
      ]
    ) {
      const edited = structuredClone(first.state.emitted);
      edited.slides[0].elements.push(element);
      edited.assets = { diagram: remote };
      const downloaded = dir + "/native-download.html";
      const editedHtml = spliceDocument(output, edited as unknown as RenderDoc);
      await Deno.writeTextFile(downloaded, editedHtml);
      for (
        const operation of [
          () => saveProject(source, edited, first.state.revision),
          () => captureProject(source, downloaded),
        ]
      ) {
        try {
          await operation();
          throw new Error("external diagram accepted");
        } catch (error) {
          assert(error instanceof BentoContractError, String(error));
        }
        assert(await Deno.readTextFile(dir + "/.qbento/state.json") === state);
        assert(await Deno.readTextFile(first.output) === output);
        assert(await Deno.readTextFile(source) === original);
        assert(await Deno.readTextFile(downloaded) === editedHtml);
      }
    }
    const local = structuredClone(first.state.emitted);
    local.slides[0].elements.push(svgElement(localSvg));
    const saved = await saveProject(source, local, first.state.revision);
    assert(saved.revision === first.state.revision + 1);
    await Deno.remove(first.output);
    const rebuilt = await renderProject(source);
    assert(
      rebuilt.state.emitted.slides[0].elements.find((e) => e.id === "diagram")
        ?.markup === localSvg,
    );
    assert(await Deno.readTextFile(source) === original);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
