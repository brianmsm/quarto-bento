import {
  applyComponentDesign,
  applyElementDesign,
  designTheme,
  type PandocAttr,
  parseDesignAttributes,
  validateDesignDefaults,
} from "../src/render/design.ts";
import {
  applyAttributePatches,
  previewAttributePatches,
} from "../src/source/attributes.ts";
import { scanSource } from "../src/source/mod.ts";
import {
  type BentoDoc,
  captureEdits,
  compose,
  createState,
  targetKey,
} from "../src/state/mod.ts";
import { executeQuarto } from "../src/render/quarto.ts";
import type { Element, Node } from "../src/render/types.ts";
function assert(v: unknown, m = "assertion failed"): asserts v {
  if (!v) throw new Error(m);
}
function throws(fn: () => unknown, code: string) {
  try {
    fn();
  } catch (e) {
    assert(
      (String(e) + " " +
        (e && typeof e === "object" && "code" in e ? e.code : "")).includes(
          code,
        ),
      String(e),
    );
    return;
  }
  throw new Error(`expected ${code}`);
}
const text = (id = "text"): Element => ({
  id,
  type: "text",
  x: 80,
  y: 166,
  w: 400,
  h: 80,
  rotation: 0,
  opacity: 1,
  fontSize: 26,
  fontFamily: "Arial",
  fontWeight: 400,
  color: "#172a35",
  align: "left",
  valign: "top",
  lineHeight: 1.25,
  html: "Meaningful text",
});
const doc = (element: Element): BentoDoc => ({
  docId: "test",
  slides: [{ id: "results", elements: [element] }],
});
Deno.test("native visual attributes preserve plain content and mark source ownership", () => {
  const bare = parseDesignAttributes(["", ["ordinary"], [[
    "data-example",
    "ignored by design",
  ]]]);
  assert(
    JSON.stringify(applyElementDesign(text(), bare).element) ===
      JSON.stringify(text()),
  );
  const declared = parseDesignAttributes(["finding", [], [["x", "84"], [
    "font-size",
    "30",
  ], ["color", "#123456"]]]);
  const applied = applyElementDesign(text(), declared);
  assert(
    applied.element.x === 84 && applied.element.fontSize === 30 &&
      applied.bindings.fontSize === "font-size",
  );
  const key = targetKey({ slideId: "results", elementId: "text" });
  let state = createState(doc(applied.element), {}, {
    [key]: applied.ownedPaths,
  });
  const edited = structuredClone(state.emitted);
  edited.slides[0].elements[0].x = 120;
  edited.slides[0].elements[0].y = 200;
  state = captureEdits(state, edited);
  assert(
    state.pending.some((p) => p.path[0] === "x" && p.status === "bento-ahead"),
  );
  assert(!state.overrides.some((o) => o.fields.some((f) => f.path[0] === "x")));
  assert(state.overrides.some((o) => o.fields.some((f) => f.path[0] === "y")));
  const fresh = doc({ ...applied.element, x: 99 });
  const merged = compose(state, fresh, {}, { [key]: applied.ownedPaths }, {
    strict: false,
  });
  assert(
    merged.state.pending.some((p) =>
      p.path[0] === "x" && p.status === "conflict"
    ),
  );
});
Deno.test("malformed/injected/unsupported attributes fail explicitly", () => {
  for (
    const [key, value] of [
      ["x", "NaN"],
      ["w", "-5"],
      ["opacity", "2"],
      ["font-size", "1e309"],
      ["fill", "url(https://example.com)"],
      ["color", "red;display:none"],
      ["font-family", "Arial; color:red"],
      ["align", "justify"],
    ]
  ) {
    throws(
      () => parseDesignAttributes(["id", [], [[key, value]]]),
      "INVALID_DESIGN_VALUE",
    );
  }
  throws(
    () =>
      parseDesignAttributes(["id", [], [["font-size", "20"], [
        "fontSize",
        "30",
      ]]]),
    "DUPLICATE_DESIGN_ATTRIBUTE",
  );
  throws(
    () => parseDesignAttributes(["id", ["bento-unsupported-test"], []]),
    "UNSUPPORTED_COMPONENT",
  );
  throws(
    () => parseDesignAttributes(["", ["bento-card"], []]),
    "COMPONENT_ID_REQUIRED",
  );
  throws(
    () => parseDesignAttributes(["id", ["bento-card"], [["onclick", "evil"]]]),
    "UNSUPPORTED_DESIGN_ATTRIBUTE",
  );
  const forged = parseDesignAttributes(["id", [], [["x", "5"]]]);
  forged.properties.src = "javascript:bad";
  forged.bindings.src = "src";
  throws(() => applyElementDesign(text(), forged), "INVALID_DECLARATION");
  throws(
    () =>
      applyElementDesign(
        { ...text(), type: "image" },
        parseDesignAttributes(["id", [], [["font-size", "40"]]]),
      ),
    "DESIGN_TARGET_MISMATCH",
  );
});
Deno.test("byte-bounded attribute sync preserves quotes UTF-8 CRLF classes and computation", () => {
  const qmd =
    "---\r\ntitle: Café\r\n---\r\n\r\n## Resultados {#resultados}\r\n\r\n::: {#finding .bento-card x='84' y=166 w=530 h=320}\r\nTexto español: β = .32.\r\n:::\r\n\r\n```{r}\r\n#| label: fig-values\r\nx <- 1\r\n```\r\n";
  const source = scanSource(qmd);
  const preview = previewAttributePatches(source, [{
    blockId: "finding",
    attribute: "x",
    expected: "84",
    value: 96,
  }, { blockId: "finding", attribute: "font-size", value: 28 }]);
  assert(
    preview.patches[0].expected === "84" &&
      preview.patches[0].replacement === "96",
  );
  const changed = applyAttributePatches(qmd, preview);
  assert(
    changed ===
      qmd.replace("x='84'", "x='96'").replace(
        "h=320}",
        'h=320 font-size="28"}',
      ),
  );
  assert(!changed.replaceAll("\r\n", "").includes("\n"));
  throws(() => applyAttributePatches(qmd + "\r\n", preview), "stale-source");
  const tampered = structuredClone(preview);
  tampered.patches[0].span.start = 0;
  throws(() => applyAttributePatches(qmd, tampered), "invalid-preview");
  throws(
    () =>
      previewAttributePatches(source, [{
        blockId: "fig-values",
        attribute: "x",
        value: 9,
      }]),
    "unsupported-attribute-target",
  );
  throws(
    () =>
      previewAttributePatches(source, [{
        blockId: "finding",
        attribute: "x",
        value: '1" onclick="evil',
      }]),
    "INVALID_DESIGN_VALUE",
  );
  throws(
    () =>
      previewAttributePatches(source, [{
        blockId: "finding",
        attribute: "id",
        value: "other",
      }]),
    "unsupported-attribute",
  );
});
Deno.test("attribute insertion/removal and displayed-code edits remain surgical", () => {
  const qmd =
    '## Results {#results x=10}\n\n```{.python #shown-code font-size="20"}\nprint("hi")\n```\n';
  const preview = previewAttributePatches(scanSource(qmd), [{
    blockId: "results",
    attribute: "x",
    value: null,
  }, { blockId: "shown-code", attribute: "font-size", value: 24 }]);
  assert(
    applyAttributePatches(qmd, preview) ===
      qmd.replace("x=10", "").replace('font-size="20"', 'font-size="24"'),
  );
  const aliases = "## Results {#results font-size=20}\n";
  throws(
    () =>
      previewAttributePatches(scanSource(aliases), [{
        blockId: "results",
        attribute: "fontSize",
        value: 30,
      }]),
    "DUPLICATE_DESIGN_ATTRIBUTE",
  );
  throws(
    () =>
      previewAttributePatches(scanSource("## Plain\n"), [{
        blockId: scanSource("## Plain\n").blocks[0].id,
        attribute: "x",
        value: 10,
      }]),
    "unmapped",
  );
});
Deno.test("cards and reusable two-column layouts generate native groups and preserve sidecar defaults", () => {
  const left = applyComponentDesign(
    [[text("first")], [text("second")]],
    parseDesignAttributes(["left", ["bento-card"], [["fill", "#eefaff"], [
      "font-size",
      "28",
    ]]]),
  );
  assert(
    left.elements.length === 3 &&
      left.decorativeIds[0] === "left/qb-card-background",
  );
  assert(left.elements.every((e) => e.groupId === "left"));
  assert(left.ownershipByElement.first.includes("fontSize"));
  assert(
    !left.ownershipByElement.first.includes("x"),
    "default geometry should remain sidecar-owned",
  );
  const right = applyComponentDesign(
    [[text("right-text")]],
    parseDesignAttributes(["right", ["bento-card"], []]),
  );
  const layout = applyComponentDesign(
    [left.elements, right.elements],
    parseDesignAttributes(["layout", ["bento-layout"], [[
      "layout",
      "two-column",
    ]]]),
  );
  assert(
    Number(
      layout.elements.find((e) => e.id === "right/qb-card-background")?.x,
    ) > 600,
  );
  const state = createState({
    docId: "test",
    theme: designTheme(),
    slides: [{ id: "results", elements: layout.elements }],
  });
  const edited = structuredClone(state.emitted);
  edited.theme = { ...designTheme(), accent: "#ff0000" };
  edited.slides[0].elements[0].x = 33;
  const saved = captureEdits(state, edited);
  const next = compose(saved, {
    docId: "test",
    theme: designTheme(),
    slides: [{ id: "results", elements: layout.elements }],
  }).document;
  assert(
    (next.theme as Record<string, unknown>).accent === "#ff0000" &&
      next.slides[0].elements[0].x === 33,
  );
  const explicit = applyComponentDesign(
    [[text()]],
    parseDesignAttributes(["card", ["bento-card"], [["x", "100"]]]),
  );
  assert(
    explicit.ownershipByElement.text.includes("x") &&
      !explicit.bindingsByElement.text?.x,
    "coupled child geometry must not guess a parent patch",
  );
  throws(
    () =>
      applyComponentDesign(
        [[text()]],
        parseDesignAttributes(["layout", ["bento-layout"], [[
          "layout",
          "two-column",
        ]]]),
      ),
    "LAYOUT_ARITY",
  );
  throws(
    () =>
      validateDesignDefaults({
        layouts: { bad: { columns: 0, gap: 2, padding: 0 } },
      }),
    "INVALID_LAYOUT",
  );
  const schema = JSON.parse(
    Deno.readTextFileSync(
      new URL("../vendor/bento/slides.schema.json", import.meta.url),
    ),
  );
  for (const element of layout.elements) {
    for (const key of Object.keys(element)) {
      assert(
        key in schema.$defs[element.type].properties,
        `non-native field ${key}`,
      );
    }
  }
});
Deno.test("real Quarto execution retains visual attributes and named computed chunk identity", async () => {
  const temp = await Deno.makeTempDir({ prefix: "qbento-design-" });
  try {
    const source = `${temp}/deck.qmd`;
    await Deno.writeTextFile(
      source,
      '## Results {#results x="90"}\n\n::: {#card .bento-card x="84" y="166" w="530" h="320" font-size="28"}\n### Finding\nLiteral authored text.\n\n```{r}\n#| label: fig-values\n#| echo: false\n#| dev: svg\nplot(1:3)\n```\n:::\n',
    );
    const ast = await executeQuarto(source, `${temp}/build`);
    const attrs: PandocAttr[] = [];
    const walk = (value: unknown) => {
      if (Array.isArray(value)) value.forEach(walk);
      else if (value && typeof value === "object") {
        const node = value as Node;
        if (node.t === "Div") attrs.push((node.c as [PandocAttr, Node[]])[0]);
        if ("c" in node) walk(node.c);
      }
    };
    walk(ast.blocks);
    const card = attrs.find((a) => a[0] === "card");
    assert(card, "Quarto dropped component ID");
    const design = parseDesignAttributes(card);
    assert(design.properties.x === 84 && design.properties.fontSize === 28);
    assert(
      attrs.some((a) => a[0] === "fig-values"),
      "named figure identity missing",
    );
  } finally {
    await Deno.remove(temp, { recursive: true });
  }
});
