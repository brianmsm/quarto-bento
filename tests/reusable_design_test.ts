import type { BentoDoc as StateDoc } from "../src/state/types.ts";
import {
  type DesignDefaults,
  type DesignTheme,
  designTheme,
  parseDesignAttributes,
} from "../src/render/design.ts";
import { validateDesignRegistry } from "../src/render/registry.ts";
import {
  projectAst,
  validateProjectionOrigins,
} from "../src/render/project.ts";
import { assertReusableDesignSource } from "../src/render/theme-styles.ts";
import { scanSource } from "../src/source/mod.ts";
import type { Ast, Node } from "../src/render/types.ts";
import { captureEdits, compose, createState } from "../src/state/mod.ts";

function assert(value: unknown, message = "assertion failed"): asserts value {
  if (!value) throw new Error(message);
}
function refuses(fn: () => unknown, code: string) {
  try {
    fn();
  } catch (error) {
    assert(String(error).includes(code), String(error));
    return;
  }
  throw new Error(`expected ${code}`);
}
import { reusableTheme } from "./fixtures/reusable-design.ts";
const defaults: DesignDefaults = { theme: reusableTheme };
const registry = (theme: unknown) => ({
  schemaVersion: 1,
  themes: { spp: theme },
  activeTheme: "spp",
});
const para = (value: string): Node => ({
  t: "Para",
  c: [{ t: "Str", c: value }],
});
const header = (
  id: string,
  title: string,
  attrs: [string, string][] = [],
): Node => ({ t: "Header", c: [2, [id, [], attrs], [{ t: "Str", c: title }]] });
const div = (
  id: string,
  children: Node[],
  classes: string[] = [],
  attrs: [string, string][] = [],
): Node => ({ t: "Div", c: [[id, classes, attrs], children] });
const sourceText =
  `## Content {#content}\n\n::: {#question .bento-card bento-style="question"}\n\n### Finding {#finding color="#234923"}\n\n::: {#literal color="#993355"}\nBody.\n:::\n\n::: {#caption bento-style="caption"}\nCaption.\n:::\n\n:::\n\n## Section {#section bento-variant="section"}\n\nSection body.\n\n## Following {#following}\n\nFollowing body.\n`;
