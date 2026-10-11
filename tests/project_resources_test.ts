import {
  assertProjectDocument,
  BentoContractError,
} from "../src/render/validate.ts";
import {
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
