import { validateDesignRegistry } from "../src/render/registry.ts";
import {
  type DesignTheme,
  parseDesignAttributes,
} from "../src/render/design.ts";
import { assertReusableDesignSource } from "../src/render/theme-styles.ts";
import {
  projectAst,
  validateProjectionOrigins,
} from "../src/render/project.ts";
import { readSourceInline } from "../src/render/source-inline.ts";
import { scanSource } from "../src/source/mod.ts";
import { initializeDesignPackage } from "../src/core/design-initialize.ts";
import { exportDesignPackage } from "../src/core/design-package.ts";
import {
  readProject,
  renderProject,
  saveProject,
} from "../src/core/project.ts";
import type { Ast, Node } from "../src/render/types.ts";

function assert(value: unknown, message = "assertion failed"): asserts value {
  if (!value) throw new Error(message);
}
function refuses(action: () => unknown, code: string) {
  try {
    action();
  } catch (error) {
    assert(String(error).includes(code), String(error));
    return;
  }
  throw new Error(`expected ${code}`);
}
const theme: DesignTheme = {
  background: "#ffffff",
  color: "#243a42",
  accent: "#be2161",
  fontFamily: "Arial",
  styles: { body: { fontSize: 27 }, code: { fontSize: 22 } },
  namedStyles: {
    task: {
      target: "text",
      properties: { fontSize: 28, color: "#be2161", fontWeight: 600 },
    },
    citation: {
      target: "text",
      properties: { fontSize: 15, color: "#526a70" },
    },
    snippet: {
      target: "code",
      properties: { fontSize: 23, fontFamily: "Liberation Mono, monospace" },
    },
  },
  variants: {
    content: {
      titleFrame: { x: 64, y: 35, w: 1152, h: 90 },
      contentFrame: { x: 64, y: 160, w: 1152, h: 400 },
      slots: {
        lead: { frame: { x: 64, y: 160, w: 1152, h: 90 } },
        code: { frame: { x: 64, y: 280, w: 1152, h: 200 }, style: "snippet" },
        task: { frame: { x: 64, y: 580, w: 1152, h: 75 }, style: "task" },
        citation: {
          frame: { x: 64, y: 675, w: 1152, h: 25 },
          style: "citation",
        },
        pair: {
          frame: { x: 64, y: 190, w: 1152, h: 300 },
          layout: "columns",
          gap: 32,
        },
        rows: {
          frame: { x: 64, y: 190, w: 1152, h: 300 },
          layout: "rows",
          gap: 20,
        },
      },
    },
    dark: {
      background: "#243a42",
      styles: {
        title: { color: "#ffffff" },
        body: { color: "#ffffff" },
        code: { color: "#ffffff" },
      },
    },
  },
  defaultVariant: "content",
};
const registry = (value: unknown) => ({
  schemaVersion: 1,
  themes: { course: value },
  activeTheme: "course",
});
const paragraph = (value: string): Node => ({
  t: "Para",
  c: [{ t: "Str", c: value }],
});
const heading = (id: string, variant?: string): Node => ({
  t: "Header",
  c: [2, [id, [], variant ? [["bento-variant", variant]] : []], [{
    t: "Str",
    c: id,
  }]],
});
const div = (id: string, children: Node[], slot?: string): Node => ({
  t: "Div",
  c: [[id, [], slot ? [["bento-slot", slot]] : []], children],
});
const simpleQmd =
  '## Result {#result}\n\n::: {#cite bento-slot="citation"}\nA source citation.\n:::\n';

Deno.test("theme slots and variant role styles validate bounded reusable data", () => {
  validateDesignRegistry(registry(theme));
  assert(
    parseDesignAttributes(["cite", [], [["bento-slot", "citation"]]]).slot ===
      "citation",
  );
  for (
    const slot of [
      { frame: { x: 0, y: 700, w: 500, h: 50 } },
      { frame: { x: 0, y: 0, w: 500, h: 50 }, style: "missing" },
      { frame: { x: 0, y: 0, w: 500, h: 50 }, layout: "grid" },
      { frame: { x: 0, y: 0, w: 500, h: 50 }, gap: 10 },
      { frame: { x: 0, y: 0, w: 500, h: 50 }, layout: "rows", gap: -1 },
      { frame: { x: 0, y: 0, w: 500, h: 50 }, html: "<script>" },
    ]
  ) {
    const changed = structuredClone(theme);
    changed.variants!.content.slots!.citation = slot as never;
    refuses(
      () => validateDesignRegistry(registry(changed)),
      slot.style === "missing" ? "UNKNOWN_STYLE" : "INVALID_DESIGN_DEFAULTS",
    );
  }
  const changed = structuredClone(theme);
  changed.variants!.dark.styles!.code = { fontWeight: 700 };
  refuses(
    () => validateDesignRegistry(registry(changed)),
    "INVALID_DESIGN_DEFAULTS",
  );
});

