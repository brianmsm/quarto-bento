import { renderProject, saveProject } from "../src/core/project.ts";
import { applySync, previewSync } from "../src/core/sync.ts";
import { literalTableContent, matchBareTable } from "../src/source/table.ts";
import { scanSource } from "../src/source/mod.ts";
import { canonical } from "../src/state/mod.ts";
function ok(value: unknown, message = "assertion failed"): asserts value {
  if (!value) throw new Error(message);
}
function eq(a: unknown, b: unknown) {
  ok(canonical(a) === canonical(b), `${canonical(a)} != ${canonical(b)}`);
}
async function refuses(fn: () => unknown, code: string) {
  try {
    await fn();
  } catch (e) {
    ok(
      String(e).includes(code) || (e as { code?: string }).code === code,
      String(e),
    );
    return;
  }
  throw new Error(`expected ${code}`);
}
const table = "| Group | N |\n| :--- | ---: |\n| Alpha | 12 |\n| Beta | 5 |\n";
const sourceText = `## Plain table\n\n${table}\nA conclusion.\n`;
Deno.test("bare literal table exact proof refuses duplicates, transformed cells and caller metadata", async () => {
  const element = {
      id: "native",
      type: "table",
      ...literalTableContent(table),
    },
    source = scanSource(sourceText);
  const block = matchBareTable(source, element);
  eq(block.kind, "unsupported");
  eq(block.editable, false);
  await refuses(
    () => matchBareTable(scanSource(sourceText + "\n" + table), element),
    "UNMAPPED_TABLE_SOURCE",
  );
  await refuses(
    () => matchBareTable(scanSource(sourceText.replace("12", "13")), element),
    "UNMAPPED_TABLE_SOURCE",
  );
  const forged = structuredClone(source);
  forged.blocks.find((b) => b.id === block.id)!.content = table.replace(
    "12",
    "99",
  );
  eq(matchBareTable(forged, element).content, block.content);
  const stale = structuredClone(source);
  stale.text = sourceText.replace("12", "13");
  await refuses(() => matchBareTable(stale, element), "UNMAPPED_TABLE_SOURCE");
});
Deno.test("ordinary pipe table preserves design through reviewed identity acquisition and source-only rebuild", async () => {
  const dir = await Deno.makeTempDir({ prefix: "qbento-plain-table-" }),
    fresh = await Deno.makeTempDir({ prefix: "qbento-plain-table-rebuild-" }),
    source = `${dir}/deck.qmd`;
  try {
    await Deno.writeTextFile(source, sourceText);
    const first = await renderProject(source),
      edit = structuredClone(first.state.emitted);
    const native = edit.slides[0].elements.find((e) => e.type === "table")!;
    ok(native);
    native.x = 115;
    native.opacity = .85;
    const body = edit.slides[0].elements.find((e) =>
      e.type === "text" && e.html === "A conclusion."
    )!;
    body.html = "A revised conclusion.";
    await saveProject(source, edit, first.state.revision);
    eq(await Deno.readTextFile(source), sourceText);
    const plan = await previewSync(source);
    ok(
      plan.identityBindings?.some((b) =>
        b.target.elementId === native.id && b.expectedTableHash
      ),
    );
    ok(plan.result.includes(table));
    await applySync(source, plan);
    const next = await renderProject(source),
      after = next.state.emitted.slides[0].elements.find((e) =>
        e.id === native.id
      )!;
    eq(after.x, 115);
    eq(after.opacity, .85);
    eq(next.state.docId, first.state.docId);
    eq(next.state.pending.length, 0);
    eq(after.rows, native.rows);
    ok((await Deno.readTextFile(source)).includes(table));
    await Deno.mkdir(`${fresh}/.qbento`);
    for (
      const path of ["deck.qmd", ".qbento/project.json", ".qbento/state.json"]
    ) await Deno.copyFile(`${dir}/${path}`, `${fresh}/${path}`);
    const rebuilt = await renderProject(`${fresh}/deck.qmd`);
    eq(rebuilt.state.emitted, next.state.emitted);
    const cellEdit = structuredClone(rebuilt.state.emitted),
      t = cellEdit.slides[0].elements.find((e) => e.type === "table")!;
    (t.rows as { cells: { html: string }[] }[])[1].cells[1].html = "99";
    const saved = await saveProject(
      `${fresh}/deck.qmd`,
      cellEdit,
      rebuilt.state.revision,
    );
    ok(saved.pending.length > 0);
    const before = await Deno.readTextFile(`${fresh}/deck.qmd`);
    await refuses(() => previewSync(`${fresh}/deck.qmd`), "UNSUPPORTED_SYNC");
    eq(await Deno.readTextFile(`${fresh}/deck.qmd`), before);
  } finally {
    await Deno.remove(dir, { recursive: true });
    await Deno.remove(fresh, { recursive: true });
  }
});

Deno.test("plain table transforms, removal and cross-slide moves refuse without replacing publication", async () => {
  const dir = await Deno.makeTempDir({ prefix: "qbento-plain-table-filter-" }),
    source = `${dir}/deck.qmd`;
  try {
    const original = "---\nfilters: [table.lua]\n---\n\n" + sourceText +
      "\n## Destination\n";
    await Deno.writeTextFile(source, original);
    await Deno.writeTextFile(`${dir}/table.lua`, "-- identity\n");
    await renderProject(source);
    const html = await Deno.readTextFile(`${dir}/deck.bento.html`),
      state = await Deno.readTextFile(`${dir}/.qbento/state.json`);
    for (
      const lua of [
        "function Table(t) return {} end",
        'function Str(s) if s.text == "Alpha" then s.text="Changed" end return s end',
        'function Pandoc(doc) local t=nil; local rest=pandoc.List(); for _,b in ipairs(doc.blocks) do if b.t=="Table" then t=b else rest:insert(b) end end; rest:insert(t); doc.blocks=rest; return doc end',
        'function Table(t) return {pandoc.RawBlock("html","<!-- qb:forged-table -->"),t} end',
      ]
    ) {
      await Deno.writeTextFile(`${dir}/table.lua`, lua);
      await refuses(
        () => renderProject(source),
        lua.startsWith("function Pandoc")
          ? "UNMAPPED_PROVENANCE"
          : "UNMAPPED_TABLE_SOURCE",
      );
      eq(await Deno.readTextFile(source), original);
      eq(await Deno.readTextFile(`${dir}/deck.bento.html`), html);
      eq(await Deno.readTextFile(`${dir}/.qbento/state.json`), state);
    }
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
