import { join } from "node:path";
import { cp } from "node:fs/promises";
import {
  captureProject,
  readProject,
  renderProject,
  saveProject,
} from "../src/core/project.ts";
import { applyReconcile, previewReconcile } from "../src/core/reconcile.ts";
import { previewSync } from "../src/core/sync.ts";
import { extractDocument, spliceDocument } from "../src/render/html.ts";
import { projectAst } from "../src/render/project.ts";
import { executeQuarto } from "../src/render/quarto.ts";
import { scanSource } from "../src/source/mod.ts";
import { prepareRichTables } from "../src/rich/project.ts";
import { canonical, targetKey } from "../src/state/mod.ts";
import { installQuartoProject } from "../src/integration/install.ts";
import type { Ast, Node } from "../src/render/types.ts";
function eq(a: unknown, b: unknown) {
  if (canonical(a) !== canonical(b)) {
    throw new Error(`${canonical(a)} != ${canonical(b)}`);
  }
}
function ok(v: unknown, m = "assertion failed"): asserts v {
  if (!v) throw new Error(m);
}
async function refuses(fn: () => unknown, code: string) {
  try {
    await fn();
  } catch (e) {
    if (String(e).includes(code) || (e as { code?: string }).code === code) {
      return;
    }
    throw e;
  }
  throw new Error(`Expected ${code}`);
}
// Freeze the canonical inputs for this test module. Editing the demonstration
// while a long suite runs must not make its three tests use different fixtures.
const canonicalInputs = new Map(
  await Promise.all(
    ["deck.qmd", "data.csv", "participants.csv"].map(async (name) =>
      [
        name,
        await Deno.readTextFile(
          new URL(`../examples/rich-tables/${name}`, import.meta.url),
        ),
      ] as const
    ),
  ),
);
async function fixture(dir: string) {
  await Deno.mkdir(dir, { recursive: true });
  for (const name of ["data.csv", "participants.csv"]) {
    await Deno.writeTextFile(join(dir, name), canonicalInputs.get(name)!);
  }
  const raw = canonicalInputs.get("deck.qmd")!;
  const qmd = raw.replaceAll(
    "#| echo: false\n",
    "#| echo: false\ncat('executed\\n', file='executions.txt', append=TRUE)\n",
  ).replaceAll("\n", "\r\n");
  await Deno.writeTextFile(join(dir, "deck.qmd"), qmd);
  return qmd;
}
async function count(dir: string) {
  return (await Deno.readTextFile(join(dir, "executions.txt"))).trim().split(
    "\n",
  ).length;
}
const id = "grouped-table/table-fallback";
function image(doc: { slides: { elements: Record<string, unknown>[] }[] }) {
  const el = doc.slides[0].elements.find((e) => e.id === id);
  ok(el, "native table image missing");
  return el;
}
Deno.test("integrated rich table PNG keeps source authority design identity conflicts and relocation", async () => {
  const dir = await Deno.makeTempDir({ prefix: "qb-rich-project-" }),
    relocated = await Deno.makeTempDir({ prefix: "qb-rich-move-" });
  try {
    const qmd = await fixture(dir),
      source = join(dir, "deck.qmd"),
      output = join(dir, "deck.bento.html");
    const first = await renderProject(source),
      firstImage = image(first.state.emitted);
    eq(await count(dir), 2);
    eq(firstImage.type, "image");
    ok(String(firstImage.src).startsWith("data:image/png;base64,"));
    eq(
      first.diagnostics.filter((d) => d.code === "STATIC_TABLE_PNG_FALLBACK")
        .length,
      2,
    );
    const provenance =
      first.state.provenance[targetKey({ slideId: "results", elementId: id })];
    eq([provenance.origin, provenance.producer, provenance.semanticId], [
      "computed",
      "grouped-maker",
      "grouped-maker",
    ]);
    ok(provenance.source?.richTable, "trusted state receipt absent");
    const receipt = provenance.source.richTable as {
      width: number;
      height: number;
      pixelRatio: number;
    };
    eq([firstImage.w, firstImage.h], [receipt.width, receipt.height]);
    eq([receipt.width, receipt.pixelRatio], [1120, 2]);
    ok(
      receipt.height > 0 && receipt.height <= 534,
      "natural table must fit its frame",
    );
    const png = Uint8Array.from(
      atob(String(firstImage.src).split(",")[1]),
      (c) => c.charCodeAt(0),
    );
    const pngHeader = new DataView(png.buffer, png.byteOffset, png.byteLength);
    eq([pngHeader.getUint32(16), pngHeader.getUint32(20)], [
      Number(firstImage.w) * 2,
      Number(firstImage.h) * 2,
    ]);
    const again = await renderProject(source);
    eq(await count(dir), 4);
    eq(image(again.state.emitted).src, firstImage.src);
    const edited = structuredClone(again.state.emitted),
      geometry = { x: 105, y: 170, w: 1000, h: 232 };
    Object.assign(image(edited), geometry);
    const saved = await saveProject(source, edited, again.state.revision);
    eq((await readProject(source)).revision, saved.revision);
    eq(saved.pending, []);
    await Deno.writeTextFile(
      join(dir, "data.csv"),
      'Group,N,Mean\n"A < B & ""C""",-12,3.75\nMálaga,6,-4.2\n',
    );
    const changed = await renderProject(source),
      changedImage = image(changed.state.emitted);
    eq(await count(dir), 6);
    eq(changed.state.docId, first.state.docId);
    ok(changedImage.src !== firstImage.src, "computed pixels froze");
    for (const [key, value] of Object.entries(geometry)) {
      eq(changedImage[key], value);
    }
    eq(await Deno.readTextFile(source), qmd);
    eq(changed.state.pending, []);
    const changedNative = structuredClone(changed.state.emitted);
    image(changedNative).src = firstImage.src;
    const pending = await saveProject(
      source,
      changedNative,
      changed.state.revision,
    );
    const conflict = pending.pending.find((p) => p.path[0] === "src");
    ok(conflict);
    eq([conflict.origin, conflict.status], ["computed", "conflict"]);
    await refuses(() => previewSync(source), "SYNC_CONFLICT");
    eq(await Deno.readTextFile(source), qmd);
    const stalePlan = await previewReconcile(source);
    const currentCsv = await Deno.readTextFile(join(dir, "data.csv"));
    await Deno.writeTextFile(
      join(dir, "data.csv"),
      currentCsv.replace("3.75", "7.25"),
    );
    await refuses(
      () =>
        applyReconcile(source, stalePlan, [{
          changeId: conflict.id,
          action: "detach",
        }]),
      "STALE_RECONCILE_PLAN",
    );
    eq((await readProject(source)).revision, pending.revision);
    await Deno.writeTextFile(join(dir, "data.csv"), currentCsv);
    const plan = await previewReconcile(source);
    await applyReconcile(source, plan, [{
      changeId: conflict.id,
      action: "detach",
    }]);
    const refreshed = await renderProject(source);
    eq(await count(dir), 16);
    eq(image(refreshed.state.emitted).src, firstImage.src);
    eq(
      refreshed.state.pending.find((p) => p.path[0] === "src")?.origin,
      "detached",
    );
    const html = await Deno.readTextFile(output),
      native = extractDocument(html);
    image(native).x = 120;
    const uncaptured = spliceDocument(html, native);
    await Deno.writeTextFile(output, uncaptured);
    await refuses(() => renderProject(source), "UNCAPTURED_HTML_EDITS");
    eq(await count(dir), 16);
    eq(await Deno.readTextFile(output), uncaptured);
    await captureProject(source);
    eq(await Deno.readTextFile(source), qmd);
    const moved = join(relocated, "project");
    await cp(dir, moved, { recursive: true });
    await Deno.remove(join(moved, "deck.bento.html"));
    await Deno.remove(join(moved, ".qbento", "build"), { recursive: true });
    const rebuilt = await renderProject(join(moved, "deck.qmd"));
    eq(await count(moved), 18);
    eq(rebuilt.state.docId, first.state.docId);
    eq(image(rebuilt.state.emitted).x, 120);
    eq(image(rebuilt.state.emitted).src, firstImage.src);
    eq(
      rebuilt.state.pending.find((p) => p.path[0] === "src")?.origin,
      "detached",
    );
    eq(await Deno.readTextFile(join(moved, "deck.qmd")), qmd);
  } finally {
    await Deno.remove(dir, { recursive: true });
    await Deno.remove(relocated, { recursive: true });
  }
});
Deno.test("rich projection rejects stale capture wrong slide duplicate wrapper and insufficient remaining frame", async () => {
  const dir = await Deno.makeTempDir({ prefix: "qb-rich-binding-" });
  try {
    const qmd = await fixture(dir),
      source = scanSource(qmd),
      ast = await executeQuarto(join(dir, "deck.qmd"), join(dir, "build")),
      snapshots = await prepareRichTables(ast, source);
    const project = (next: Ast = ast, map = snapshots) =>
      projectAst(next, "doc", [], source, new Map(), {}, map);
    await project();
    eq(await count(dir), 2);
    await refuses(
      () => project(ast, new Map()),
      "RICH_TABLE_PROJECTION_MISMATCH",
    );
    const tampered = structuredClone(snapshots);
    tampered.get("grouped-table")!.png[40] ^= 1;
    await refuses(
      () => project(ast, tampered),
      "RICH_TABLE_PROJECTION_MISMATCH",
    );
    const stale = structuredClone(snapshots);
    stale.get("grouped-table")!.receipt.source.sourceHash = "f".repeat(64);
    await refuses(() => project(ast, stale), "RICH_TABLE_PROJECTION_MISMATCH");
    // Preserve the trusted execution AST; a serialized clone correctly loses
    // its private producer receipt trust before these adapter-specific checks.
    const duplicate = ast;
    duplicate.blocks.push(
      structuredClone(duplicate.blocks.find((b) => b.t === "Div")!),
    );
    await refuses(() => project(duplicate), "duplicate executed wrapper");
    duplicate.blocks.pop();
    const wrong = ast;
    const originalHeading = (wrong.blocks.find((b) =>
      b.t === "Header"
    )!.c as unknown[][])[1][0];
    (wrong.blocks.find((b) => b.t === "Header")!.c as unknown[][])[1][0] =
      "other-slide";
    await refuses(() => project(wrong), "RICH_TABLE_PROJECTION_MISMATCH");
    (wrong.blocks.find((b) => b.t === "Header")!.c as unknown[][])[1][0] =
      originalHeading;
    const content = ast;
    const second = content.blocks.findIndex((b) =>
      b.t === "Header" && (b.c as unknown[][])[1][0] === "summary"
    );
    content.blocks.splice(
      second + 1,
      0,
      ...Array.from({ length: 4 }, (_, index): Node => ({
        t: "Para",
        c: [{ t: "Str", c: `Preceding content ${index + 1}` }],
      })),
    );
    await refuses(() => project(content), "cannot fit after preceding content");
    content.blocks.splice(second + 1, 4);
    eq(await count(dir), 2);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
Deno.test("ordinary Quarto rich-table render executes once and its capture guard precedes R", async () => {
  const dir = await Deno.makeTempDir({ prefix: "qb-rich-extension-" });
  try {
    const qmd = await fixture(dir), source = join(dir, "deck.qmd");
    await installQuartoProject(source);
    const render = async () => {
      const out = await new Deno.Command("quarto", {
        cwd: dir,
        args: ["render", "deck.qmd"],
        env: {
          XDG_CACHE_HOME: join(dir, "cache"),
          QUARTO_RUN_NO_NETWORK: "true",
        },
        stdout: "piped",
        stderr: "piped",
      }).output();
      return {
        success: out.success,
        log: new TextDecoder().decode(out.stdout) +
          new TextDecoder().decode(out.stderr),
      };
    };
    let result = await render();
    ok(result.success, result.log);
    eq(await count(dir), 2);
    const output = join(dir, "deck.bento.html"),
      html = await Deno.readTextFile(output),
      doc = extractDocument(html),
      original = image(doc).src;
    image(doc).x = 111;
    const edited = spliceDocument(html, doc);
    await Deno.writeTextFile(output, edited);
    result = await render();
    ok(!result.success && result.log.includes("UNCAPTURED_HTML"), result.log);
    eq(await count(dir), 2);
    eq(await Deno.readTextFile(output), edited);
    await captureProject(source);
    await Deno.writeTextFile(
      join(dir, "data.csv"),
      "Group,N,Mean\nGamma,20,5.5\nDelta,-4,-2.5\n",
    );
    result = await render();
    ok(result.success, result.log);
    eq(await count(dir), 4);
    const next = extractDocument(await Deno.readTextFile(output));
    eq(next.docId, doc.docId);
    eq(image(next).x, 111);
    ok(image(next).src !== original);
    eq(await Deno.readTextFile(source), qmd);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