Deno.test("slot preflight rejects missing duplicate nested incompatible and overflowing selectors", () => {
  for (
    const [qmd, code] of [
      [simpleQmd.replace('"citation"', '"missing"'), "UNKNOWN_SLOT"],
      [
        simpleQmd + '\n::: {#again bento-slot="citation"}\nAnother.\n:::\n',
        "DUPLICATE_SLOT",
      ],
      [
        "## Result {#result}\n\n:::: {#outer}\n" +
        simpleQmd.slice(simpleQmd.indexOf(":::")) + "\n::::\n",
        "SLOT_TARGET_MISMATCH",
      ],
      [simpleQmd.replace("citation", "code"), "STYLE_TARGET_MISMATCH"],
      [simpleQmd.replace("citation", "pair"), "SLOT_LAYOUT_CHILDREN"],
      [
        simpleQmd.replace(
          "## Result {#result}",
          '## Dark {#result bento-variant="dark"}',
        ),
        "UNKNOWN_SLOT",
      ],
      ['## Result {#result bento-slot="citation"}\n', "SLOT_TARGET_MISMATCH"],
    ]
  ) {
    refuses(() => assertReusableDesignSource(scanSource(qmd), { theme }), code);
  }
  const changed = structuredClone(theme);
  changed.variants!.content.slots!.rows.gap = 400;
  const qmd =
    '## Slide {#slide}\n\n:::: {#items bento-slot="rows"}\n::: {#first}\nFirst.\n:::\n::: {#second}\nSecond.\n:::\n::::\n';
  refuses(
    () => assertReusableDesignSource(scanSource(qmd), { theme: changed }),
    "SLOT_OVERFLOW",
  );
});

Deno.test("slots recover original selectors, preserve independent flow and apply dark body and code defaults", async () => {
  const qmd = simpleQmd +
    '\n## Dark {#dark bento-variant="dark"}\n\n::: {#dark-body}\nReadable body.\n:::\n\n```{#dark-code .r}\nx <- 1\n```\n\n## Following {#following}\n\nFollowing body.\n';
  const ast: Ast = {
    meta: {},
    blocks: [
      heading("result"),
      div("cite", [paragraph("A source citation.")]),
      heading("dark", "dark"),
      div("dark-body", [paragraph("Readable body.")]),
      { t: "CodeBlock", c: [["dark-code", ["r"], []], "x <- 1"] },
      heading("following"),
      paragraph("Following body."),
    ],
  };
  const source = scanSource(qmd);
  const projected = validateProjectionOrigins(
    source,
    await projectAst(ast, "slots", [], source, new Map(), { theme }),
    await readSourceInline(source),
    { theme },
  );
  const cite = projected.document.slides[0].elements.find((e) =>
    e.id === "cite/paragraph:1"
  )!;
  assert(
    cite.x === 64 && cite.y === 675 && cite.h === 25 && cite.fontSize === 15,
  );
  assert(!projected.design!.result?.[cite.id]?.ownedPaths.includes("y"));
  const dark = projected.document.slides[1];
  assert(dark.background === "#243a42");
  assert(dark.elements.every((e) => e.color === "#ffffff"));
  assert(projected.document.slides[2].elements[1].color === "#243a42");
  const forged = structuredClone(ast);
  (forged.blocks[1].c as [unknown, unknown])[0] = ["cite", [], [[
    "bento-slot",
    "lead",
  ]]];
  try {
    await projectAst(forged, "slots", [], source, new Map(), { theme });
    throw new Error("accepted forged selector");
  } catch (error) {
    assert(String(error).includes("UNMAPPED_DESIGN_REFERENCE"), String(error));
  }
});

