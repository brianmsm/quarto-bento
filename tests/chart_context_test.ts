import { renderProject } from "../src/core/project.ts";
import { executeQuarto } from "../src/render/quarto.ts";
import { producerReceipt } from "../src/render/producer-capture.ts";
import {
  projectAst,
  validateProjectionOrigins,
} from "../src/render/project.ts";
import { scanSource } from "../src/source/mod.ts";
import type { PandocAttr as Attr } from "../src/render/design.ts";
import type { Ast, Node } from "../src/render/types.ts";
function ok(value: unknown, message = "assertion failed"): asserts value {
  if (!value) throw new Error(message);
}
async function refuses(fn: () => unknown, code = "UNMAPPED_CHART_SOURCE") {
  try {
    await fn();
  } catch (e) {
    ok(String(e).includes(code), String(e));
    return;
  }
  throw new Error("accepted fabricated chart context");
}
const table = "| | N |\n| --- | ---: |\n| A | -1 |\n| B | 2 |\n";
const chart = `::: {#chart .bento-chart bento-chart-kind="bar"}\n${table}:::\n`;
const qmd =
  `## Original chart {#one}\n\n${chart}\n## Other card {#two}\n\n::: {#card .bento-card}\n### Existing card\n:::\n\n## Empty destination {#three}\n`;
async function ast(source: string): Promise<Ast> {
  const child = new Deno.Command("quarto", {
    args: ["pandoc", "-f", "markdown", "-t", "json"],
    stdin: "piped",
    stdout: "piped",
    stderr: "piped",
  }).spawn();
  const writer = child.stdin.getWriter();
  await writer.write(new TextEncoder().encode(source));
  await writer.close();
  const output = await child.output();
  ok(output.success, new TextDecoder().decode(output.stderr));
  return JSON.parse(new TextDecoder().decode(output.stdout));
}
function id(node: Node) {
  return node.t === "Div" ? (node.c as [Attr, Node[]])[0][0] : "";
}
const contextFilters = [
  'function Pandoc(doc) local chart=nil; local rest=pandoc.List(); for _,b in ipairs(doc.blocks) do if b.t=="Div" and b.identifier=="chart" then chart=b else rest:insert(b) end end; for _,b in ipairs(rest) do if b.t=="Div" and b.identifier=="card" then b.content:insert(chart) end end; doc.blocks=rest; return doc end',
  'function Pandoc(doc) local chart=nil; local rest=pandoc.List(); for _,b in ipairs(doc.blocks) do if b.t=="Div" and b.identifier=="chart" then chart=b else rest:insert(b) end end; rest:insert(chart); doc.blocks=rest; return doc end',
  'function Div(el) if el.identifier=="chart" then return {} end end',
];
const computedData =
  '```{r}\n#| label: producer\n#| echo: false\ncat("run\\n",file="counter.txt",append=TRUE)\nknitr::kable(data.frame(group=c("A","B"),N=c(-1,2)),format="pipe",col.names=c("","N"))\n```\n';