function fixture(): Ast {
  return {
    meta: {},
    blocks: [
      header("content", "Content"),
      // Deliberately erased style and variant attributes: original-source mapping restores them.
      div("question", [
        {
          t: "Header",
          c: [3, ["finding", [], [["color", "#234923"]]], [{
            t: "Str",
            c: "Finding",
          }]],
        },
        div("literal", [para("Body.")], [], [["color", "#993355"]]),
        div("caption", [para("Caption.")]),
      ], ["bento-card"]),
      header("section", "Section"),
      para("Section body."),
      header("following", "Following"),
      para("Following body."),
    ],
  };
}
async function projection(theme: DesignTheme = reusableTheme) {
  const source = scanSource(sourceText);
  const result = await projectAst(
    fixture(),
    "theme-test",
    [],
    source,
    new Map(),
    { theme },
    new Map(),
    new Map(),
    new Map(),
    new Map(),
  );
  return validateProjectionOrigins(source, result, undefined, { theme });
}
Deno.test("reusable design schema remains v1 pure bounded data and emits native base theme only", () => {
  validateDesignRegistry(registry(reusableTheme));
  assert(
    Object.keys(designTheme(defaults)).sort().join() ===
      "accent,background,color,fontFamily",
  );
  const base = {
    background: "white",
    color: "black",
    accent: "teal",
    fontFamily: "Arial",
  };
  assert(JSON.stringify(designTheme({ theme: base })) === JSON.stringify(base));
  for (
    const extra of [
      { styles: { title: { css: "display:none" } } },
      { styles: { mystery: {} } },
      { styles: { code: { fontWeight: 700 } } },
      { styles: { card: { fill: "url(https://example.com/a)" } } },
      {
        namedStyles: {
          question: {
            target: "text",
            properties: { src: "https://example.com" },
          },
        },
      },
      { namedStyles: { "../unsafe": { target: "text", properties: {} } } },
      { namedStyles: { unsafe: { target: "image", properties: {} } } },
      { styles: { title: { fontSize: "25" } } },
      { styles: { title: { fontFamily: "url(a)" } } },
      { styles: { title: { themeRefs: {} } } },
      { variants: { content: { content: "semantic text" } } },
      {
        variants: { content: { titleFrame: { x: 1200, y: 0, w: 100, h: 80 } } },
      },
      {
        variants: {
          content: {
            decorations: [{
              id: "bar",
              x: 0,
              y: 0,
              w: 1280,
              h: 80,
              fill: "url(a)",
            }],
          },
        },
      },
      {
        variants: {
          content: {
            decorations: [{
              id: "bar",
              x: "0",
              y: 0,
              w: 1280,
              h: 80,
              fill: "black",
            }],
          },
        },
      },
      { defaultVariant: "missing" },
    ]
  ) {
    try {
      validateDesignRegistry(registry({ ...reusableTheme, ...extra }));
      throw new Error("invalid theme accepted");
    } catch (error) {
      assert(String(error) !== "Error: invalid theme accepted");
    }
  }
});
Deno.test("reusable design selectors require known names, source IDs and compatible targets", () => {
  refuses(
    () => parseDesignAttributes(["", [], [["bento-style", "caption"]]]),
    "INVALID_DESIGN_REFERENCE",
  );
  for (
    const [qmd, code] of [
      ['## Slide {#slide bento-style="missing"}\n', "UNKNOWN_STYLE"],
      ['## Slide {#slide bento-variant="missing"}\n', "UNKNOWN_VARIANT"],
      [
        '### Slide {#slide bento-variant="section"}\n',
        "VARIANT_TARGET_MISMATCH",
      ],
      ['## Slide {#slide bento-style="question"}\n', "STYLE_TARGET_MISMATCH"],
      [
        '## Slide {#slide}\n\n::: {#body bento-variant="section"}\nBody.\n:::\n',
        "VARIANT_TARGET_MISMATCH",
      ],
      [
        '## Slide {#slide}\n\n::: {#body .bento-layout bento-layout-name="two-column" bento-style="caption"}\nBody.\n:::\n',
        "STYLE_TARGET_MISMATCH",
      ],
    ]
  ) refuses(() => assertReusableDesignSource(scanSource(qmd), defaults), code);
  refuses(
    () =>
      assertReusableDesignSource(
        scanSource('## Slide {#slide bento-variant="section"}\n'),
      ),
    "UNKNOWN_VARIANT",
  );
  assertReusableDesignSource(
    scanSource("## Mention bento-style=caption in prose\n"),
    defaults,
  );
  // KPI's established bento-role vocabulary remains separate.
  assert(
    parseDesignAttributes(["value", [], [["bento-role", "value"]]]).style ===
      undefined,
  );
});
Deno.test("source preflight checks layout arity using direct children rather than their nested content", () => {
  const qmd = `## Slide {#slide}

::::: {#outer .bento-layout bento-layout-name="pair"}
<!-- A comment does not add a column. -->
:::: {#left .bento-layout bento-layout-name="two-column"}
::: {#first}
First.
:::
::: {#second}
Second.
:::
::::
::: {#right}
### Heading {#heading}
Body.
:::
:::::
`;
  const source = scanSource(qmd);
  assert(source.diagnostics.length === 0);
  const layouts = { pair: { columns: 2, gap: 16, padding: 12 } };
  assertReusableDesignSource(source, { layouts });
  for (const columns of [1, 3]) {
    refuses(() =>
      assertReusableDesignSource(source, {
        layouts: { pair: { ...layouts.pair, columns } },
      }), "LAYOUT_ARITY");
  }
});