Deno.test("real reusable slot compositions preserve design across independent decks updates and source recomputation", async () => {
  const dirs = [
    await Deno.makeTempDir({ prefix: "qbento-slots-a-" }),
    await Deno.makeTempDir({ prefix: "qbento-slots-b-" }),
  ];
  const qmd = `## Content {#content}

::: {#lead bento-slot="lead"}
A reusable explanation.
:::

::: {#shown bento-slot="code"}
\`\`\`{#example .r}
values <- c(1, 2, 3)
mean(values)
\`\`\`
:::

::: {#task bento-slot="task"}
Explain the result before continuing.
:::

::: {#citation bento-slot="citation"}
A course citation.
:::

## Pair {#pair}

:::: {#items bento-slot="pair"}
::: {#left}
A first explanation.
:::
::: {#right}
A second explanation.
:::
::::

## Rows {#rows}

:::: {#items-rows bento-slot="rows"}
::: {#top}
A top explanation.
:::
::: {#bottom}
A bottom explanation.
:::
::::

## Computed {#computed}

\`\`\`{r}
#| label: total
#| echo: false
print(sum(read.csv("data.csv")$value))
\`\`\`
`;
  try {
    const pkg = {
      format: "qbento/design",
      version: 1,
      name: "Course",
      registry: registry(theme),
    };
    for (const dir of dirs) {
      await Deno.writeTextFile(dir + "/deck.qmd", qmd);
      await Deno.writeTextFile(dir + "/data.csv", "value\n1\n2\n");
      await initializeDesignPackage(dir + "/deck.qmd", pkg);
    }
    const a = await renderProject(dirs[0] + "/deck.qmd"),
      b = await renderProject(dirs[1] + "/deck.qmd");
    assert(a.state.docId !== b.state.docId);
    assert(a.diagnostics.length === 0, JSON.stringify(a.diagnostics));
    const [content, pair, rows] = a.state.emitted.slides;
    assert(
      content.elements.find((e) => e.id === "task/paragraph:1")!.y === 580,
    );
    assert(
      content.elements.find((e) => e.id === "citation/paragraph:1")!
        .fontSize === 15,
    );
    assert(pair.elements.find((e) => e.id === "left/paragraph:1")!.x === 64);
    assert(pair.elements.find((e) => e.id === "right/paragraph:1")!.x === 656);
    assert(rows.elements.find((e) => e.id === "bottom/paragraph:1")!.y === 350);
    const edited = structuredClone(a.state.emitted);
    edited.slides[0].elements.find((e) => e.id === "task/paragraph:1")!.x = 80;
    await saveProject(dirs[0] + "/deck.qmd", edited, a.state.revision);
    const exported = await exportDesignPackage(
      dirs[0] + "/deck.qmd",
      "Reusable course",
    );
    const changed = structuredClone(theme);
    changed.variants!.content.slots!.task.frame.x = 90;
    changed.variants!.content.slots!.task.frame.w = 1126;
    changed.namedStyles!.citation.properties.fontSize = 16;
    await Deno.writeTextFile(
      dirs[0] + "/.qbento/design.json",
      JSON.stringify(registry(changed)),
    );
    await Deno.writeTextFile(dirs[0] + "/data.csv", "value\n10\n20\n");
    const next = await renderProject(dirs[0] + "/deck.qmd");
    assert(
      next.state.docId === a.state.docId && next.state.pending.length === 0,
    );
    assert(
      next.state.emitted.slides[0].elements.find((e) =>
        e.id === "task/paragraph:1"
      )!.x === 80,
    );
    assert(
      next.state.emitted.slides[0].elements.find((e) =>
        e.id === "citation/paragraph:1"
      )!.fontSize === 16,
    );
    assert(
      next.state.emitted.slides[3].elements.some((e) => e.content === "[1] 30"),
    );
    assert(
      exported.registry.themes!.course.variants!.content.slots!.citation.frame
        .y === 675,
    );
    assert((await readProject(dirs[1] + "/deck.qmd")).docId === b.state.docId);
    for (const dir of dirs) {
      assert(await Deno.readTextFile(dir + "/deck.qmd") === qmd);
    }
  } finally {
    for (const dir of dirs) await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("slot card styles preserve explicit source fields and refuse oversized displayed code", async () => {
  const changed = structuredClone(theme);
  changed.namedStyles!.panel = {
    target: "card",
    properties: { fill: "#eef8f6", radius: 16 },
  };
  changed.variants!.content.slots!.panel = {
    frame: { x: 64, y: 160, w: 1152, h: 400 },
    style: "panel",
  };
  const qmd =
    '## Result {#result}\n\n::: {#panel .bento-card bento-slot="panel" radius="9"}\nReadable content.\n:::\n';
  const source = scanSource(qmd);
  const projected = await projectAst(
    {
      meta: {},
      blocks: [heading("result"), {
        t: "Div",
        c: [["panel", ["bento-card"], [["radius", "9"]]], [
          paragraph("Readable content."),
        ]],
      }],
    },
    "slots",
    [],
    source,
    new Map(),
    { theme: changed },
  );
  const background = projected.document.slides[0].elements.find((e) =>
    e.type === "shape"
  )!;
  assert(
    background.x === 64 && background.h === 400 &&
      background.fill === "#eef8f6" && background.radius === 9,
  );
  assert(projected.design!.result[background.id].ownedPaths.includes("radius"));
  assert(!projected.design!.result[background.id].ownedPaths.includes("x"));
  const content = Array.from({ length: 20 }, () => "x <- 1").join("\n");
  const tooTall =
    '## Result {#result}\n\n::: {#shown bento-slot="code"}\n\n```{#example .r}\n' +
    content + "\n```\n\n:::\n";
  try {
    await projectAst(
      {
        meta: {},
        blocks: [
          heading("result"),
          div("shown", [{
            t: "CodeBlock",
            c: [["example", ["r"], []], content],
          }]),
        ],
      },
      "slots",
      [],
      scanSource(tooTall),
      new Map(),
      { theme },
    );
    throw new Error("accepted oversized code");
  } catch (error) {
    assert(String(error).includes("SLOT_CONTENT_OVERFLOW"), String(error));
  }
});
