import { kpiReadabilityDiagnostics, projectKpi } from "../src/render/kpi.ts";
import { measureNativeText } from "../src/render/measure.ts";
import { scanSource } from "../src/source/mod.ts";
import { kpiSource } from "../src/source/kpi.ts";
import { executeQuarto } from "../src/render/quarto.ts";
import { validateProjectionOrigins } from "../src/render/project.ts";
import { designTheme, type PandocAttr } from "../src/render/design.ts";
import {
  type BentoDoc as StateDoc,
  captureEdits,
  compose,
  createState,
  resolveChange,
  targetKey,
} from "../src/state/mod.ts";
import type { Ast, BentoDoc, Element, Node } from "../src/render/types.ts";
function assert(value: unknown, message = "assertion failed"): asserts value {
  if (!value) throw new Error(message);
}
async function refuses(action: () => unknown, code: string) {
  try {
    await action();
  } catch (error) {
    assert(String(error).includes(code), String(error));
    return;
  }
  throw new Error(`Expected ${code}`);
}
const qmd = `## KPI {#slide}

:::: {#metric .bento-kpi}
::: {#label bento-role="label"}
Participants β
:::
::: {#value bento-role="value"}
123
:::
::: {#detail bento-role="detail"}
Complete cases
:::
::::
`;
const frame = { x: 80, y: 160, w: 1120, h: 470 };
async function parse(text: string): Promise<Ast> {
  const child = new Deno.Command("quarto", {
    args: ["pandoc", "--from", "markdown", "--to", "json"],
    stdin: "piped",
    stdout: "piped",
    stderr: "piped",
  }).spawn();
  const writer = child.stdin.getWriter();
  await writer.write(new TextEncoder().encode(text));
  await writer.close();
  const output = await child.output();
  assert(output.success, new TextDecoder().decode(output.stderr));
  return JSON.parse(new TextDecoder().decode(output.stdout));
}
function div(ast: Ast): [PandocAttr, Node[]] {
  const node = ast.blocks.find((node) =>
    node.t === "Div" && (node.c as [PandocAttr, Node[]])[0][0] === "metric"
  );
  assert(node, "Missing actual Pandoc KPI div");
  return node.c as [PandocAttr, Node[]];
}
async function project(text: string, appearance?: Map<string, Element>) {
  const [attr, children] = div(await parse(text));
  return await projectKpi(
    scanSource(text),
    attr,
    children,
    frame,
    {},
    appearance ? { elements: appearance } : undefined,
  );
}
function value(elements: Element[]): Element {
  const result = elements.find((element) => element.id === "value/paragraph:1");
  assert(result);
  return result;
}
function doc(elements: Element[]): BentoDoc {
  return {
    format: "bento/slides",
    version: 1,
    docId: "retained-kpi",
    title: "KPI",
    size: { width: 1280, height: 720 },
    theme: designTheme(),
    slides: [{
      id: "slide",
      elements,
      background: "#fff",
      transition: "fade",
      notes: "",
    }],
  };
}
Deno.test("KPI fresh bold text can use proven retained typography without importing native HTML or geometry", async () => {
  const initial = await project(qmd),
    saved = {
      ...value(initial.elements),
      html: "999",
      lineHeight: 1.6,
      h: 100,
      x: 9999,
      y: 8888,
      w: 1,
      groupId: "foreign",
    };
  const before = JSON.stringify(saved),
    source = qmd.replace("\n123\n", "\n**123**\n");
  await refuses(() => project(source), "KPI_TYPOGRAPHY_UNSUPPORTED");
  const rescued = await project(source, new Map([[saved.id, saved]])),
    projected = value(rescued.elements);
  assert(rescued.appearanceRescued && projected.html === "<b>123</b>");
  assert(
    projected.lineHeight === 1.25 && projected.x === 104 &&
      projected.w === 1072 && projected.groupId === "metric",
  );
  assert(!rescued.fields[projected.id].ownedPaths.includes("lineHeight"));
  assert(
    rescued.origins[projected.id].sourceId === projected.id &&
      !rescued.origins[projected.id].producer,
  );
  assert(JSON.stringify(saved) === before, "Appearance snapshot mutated");
  for (
    const bad of [{ ...saved, lineHeight: 1.25 }, { ...saved, id: "wrong" }, {
      ...saved,
      type: "shape",
    }]
  ) {
    await refuses(
      () => project(source, new Map([[saved.id, bad]])),
      "KPI_TYPOGRAPHY_UNSUPPORTED",
    );
  }
});
Deno.test("KPI explicit role or parent line-height wins over retained typography", async () => {
  const initial = await project(qmd),
    saved = { ...value(initial.elements), lineHeight: 1.6 };
  const bold = qmd.replace("\n123\n", "\n**123**\n");
  for (
    const source of [
      bold.replace(
        'bento-role="value"',
        'bento-role="value" line-height="1.25"',
      ),
      bold.replace(".bento-kpi}", '.bento-kpi line-height="1.25"}'),
    ]
  ) {
    await refuses(
      () => project(source, new Map([[saved.id, saved]])),
      "KPI_TYPOGRAPHY_UNSUPPORTED",
    );
  }
  const validSource = bold.replace(
    'bento-role="value"',
    'bento-role="value" line-height="1.6"',
  );
  const valid = await project(
    validSource,
    new Map([[saved.id, { ...saved, lineHeight: 0 }]]),
  );
  assert(!valid.appearanceRescued && value(valid.elements).lineHeight === 1.6);
  assert(valid.fields[saved.id].ownedPaths.includes("lineHeight"));
});
Deno.test("KPI retained overflow remains a composed diagnostic and does not reflow source geometry", async () => {
  const source = qmd.replace(
    'bento-role="value"',
    'bento-role="value" color="#123456" font-family="Arial"',
  );
  const initial = await project(source),
    saved = { ...value(initial.elements), lineHeight: 0, h: 100 };
  const next = await project(source, new Map([[saved.id, saved]]));
  assert(
    !next.appearanceRescued &&
      JSON.stringify(next.elements) === JSON.stringify(initial.elements),
  );
  const document = doc(
    next.elements.map((element) =>
      element.id === saved.id ? { ...element, lineHeight: 0, h: 100 } : element
    ),
  );
  const before = JSON.stringify(document),
    diagnostics = await kpiReadabilityDiagnostics(scanSource(source), document);
  assert(
    diagnostics.some((diagnostic) =>
      diagnostic.code === "KPI_CONTENT_OVERFLOW" &&
      diagnostic.elementId === saved.id
    ),
  );
  assert(JSON.stringify(document) === before);
});
Deno.test("KPI retained small fonts cannot bypass an explicit source frame capacity", async () => {
  const initial = await project(qmd),
    source = qmd.replace(".bento-kpi}", '.bento-kpi h="100"}');
  const saved = new Map(
    initial.elements.filter((element) => element.type === "text").map(
      (element) => [element.id, { ...element, fontSize: 1, lineHeight: 1.6 }],
    ),
  );
  await refuses(() => project(source, saved), "KPI_CONTENT_OVERFLOW");
});
Deno.test("KPI fresh long text can use complete retained typography for unowned frame capacity only", async () => {
  const initial = await project(qmd),
    long = Array.from({ length: 200 }, () => "score").join(" "),
    source = qmd.replace("\n123\n", `\n${long}\n`),
    saved = new Map(
      initial.elements.filter((element) => element.type === "text").map(
        (element) => [element.id, { ...element }],
      ),
    );
  Object.assign(saved.get("label/paragraph:1")!, { y: frame.y + 24, h: 40 });
  Object.assign(saved.get("value/paragraph:1")!, {
    html: "old native body",
    fontSize: 12,
    lineHeight: 1.6,
    y: frame.y + 80,
    w: 700,
    h: 310,
  });
  Object.assign(saved.get("detail/paragraph:1")!, { y: frame.y + 420, h: 40 });
  const before = JSON.stringify([...saved]),
    actual: Element = { ...saved.get("value/paragraph:1")!, html: long },
    actualMeasurement = (await measureNativeText([actual]))[0];
  assert(actualMeasurement.height <= Number(actual.h));
  assert(actualMeasurement.width <= Number(actual.w) + 1);
  assert(
    actualMeasurement.overhangTop === 0 &&
      actualMeasurement.overhangBottom === 0,
  );
  await refuses(() => project(source), "KPI_CONTENT_OVERFLOW");
  const rescued = await project(source, saved),
    projected = value(rescued.elements);
  assert(rescued.appearanceRescued && projected.html === long);
  assert(projected.fontSize === 52 && projected.lineHeight === 1.25);
  assert(projected.x === 104 && projected.w === 1072);
  assert(
    Number(projected.h) > frame.h,
    "Source baseline must stay intact for sidecar composition",
  );
  assert(!rescued.fields[projected.id].ownedPaths.includes("fontSize"));
  const composed = doc(rescued.elements.map((element) => ({
    ...element,
    ...saved.get(element.id),
    ...(element.type === "text" ? { html: element.html } : {}),
  })));
  assert(
    (await kpiReadabilityDiagnostics(scanSource(source), composed)).length ===
      0,
  );
  assert(
    JSON.stringify([...saved]) === before,
    "Capacity fallback mutated native appearance",
  );
  const partial = new Map(saved);
  partial.delete("detail/paragraph:1");
  const wrong = new Map(saved);
  wrong.set("detail/paragraph:1", {
    ...wrong.get("detail/paragraph:1")!,
    id: "foreign",
  });
  for (const rejected of [partial, wrong]) {
    await refuses(() => project(source, rejected), "KPI_CONTENT_OVERFLOW");
  }
  for (const declaration of ['h="470"', 'x="80"']) {
    await refuses(
      () =>
        project(
          source.replace(".bento-kpi}", `.bento-kpi ${declaration}}`),
          saved,
        ),
      "KPI_CONTENT_OVERFLOW",
    );
  }
  await refuses(
    () =>
      project(
        source.replace(
          'bento-role="value"',
          'bento-role="value" font-size="52"',
        ),
        saved,
      ),
    "KPI_CONTENT_OVERFLOW",
  );
  assert(JSON.stringify([...saved]) === before);
});
Deno.test("real computed KPI restoration keeps fresh execution and saved unreadable typography for diagnosis", async () => {
  const dir = await Deno.makeTempDir({ prefix: "qb-kpi-retained-computed-" }),
    source = `${dir}/deck.qmd`;
  const text =
    `---\nqbento-annotations: none\nexecute:\n  echo: false\n---\n\n\`\`\`{r}\n#| include: false\ncount <- if (file.exists("counter.txt")) as.integer(readLines("counter.txt")) else 0L\nwriteLines(as.character(count + 1L), "counter.txt")\nmetric <- read.csv("data.csv")$value[1]\n\`\`\`\n\n` +
    qmd.replace("\n123\n", '\n`r sprintf("%s", metric)`\n');
  try {
    await Deno.writeTextFile(source, text);
    await Deno.writeTextFile(`${dir}/data.csv`, "value\n123\n");
    const mapping = scanSource(text), binding = kpiSource(mapping, "metric");
    assert(binding.slots[1].paragraph.origin === "computed");
    const [attr, children] = div(await executeQuarto(source, `${dir}/build`));
    const first = await projectKpi(mapping, attr, children, frame);
    const checked = validateProjectionOrigins(mapping, {
      document: doc(first.elements),
      origins: { slide: first.origins },
      diagnostics: [],
    });
    const provenance = Object.fromEntries(
      Object.entries(checked.origins.slide).map((
        [elementId, origin],
      ) => [targetKey({ slideId: "slide", elementId }), {
        origin: origin.origin,
        semanticId: origin.sourceId,
        source: { blockId: origin.sourceId!, hash: mapping.hash },
      }]),
    );
    assert(
      provenance[
        targetKey({ slideId: "slide", elementId: "value/paragraph:1" })
      ].origin === "computed",
    );
    const initial = createState(
        checked.document as unknown as StateDoc,
        provenance,
      ),
      edited = structuredClone(checked.document);
    Object.assign(value(edited.slides[0].elements), {
      html: "999",
      lineHeight: 0,
      h: 100,
    });
    const captured = captureEdits(initial, edited as unknown as StateDoc);
    const pending = captured.pending.find((change) =>
      change.target.elementId === "value/paragraph:1" &&
      change.path.join() === "html"
    );
    assert(pending && pending.origin === "computed");
    const restored = resolveChange(captured, pending.id, "keep-source");
    await Deno.writeTextFile(`${dir}/data.csv`, "value\n456\n");
    const [nextAttr, nextChildren] = div(
      await executeQuarto(source, `${dir}/build`),
    );
    const next = await projectKpi(mapping, nextAttr, nextChildren, frame, {}, {
      elements: new Map(
        restored.emitted.slides[0].elements.map(
          (element) => [element.id, element],
        ),
      ),
    });
    assert(!next.appearanceRescued && value(next.elements).html === "456");
    const composed = compose(
      restored,
      doc(next.elements) as unknown as StateDoc,
      provenance,
    );
    assert(
      value(composed.document.slides[0].elements).lineHeight === 0 &&
        value(composed.document.slides[0].elements).html === "456" &&
        composed.state.pending.length === 0,
    );
    const diagnostics = await kpiReadabilityDiagnostics(
      mapping,
      composed.document as unknown as BentoDoc,
    );
    assert(
      diagnostics.some((diagnostic) =>
        diagnostic.code === "KPI_CONTENT_OVERFLOW" &&
        diagnostic.elementId === "value/paragraph:1"
      ),
    );
    assert(
      await Deno.readTextFile(source) === text &&
        await Deno.readTextFile(`${dir}/counter.txt`) === "2\n",
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
