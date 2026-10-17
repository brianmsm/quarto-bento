import { previewSync } from "../src/core/sync.ts";
import type { JsonObject } from "../src/state/types.ts";
import {
  readProject,
  renderProject,
  saveProject,
} from "../src/core/project.ts";
import { installQuartoProject } from "../src/integration/install.ts";
import { assertDesignRegistryUnchanged } from "../src/render/registry.ts";
function assert(v: unknown, message = "assertion failed"): asserts v {
  if (!v) throw new Error(message);
}
async function refuses(fn: () => Promise<unknown>, code: string) {
  try {
    await fn();
  } catch (error) {
    assert(
      String(error).includes(code) ||
        (error as { code?: string }).code === code,
      String(error),
    );
    return;
  }
  throw new Error(`expected ${code}`);
}
const forest = {
  background: "#e8fff0",
  color: "#123a24",
  accent: "#26734a",
  fontFamily: "Arial, sans-serif",
};
const sky = {
  background: "#eefaff",
  color: "#17384a",
  accent: "#2266aa",
  fontFamily: "Georgia, serif",
};
const registry = (activeTheme = "forest") => ({
  schemaVersion: 1,
  layouts: { three: { columns: 3, gap: 20, padding: 10 } },
  themes: { forest, sky },
  activeTheme,
});
const grid = (id: string) =>
  `::::: {#${id} .bento-layout bento-layout-name="three"}\n\n:::: {#${id}-a .bento-card}\n\n### First\n\nAlpha.\n\n::::\n\n:::: {#${id}-b .bento-card}\n\n### Second\n\n::: {#${id}-literal color="#663399"}\nBeta.\n:::\n\n::::\n\n:::: {#${id}-c .bento-card}\n\n### Third\n\nGamma.\n\n::::\n\n:::::\n`;