Deno.test("chart original ancestry, attributes, slide and coverage cannot be fabricated by AST or projection edits", async () => {
  const source = scanSource(qmd), initial = await ast(qmd);
  const good = validateProjectionOrigins(
    source,
    await projectAst(initial, "context", [], source),
  );
  for (const mode of ["nest", "move-slide", "drop", "attrs"]) {
    const changed = structuredClone(initial),
      ch = changed.blocks.find((n) => id(n) === "chart")!;
    if (mode === "nest") {
      changed.blocks = changed.blocks.filter((n) => n !== ch);
      (changed.blocks.find((n) => id(n) === "card")!.c as [Attr, Node[]])[1]
        .push(ch);
    }
    if (mode === "move-slide") {
      changed.blocks = changed.blocks.filter((n) => n !== ch);
      changed.blocks.push(ch);
    }
    if (mode === "drop") {
      changed.blocks = changed.blocks.filter((n) => n !== ch);
    }
    if (mode === "attrs") {
      (ch.c as [Attr, Node[]])[0][2].push(["opacity", "0.5"]);
    }
    await refuses(async () =>
      validateProjectionOrigins(
        source,
        await projectAst(changed, "context", [], source),
      )
    );
  }
  for (const mode of ["group", "identity", "remove"]) {
    const changed = structuredClone(good),
      slide = changed.document.slides[0],
      ch = slide.elements.find((e) => e.type === "chart")!;
    if (mode === "group") ch.groupId = "card";
    if (mode === "identity") ch.id = "borrowed";
    if (mode === "remove") {
      slide.elements = slide.elements.filter((e) => e !== ch);
      delete changed.origins.one[ch.id];
    }
    try {
      validateProjectionOrigins(source, changed);
      throw new Error("accepted projection mutation");
    } catch (e) {
      ok(/UNMAPPED_(CHART_SOURCE|PROVENANCE)/.test(String(e)), String(e));
    }
  }
});
Deno.test("authored chart Lua context mutations execute and refuse atomically after a prior publication", async () => {
  const dir = await Deno.makeTempDir({ prefix: "qbento-chart-context-" }),
    file = `${dir}/deck.qmd`,
    source = "---\nfilters: [mutate.lua]\n---\n\n" + qmd;
  try {
    await Deno.writeTextFile(file, source);
    await Deno.writeTextFile(`${dir}/mutate.lua`, "-- original identity\n");
    const first = await renderProject(file);
    ok(
      first.state.provenance['["one","chart/chart"]'].origin === "authored",
    );
    const html = await Deno.readTextFile(`${dir}/deck.bento.html`),
      state = await Deno.readTextFile(`${dir}/.qbento/state.json`);
    for (const filter of contextFilters) {
      await Deno.writeTextFile(
        `${dir}/mutate.lua`,
        filter +
          '\nfunction Meta(meta) local f=io.open("filter-runs.txt","a"); f:write("run\\n"); f:close(); return meta end\n',
      );
      await refuses(() => renderProject(file));
      ok(await Deno.readTextFile(file) === source);
      ok(await Deno.readTextFile(`${dir}/deck.bento.html`) === html);
      ok(await Deno.readTextFile(`${dir}/.qbento/state.json`) === state);
    }
    ok(
      await Deno.readTextFile(`${dir}/filter-runs.txt`) === "run\nrun\nrun\n",
      "authored Lua context checks must run the actual filters",
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
Deno.test("computed chart Lua context mutations refuse before execution and preserve the prior publication", async () => {
  const dir = await Deno.makeTempDir({ prefix: "qbento-chart-filter-" }),
    file = `${dir}/deck.qmd`,
    source = qmd.replace(table, computedData);
  try {
    await Deno.writeTextFile(file, source);
    const first = await renderProject(file);
    const origin = first.state.provenance['["one","chart/chart"]'];
    ok(origin.origin === "computed" && origin.producer === "producer");
    const html = await Deno.readTextFile(`${dir}/deck.bento.html`),
      state = await Deno.readTextFile(`${dir}/.qbento/state.json`),
      filteredSource = "---\nfilters: [mutate.lua]\n---\n\n" + source;
    await Deno.writeTextFile(file, filteredSource);
    for (const filter of contextFilters) {
      await Deno.writeTextFile(`${dir}/mutate.lua`, filter);
      await refuses(() => renderProject(file), "UNSUPPORTED_COMPUTED_FILTER");
      ok(await Deno.readTextFile(file) === filteredSource);
      ok(await Deno.readTextFile(`${dir}/deck.bento.html`) === html);
      ok(await Deno.readTextFile(`${dir}/.qbento/state.json`) === state);
      ok(await Deno.readTextFile(`${dir}/counter.txt`) === "run\n");
    }
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
Deno.test("trusted computed chart AST retains producer proof while rejecting fabricated context in all three modes", async () => {
  const dir = await Deno.makeTempDir({ prefix: "qbento-chart-ast-" }),
    file = `${dir}/deck.qmd`,
    sourceText = qmd.replace(table, computedData),
    source = scanSource(sourceText);
  try {
    await Deno.writeTextFile(file, sourceText);
    for (const mode of ["nest", "move-slide", "drop"]) {
      const executed = await executeQuarto(file, `${dir}/build-${mode}`);
      const good = validateProjectionOrigins(
        source,
        await projectAst(executed, "computed-context", [], source),
      );
      ok(good.origins.one["chart/chart"].producer === "producer");
      const ch = executed.blocks.find((node) => id(node) === "chart")!;
      ok(ch, "original computed chart not found");
      // Mutate this attached root in place: cloning the AST would discard its
      // execution trust and test receipt rejection instead of chart context.
      executed.blocks = executed.blocks.filter((node) => node !== ch);
      if (mode === "nest") {
        const card = executed.blocks.find((node) => id(node) === "card")!;
        (card.c as [Attr, Node[]])[1].push(ch);
      }
      if (mode === "move-slide") executed.blocks.push(ch);
      await refuses(async () =>
        validateProjectionOrigins(
          source,
          await projectAst(executed, "computed-context", [], source),
        )
      );
      ok(await Deno.readTextFile(file) === sourceText);
    }
    ok(await Deno.readTextFile(`${dir}/counter.txt`) === "run\nrun\nrun\n");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
Deno.test("computed chart cannot borrow another verified original producer boundary", async () => {
  const dir = await Deno.makeTempDir({ prefix: "qbento-chart-producer-" }),
    file = `${dir}/deck.qmd`,
    sourceText = qmd.replace(table, computedData) +
      '\n```{r}\n#| label: other-producer\n#| echo: false\nknitr::kable(data.frame(group=c("A","B"),N=c(-8,9)),format="pipe",col.names=c("","N"))\n```\n',
    source = scanSource(sourceText);
  try {
    await Deno.writeTextFile(file, sourceText);
    const executed = await executeQuarto(file, `${dir}/build`);
    const good = validateProjectionOrigins(
      source,
      await projectAst(executed, "producer-chart", [], source),
    );
    const element = good.document.slides[0].elements.find((e) =>
      e.id === "chart/chart"
    )!;
    ok(JSON.stringify(element.option).includes('"data":[-1,2]'));
    const other = executed.blocks.find((node) => {
      if (node.t !== "Div") return false;
      const [attr] = node.c as [Attr, Node[]];
      const token = attr[2].find(([key]) => key === "qbento-producer-proof")
        ?.[1];
      return token &&
        producerReceipt(executed, source.hash, token).id === "other-producer";
    });
    ok(other, "second verified execution boundary missing");
    const ch = executed.blocks.find((node) => id(node) === "chart")!;
    // Both boundaries were emitted by this invocation. Original source context
    // alone cannot authorize using the second producer's data in this chart.
    (ch.c as [Attr, Node[]])[1] = [other];
    await refuses(
      () => projectAst(executed, "producer-chart", [], source),
      "INVALID_PRODUCER_RECEIPT",
    );
    ok(await Deno.readTextFile(file) === sourceText);
    ok(await Deno.readTextFile(`${dir}/counter.txt`) === "run\n");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
Deno.test("verified transparent chart wrapper retains component group and rejects fabricated ancestor attrs", async () => {
  const sourceText =
      `## Original chart {#one}\n\n::::: {#card .bento-card}\n### Title\n\n:::: {#transparent}\n${chart}::::\n:::::\n`,
    source = scanSource(sourceText),
    initial = await ast(sourceText);
  const good = validateProjectionOrigins(
    source,
    await projectAst(initial, "transparent", [], source),
  );
  ok(
    good.document.slides[0].elements.find((e) => e.type === "chart")
      ?.groupId === "card",
  );
  for (const target of ["card", "transparent"]) {
    const changed = structuredClone(initial);
    const mutate = (nodes: Node[]) => {
      for (const node of nodes) {
        if (node.t === "Div") {
          const [attr, children] = node.c as [Attr, Node[]];
          if (attr[0] === target) attr[2].push(["opacity", "0.5"]);
          mutate(children);
        }
      }
    };
    mutate(changed.blocks);
    await refuses(() => projectAst(changed, "transparent", [], source));
  }
});