Deno.test("source preflight checks named styles against authored content inside plain and nested divs", () => {
  for (
    const [content, compatible, incompatible] of [
      ["A caption.", "caption", "snippet"],
      ["### A caption heading {#heading}", "caption", "snippet"],
      ["- First\n- Second", "caption", "snippet"],
      ["```r\nx <- 1\n```", "snippet", "caption"],
    ]
  ) {
    for (const nested of [false, true]) {
      const body = nested ? `::: {#inner}\n${content}\n:::` : content;
      const qmd = (style: string) =>
        `## Slide {#slide}\n\n:::: {#wrapper bento-style="${style}"}\n${body}\n::::\n`;
      assertReusableDesignSource(scanSource(qmd(compatible)), defaults);
      refuses(
        () =>
          assertReusableDesignSource(scanSource(qmd(incompatible)), defaults),
        "STYLE_TARGET_MISMATCH",
      );
    }
  }
});
Deno.test("styles apply before component measurement, preserve explicit QMD, and variants reset on following slides", async () => {
  const result = await projection();
  const [content, section, following] = result.document.slides;
  const elements = content.elements;
  const background = elements.find((element) =>
    element.id === "question/qb-card-background"
  )!;
  assert(background.fill === "#fff0f6" && background.stroke === "#b11562");
  assert(
    elements.find((element) => element.id === "finding")?.color === "#234923",
  );
  assert(
    elements.find((element) => element.id === "literal/paragraph:1")?.color ===
      "#993355",
  );
  const caption = elements.find((element) =>
    element.id === "caption/paragraph:1"
  )!;
  assert(
    caption.fontSize === 18 && caption.align === "center" &&
      caption.color === "#777777",
  );
  assert(
    section.background === "#b11562" && section.elements[0].fontSize === 58 &&
      section.elements[0].y === 220,
  );
  assert(
    following.background === "#fafafa" &&
      following.elements.find((element) => element.id === "following-title")
          ?.y === 30,
  );
  assert(
    following.elements.find((element) =>
      String(element.id).includes("paragraph")
    )?.y === 170,
  );
  assert(content.elements[0].id === "content/qb-theme/content/title-bar");
  assert(result.origins.content[content.elements[0].id].designOnly === true);
  assert(
    !Object.keys(result.design?.content?.[caption.id] ?? {}).includes(
      "fontSize",
    ),
  );
  const schema = JSON.parse(
    await Deno.readTextFile(
      new URL("../vendor/bento/slides.schema.json", import.meta.url),
    ),
  );
  for (const slide of result.document.slides) {
    for (const element of slide.elements) {
      for (const key of Object.keys(element)) {
        assert(
          key in schema.$defs[element.type].properties,
          `non-native ${key}`,
        );
      }
    }
  }
});
Deno.test("theme decorations require exact selected variant and original-slide provenance", async () => {
  const source = scanSource(sourceText), result = await projection();
  const changed = structuredClone(result);
  changed.document.slides[0].elements[0].fill = "red";
  refuses(
    () => validateProjectionOrigins(source, changed, undefined, defaults),
    "UNMAPPED_THEME_DESIGN",
  );
  const moved = structuredClone(result),
    element = moved.document.slides[0].elements.shift()!;
  moved.document.slides[2].elements.push(element);
  moved.origins.following[element.id] = moved.origins.content[element.id];
  delete moved.origins.content[element.id];
  refuses(
    () => validateProjectionOrigins(source, moved, undefined, defaults),
    "UNMAPPED_COMPONENT_DESIGN",
  );
  refuses(() => validateProjectionOrigins(source, result), "UNKNOWN_STYLE");
});
Deno.test("registry style defaults retain native typography and decorative overrides across theme changes", async () => {
  const first = await projection(),
    state = createState(first.document as unknown as StateDoc);
  const edited = structuredClone(state.emitted);
  edited.slides[0].elements.find((element) =>
    element.id === "caption/paragraph:1"
  )!.fontSize = 22;
  edited.slides[0].elements[0].fill = "#556677";
  const saved = captureEdits(state, edited);
  assert(saved.pending.length === 0);
  const nextTheme = structuredClone(reusableTheme);
  nextTheme.styles!.body!.fontSize = 25;
  nextTheme.namedStyles!.caption.properties.fontSize = 19;
  nextTheme.variants!.content.decorations![0].fill = "#112233";
  const next = await projection(nextTheme),
    composed = compose(saved, next.document as unknown as StateDoc);
  assert(composed.document.slides[0].elements[0].fill === "#556677");
  assert(
    composed.document.slides[0].elements.find((element) =>
      element.id === "caption/paragraph:1"
    )!.fontSize === 22,
  );
  assert(
    composed.document.slides[2].elements.find((element) =>
      String(element.id).includes("paragraph")
    )!.fontSize === 25,
  );
});
Deno.test("card code styles are measured at the selected size and source fields remain authoritative", async () => {
  const qmd =
    '## Code {#code-slide}\n\n::: {#code-card .bento-card}\n\n```{#shown .r bento-style="snippet" font-size="34"}\na\nb\nc\nd\ne\nf\n```\n\n:::\n';
  const source = scanSource(qmd), theme = structuredClone(reusableTheme);
  theme.namedStyles!.snippet.properties.fontSize = 30;
  const ast: Ast = {
    meta: {},
    blocks: [
      header("code-slide", "Code"),
      div("code-card", [{
        t: "CodeBlock",
        c: [
          ["shown", ["r"], [["bento-style", "snippet"], ["font-size", "34"]]],
          "a\nb\nc\nd\ne\nf",
        ],
      }], ["bento-card"]),
    ],
  };
  const projected = await projectAst(
    ast,
    "measured-code",
    [],
    source,
    new Map(),
    { theme },
    new Map(),
    new Map(),
    new Map(),
    new Map(),
  );
  const code = projected.document.slides[0].elements.find((element) =>
    element.type === "code"
  )!;
  assert(code.fontSize === 34 && code.fontFamily === "Fira Code, monospace");
  assert(Number(code.h) >= 6 * 34 * 1.25);
  assert(
    projected.design?.["code-slide"]?.shown.ownedPaths.includes("fontSize"),
  );
});
Deno.test("decorated default themes diagnose implicit introductions without broadening ordinary source mapping", () => {
  const qmd = "Opening text.\n\n## Next {#next}\n\nLater text.\n";
  const source = scanSource(qmd);
  refuses(
    () => assertReusableDesignSource(source, defaults),
    "THEME_INTRO_HEADING_REQUIRED",
  );
  assertReusableDesignSource(source);
  const plainDefault = structuredClone(reusableTheme);
  plainDefault.variants!.content.decorations = [];
  assertReusableDesignSource(source, { theme: plainDefault });
  assertReusableDesignSource(
    scanSource("## Introduction {#introduction}\n\nOpening text.\n"),
    defaults,
  );
  assertReusableDesignSource(
    scanSource(
      "---\ntitle: Session\n---\n\n## Introduction {#introduction}\n\nOpening text.\n",
    ),
    defaults,
  );
});
