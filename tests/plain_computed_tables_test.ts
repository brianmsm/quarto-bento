import { renderProject, saveProject } from "../src/core/project.ts";
import { applySync, previewSync } from "../src/core/sync.ts";
import {
  projectAst,
  validateProjectionOrigins,
} from "../src/render/project.ts";
import { executeQuarto } from "../src/render/quarto.ts";
import type { Ast, Node } from "../src/render/types.ts";
import { scanSource } from "../src/source/mod.ts";
import { canonical, targetKey } from "../src/state/mod.ts";
function ok(value: unknown, message = "assertion failed"): asserts value {
  if (!value) throw new Error(message);
}
function eq(a: unknown, b: unknown) {
  ok(canonical(a) === canonical(b), `${canonical(a)} != ${canonical(b)}`);
}
async function refuses(action: () => unknown, code: string) {
  try {
    await action();
  } catch (error) {
    ok(String(error).includes(code), String(error));
    return;
  }
  throw new Error(`Expected ${code}`);
}
Deno.test("unlabelled computed table and identical literal cells retain distinct provenance, reviewed pins and design through recompute", async () => {
  const dir = await Deno.makeTempDir({ prefix: "qbento-weak-table-" }),
    path = `${dir}/deck.qmd`;
  const table = "| Group | N |\r\n| :--- | ---: |\r\n| Alpha | 12 |\r\n";
  const chunk =
    '```{r}\r\n#| echo: false\r\ncat("x", file="executions.txt", append=TRUE)\r\nknitr::kable(read.csv("values.csv"), format="pipe", align=c("l","r"))\r\n```\r\n';
  const original =
    `## Datos β\r\n\r\n${table}\r\nConclusión.\r\n\r\n## Computación\r\n\r\n${chunk}`;
  try {
    await Deno.writeTextFile(path, original);
    await Deno.writeTextFile(`${dir}/values.csv`, "Group,N\nAlpha,12\n");
    const count = () => Deno.readTextFile(`${dir}/executions.txt`);
    const first = await renderProject(path);
    eq(await count(), "x");
    const tables = first.state.emitted.slides.map((slide) => {
      const table = slide.elements.find((element) => element.type === "table")!;
      ok(table);
      return {
        table,
        proof: first.state
          .provenance[targetKey({ slideId: slide.id, elementId: table.id })],
      };
    });
    eq(tables.map(({ proof }) => proof.origin), ["authored", "computed"]);
    eq(tables[0].table.rows, tables[1].table.rows);
    const producer = tables[1].proof.producer!;
    ok(producer.startsWith("chunk@"));
    const edit = structuredClone(first.state.emitted);
    edit.slides[0].elements.find((element) => element.html === "Conclusión.")!
      .html = "Conclusión revisada β.";
    edit.slides[0].elements.find((element) => element.type === "table")!.x =
      333;
    edit.slides[1].elements.find((element) => element.type === "table")!.x =
      222;
    await saveProject(path, edit, first.state.revision);
    eq(await Deno.readTextFile(path), original);
    const plan = await previewSync(path);
    ok(plan.result.includes(table));
    ok(plan.result.includes(chunk));
    ok(plan.result.includes(`<!-- qb-producer:${producer} -->\r\n`));
    eq(await count(), "x");
    await applySync(path, plan);
    eq(await count(), "x");
    const next = await renderProject(path);
    eq(await count(), "xx");
    eq(next.state.docId, first.state.docId);
    eq(next.state.pending.length, 0);
    for (const [i, x] of [333, 222].entries()) {
      const table = next.state.emitted.slides[i].elements.find((element) =>
        element.id === tables[i].table.id
      )!;
      ok(table);
      eq(table.x, x);
      eq(table.rows, tables[i].table.rows);
    }
    const pinned = await Deno.readTextFile(path);
    ok(pinned.includes(table) && pinned.includes(chunk));
    ok(!pinned.replaceAll("\r\n", "").includes("\n"), "CRLF changed");
    await Deno.writeTextFile(`${dir}/values.csv`, "Group,N\nAlpha,17\n");
    const recomputed = await renderProject(path);
    eq(await count(), "xxx");
    const result = recomputed.state.emitted.slides[1].elements.find((element) =>
      element.id === tables[1].table.id
    )!;
    eq(result.x, 222);
    ok(canonical(result.rows).includes('"17"'));
    eq(
      recomputed.state.emitted.slides[0].elements.find((element) =>
        element.id === tables[0].table.id
      )!.rows,
      tables[0].table.rows,
    );
    eq(await Deno.readTextFile(path), pinned);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
Deno.test("weak computed tables require an authenticated boundary scoped to their exact producer", async () => {
  const dir = await Deno.makeTempDir({ prefix: "qbento-weak-table-proof-" }),
    path = `${dir}/deck.qmd`;
  const original =
    '## Table {#table-slide}\n\n```{r}\n#| echo: false\nknitr::kable(data.frame(Group="Alpha", N=12), format="pipe")\n```\n\n```{r}\n#| echo: false\ninvisible(NULL)\n```\n';
  const source = scanSource(original);
  function findTable(value: unknown): Node | undefined {
    if (!value || typeof value !== "object") return;
    if ((value as Node).t === "Table") return value as Node;
    for (const nested of Object.values(value)) {
      const table = findTable(nested);
      if (table) return table;
    }
  }
  try {
    await Deno.writeTextFile(path, original);
    const ast = await executeQuarto(path, `${dir}/build`);
    const valid = await projectAst(ast, "doc", [], source);
    validateProjectionOrigins(source, valid);
    const table = findTable(ast)!;
    ok(table);
    const producers = source.blocks.filter((block) => block.kind === "chunk");
    const legacy = (id: string): Node => ({
      t: "Div",
      c: [[id, ["cell"], []], [structuredClone(table)]],
    });
    const forged: Ast = {
      meta: {},
      blocks: [ast.blocks[0], legacy(producers[0].id)],
    };
    await refuses(
      () => projectAst(forged, "doc", [], source),
      "UNMAPPED_TABLE_SOURCE",
    );
    await refuses(
      () => projectAst(structuredClone(ast), "doc", [], source),
      "INVALID_PRODUCER_RECEIPT",
    );
    // Completing a verified producer must not authorize a later legacy wrapper.
    ast.blocks.push(legacy(producers[1].id));
    await refuses(
      () => projectAst(ast, "doc", [], source),
      "UNMAPPED_TABLE_SOURCE",
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
