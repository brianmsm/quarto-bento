import { renderProject } from "../src/core/project.ts";
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
async function refuses(fn: () => unknown) {
  try {
    await fn();
  } catch (e) {
    ok(String(e).includes("UNMAPPED_CHART_SOURCE"), String(e));
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
Deno.test("authored and computed chart filter context mutations refuse atomically after a prior publication", async () => {
  for (const computed of [false, true]) {
    const dir = await Deno.makeTempDir({ prefix: "qbento-chart-context-" }),
      file = `${dir}/deck.qmd`;
    try {
      const data = computed
        ? '```{r}\n#| label: producer\n#| echo: false\nknitr::kable(data.frame(group=c("A","B"),N=c(-1,2)),format="pipe",col.names=c("","N"))\n```\n'
        : table;
      const source = "---\nfilters: [mutate.lua]\n---\n\n" +
        qmd.replace(table, data);
      await Deno.writeTextFile(file, source);
      await Deno.writeTextFile(`${dir}/mutate.lua`, "-- original identity\n");
      await renderProject(file);
      const html = await Deno.readTextFile(`${dir}/deck.bento.html`),
        state = await Deno.readTextFile(`${dir}/.qbento/state.json`);
      for (
        const filter of [
          'function Pandoc(doc) local chart=nil; local rest=pandoc.List(); for _,b in ipairs(doc.blocks) do if b.t=="Div" and b.identifier=="chart" then chart=b else rest:insert(b) end end; for _,b in ipairs(rest) do if b.t=="Div" and b.identifier=="card" then b.content:insert(chart) end end; doc.blocks=rest; return doc end',
          'function Pandoc(doc) local chart=nil; local rest=pandoc.List(); for _,b in ipairs(doc.blocks) do if b.t=="Div" and b.identifier=="chart" then chart=b else rest:insert(b) end end; rest:insert(chart); doc.blocks=rest; return doc end',
          'function Div(el) if el.identifier=="chart" then return {} end end',
        ]
      ) {
        await Deno.writeTextFile(`${dir}/mutate.lua`, filter);
        await refuses(() => renderProject(file));
        ok(await Deno.readTextFile(file) === source);
        ok(await Deno.readTextFile(`${dir}/deck.bento.html`) === html);
        ok(await Deno.readTextFile(`${dir}/.qbento/state.json`) === state);
      }
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
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