Deno.test("real Quarto named registry rebuild retains sparse native theme/motion/morph and explicit QMD design", async () => {
  const dir = await Deno.makeTempDir({ prefix: "qbento-registry-loop-" });
  const moved = await Deno.makeTempDir({
    prefix: "qbento-registry-relocated-",
  });
  try {
    const source = `${dir}/deck.qmd`;
    const original = `## First {#first}\n\n${
      grid("one")
    }\n## Second {#second}\n\n${grid("two")}`;
    await Deno.writeTextFile(source, original);
    await Deno.mkdir(`${dir}/.qbento`);
    await Deno.writeTextFile(
      `${dir}/.qbento/design.json`,
      JSON.stringify(registry()),
    );
    const first = await renderProject(source);
    const doc = first.state.emitted;
    assert(
      (doc.theme as JsonObject)?.background === forest.background &&
        (doc.theme as JsonObject)?.color === forest.color,
    );
    assert(doc.slides.every((s) => s.background === forest.background));
    for (const [index, id] of ["one", "two"].entries()) {
      const e = doc.slides[index].elements;
      assert(
        e.find((e) => e.id === `${id}-a/qb-card-background`)!.w ===
          (1120 - 20 - 40) / 3,
      );
      assert(
        e.find((e) => e.id === `${id}-a/paragraph:1`)!.color === forest.color,
      );
      assert(
        e.find((e) => e.id === `${id}-literal/paragraph:1`)!.color ===
          "#663399",
      );
    }
    const native = structuredClone(doc);
    native.theme = {
      ...(native.theme as JsonObject),
      accent: "#ff8800",
      codePalette: { c: "#123456", s: "#654321" },
      palette: { accent2: "#aa3377", bg2: "#fff3dd" },
    };
    native.present = { morphSeconds: .2, controls: true, slideNumber: true };
    native.slides[1].transition = "morph";
    native.slides[0].elements.find((e) => e.id === "one-a/paragraph:1")!
      .morphId = "alpha-pair";
    const target = native.slides[1].elements.find((e) =>
      e.id === "two-a/paragraph:1"
    )!;
    target.morphId = "alpha-pair";
    target.themeRefs = { color: "accent2" };
    target.color = "#aa3377";
    target.fx = { enter: "fade-up", enterDur: .3, step: 1 };
    target.x = 150;
    const saved = await saveProject(source, native, first.state.revision);
    assert(saved.pending.length === 0);
    await Deno.writeTextFile(
      `${dir}/.qbento/design.json`,
      JSON.stringify(registry("sky")),
    );
    const next = await renderProject(source);
    assert(
      next.state.docId === first.state.docId && next.state.pending.length === 0,
    );
    assert(
      (next.state.emitted.theme as JsonObject)?.accent === "#ff8800" &&
        (next.state.emitted.theme as JsonObject)?.background === sky.background,
    );
    assert(
      JSON.stringify((next.state.emitted.theme as JsonObject)?.codePalette) ===
        JSON.stringify((native.theme as JsonObject).codePalette),
    );
    const retained = next.state.emitted.slides[1].elements.find((e) =>
      e.id === target.id
    )!;
    assert(
      retained.x === 150 && retained.morphId === "alpha-pair" &&
        retained.color === "#aa3377" &&
        JSON.stringify(retained.themeRefs) ===
          JSON.stringify(target.themeRefs) &&
        JSON.stringify(retained.fx) === JSON.stringify(target.fx),
    );
    assert(
      next.state.emitted.slides[1].transition === "morph" &&
        JSON.stringify(next.state.emitted.present) ===
          JSON.stringify(native.present),
    );
    assert(
      next.state.emitted.slides[0].elements.find((e) =>
        e.id === "one-a/paragraph:1"
      )!.fontFamily === sky.fontFamily,
    );
    assert(await Deno.readTextFile(source) === original);
    await Deno.mkdir(`${moved}/.qbento`);
    await Deno.copyFile(source, `${moved}/deck.qmd`);
    await Deno.copyFile(
      `${dir}/.qbento/design.json`,
      `${moved}/.qbento/design.json`,
    );
    await Deno.copyFile(
      `${dir}/.qbento/state.json`,
      `${moved}/.qbento/state.json`,
    );
    const rebuild = await renderProject(`${moved}/deck.qmd`);
    assert(
      JSON.stringify(rebuild.state.emitted) ===
        JSON.stringify(next.state.emitted),
      "relocated clean rebuild diverged",
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
    await Deno.remove(moved, { recursive: true });
  }
});
Deno.test("invalid registry refuses before CLI and ordinary Quarto execute; changed registry aborts publication", async () => {
  const dir = await Deno.makeTempDir({ prefix: "qbento-registry-preflight-" });
  try {
    const source = `${dir}/deck.qmd`;
    const original =
      '## Test {#test}\n\n```{r}\nfile.create("producer-ran")\n1\n```\n';
    await Deno.writeTextFile(source, original);
    await Deno.mkdir(`${dir}/.qbento`);
    await Deno.writeTextFile(
      `${dir}/.qbento/design.json`,
      '{"schemaVersion":2}',
    );
    await refuses(() => renderProject(source), "INVALID_DESIGN_REGISTRY");
    await installQuartoProject(source);
    const ordinary = await new Deno.Command("quarto", {
      args: ["render", "deck.qmd"],
      cwd: dir,
      stdout: "piped",
      stderr: "piped",
    }).output();
    assert(
      !ordinary.success &&
        new TextDecoder().decode(ordinary.stderr).includes(
          "INVALID_DESIGN_REGISTRY",
        ),
    );
    try {
      await Deno.stat(`${dir}/producer-ran`);
      throw new Error("producer executed");
    } catch (error) {
      assert(error instanceof Deno.errors.NotFound, String(error));
    }
    assert(await Deno.readTextFile(source) === original);
    await Deno.writeTextFile(
      `${dir}/.qbento/design.json`,
      '{"schemaVersion":1}',
    );
    await Deno.writeTextFile(
      source,
      '## Test {#test}\n\n```{r}\nwriteLines(\'{"schemaVersion":1,"layouts":{}}\',".qbento/design.json")\n1\n```\n',
    );
    await refuses(() => renderProject(source), "DESIGN_REGISTRY_CHANGED");
    try {
      await readProject(source);
      throw new Error("changed registry published baseline");
    } catch (error) {
      assert(
        (error as { code?: string }).code === "NO_BASELINE",
        String(error),
      );
    }
    await refuses(
      () => assertDesignRegistryUnchanged(dir, null),
      "DESIGN_REGISTRY_CHANGED",
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("native palette refs on source-owned objects remain pending and semantic refs refuse", async () => {
  const dir = await Deno.makeTempDir({ prefix: "qbento-owned-palette-" });
  try {
    const source = `${dir}/deck.qmd`;
    const original =
      '## Slide {#slide}\n\n::: {#body color="#663399"}\nText.\n:::\n';
    await Deno.writeTextFile(source, original);
    await Deno.mkdir(`${dir}/.qbento`);
    const config = (accent: string) => ({
      schemaVersion: 1,
      activeTheme: "review",
      themes: {
        review: {
          background: "#ffffff",
          color: "#172a35",
          accent,
          fontFamily: "Arial, sans-serif",
        },
      },
    });
    await Deno.writeTextFile(
      `${dir}/.qbento/design.json`,
      JSON.stringify(config("#663399")),
    );
    const first = await renderProject(source);
    const edited = structuredClone(first.state.emitted);
    const element = edited.slides[0].elements.find((e) =>
      e.id === "body/paragraph:1"
    )!;
    element.themeRefs = { color: "accent1" };
    const saved = await saveProject(source, edited, first.state.revision);
    assert(saved.pending.some((change) => change.path[0] === "themeRefs"));
    assert(
      !saved.overrides.some((change) =>
        change.fields.some((field) => field.path[0] === "themeRefs")
      ),
    );
    await refuses(() => previewSync(source), "UNMAPPED_DESIGN");
    await installQuartoProject(source);
    await Deno.writeTextFile(
      source,
      original + '\n```{r}\nfile.create("producer-ran")\n1\n```\n',
    );
    const ordinary = await new Deno.Command("quarto", {
      args: ["render", "deck.qmd"],
      cwd: dir,
      stdout: "piped",
      stderr: "piped",
    }).output();
    assert(
      !ordinary.success &&
        new TextDecoder().decode(ordinary.stderr).includes("UNMAPPED_DESIGN"),
    );
    try {
      await Deno.stat(`${dir}/producer-ran`);
      throw new Error("producer executed despite owned reference");
    } catch (error) {
      assert(error instanceof Deno.errors.NotFound, String(error));
    }
    await Deno.writeTextFile(source, original);
    await Deno.writeTextFile(
      `${dir}/.qbento/design.json`,
      JSON.stringify(config("#2266aa")),
    );
    await refuses(() => renderProject(source), "UNMAPPED_DESIGN");
    assert(
      (await readProject(source)).revision === saved.revision &&
        await Deno.readTextFile(source) === original,
    );
    const cleared = structuredClone(saved.emitted);
    delete cleared.slides[0].elements.find((e) => e.id === element.id)!
      .themeRefs;
    const resolved = await saveProject(source, cleared, saved.revision);
    assert(resolved.pending.length === 0);
    const next = await renderProject(source);
    assert(
      next.state.emitted.slides[0].elements.find((e) => e.id === element.id)!
        .color === "#663399",
    );
    const semantic = structuredClone(next.state.emitted);
    semantic.slides[0].elements.find((e) => e.id === element.id)!.themeRefs = {
      html: "accent1",
    };
    await refuses(
      () => saveProject(source, semantic, next.state.revision),
      "UNSUPPORTED_THEME_REFERENCE",
    );
    assert((await readProject(source)).revision === next.state.revision);
    const slideRef = structuredClone(next.state.emitted);
    slideRef.slides[0].themeRefs = { notes: "accent1" };
    await refuses(
      () => saveProject(source, slideRef, next.state.revision),
      "UNSUPPORTED_THEME_REFERENCE",
    );
    const layoutRef = structuredClone(next.state.emitted);
    layoutRef.layouts = [{
      id: "template",
      elements: [],
      notes: "Do not replace",
      themeRefs: { notes: "accent1" },
    }];
    await refuses(
      () => saveProject(source, layoutRef, next.state.revision),
      "UNSUPPORTED_THEME_REFERENCE",
    );
    const elementRef = structuredClone(next.state.emitted);
    elementRef.layouts = [{
      id: "template",
      elements: [{
        ...structuredClone(
          next.state.emitted.slides[0].elements.find((e) =>
            e.id === element.id
          )!,
        ),
        themeRefs: { html: "accent1" },
      }],
    }];
    await refuses(
      () => saveProject(source, elementRef, next.state.revision),
      "UNSUPPORTED_THEME_REFERENCE",
    );
    const resourceRef = structuredClone(next.state.emitted);
    resourceRef.slides[0].elements.find((e) => e.id === element.id)!.themeRefs =
      { poster: "accent1" };
    await refuses(
      () => saveProject(source, resourceRef, next.state.revision),
      "UNSUPPORTED_THEME_REFERENCE",
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
