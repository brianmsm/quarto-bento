import { nativeGraphSlide } from "../src/core/graph-scope.ts";
import {
  readGraphRelations,
  saveGraphRelation,
} from "../src/core/graph-relations.ts";
import { preflightGraphSync } from "../src/core/graph-sync.ts";
import { renderProject, saveProject } from "../src/core/project.ts";
import { applySync, previewSync } from "../src/core/sync.ts";
import {
  projectAst,
  validateProjectionOrigins,
} from "../src/render/project.ts";
import { readSourceInline } from "../src/render/source-inline.ts";
import { canonical, targetKey } from "../src/state/mod.ts";
import { sourceGraph } from "../src/source/graphs.ts";
import { scanSource } from "../src/source/mod.ts";
import { fork, timeline } from "./helpers/graphs.ts";

function assert(value: unknown, message = "assertion failed"): asserts value {
  if (!value) throw new Error(message);
}
async function refuses(fn: () => unknown | Promise<unknown>, code: string) {
  try {
    await fn();
  } catch (error) {
    assert(
      (error as { code?: string }).code === code ||
        String(error).includes(code),
      String(error),
    );
    return;
  }
  throw new Error("expected " + code);
}
const text = "---\nqbento-annotations: none\n---\n\n" + fork.replace(
  "## Proceso {#flow}\n\n",
  "## Proceso\n\nAntes **del** diagrama.\n\n",
) + "\n" + timeline.replace("## Historia {#history}", "## Proceso");
async function fixture() {
  const dir = await Deno.makeTempDir({ prefix: "qbento-graph-scope-" }),
    source = dir + "/deck.qmd";
  await Deno.writeTextFile(source, text);
  return { dir, source, first: await renderProject(source) };
}

Deno.test("real unpinned duplicate headings retain exact graph scopes through Relations, title/paragraph identity sync, typography gate and rebuild", async () => {
  const f = await fixture();
  try {
    let state = f.first.state;
    const snapshot = await readGraphRelations(f.source);
    assert(snapshot.graphs[0].slideId === state.emitted.slides[0].id);
    assert(snapshot.graphs[1].slideId === state.emitted.slides[1].id);
    assert(
      snapshot.graphs[0].slideId !== snapshot.graphs[1].slideId,
      "duplicate heading text lost native scope",
    );
    const request = {
      expectedDocId: snapshot.docId,
      expectedRevision: snapshot.revision,
      expectedSourceHash: snapshot.sourceHash,
      slideId: snapshot.graphs[0].slideId,
      componentId: "graph",
      edgeId: "edge-a",
      fromNodeId: "right",
      toNodeId: "left",
    };
    await refuses(
      () =>
        saveGraphRelation(f.source, {
          ...request,
          slideId: snapshot.graphs[1].slideId,
        }),
      "GRAPH_ENDPOINT_SCOPE",
    );
    state = await saveGraphRelation(f.source, request);
    let doc = structuredClone(state.emitted);
    const title = doc.slides[0].elements.find((element) =>
      element.id === request.slideId + "-title"
    )!;
    title.html = "Proceso revisado";
    const plain = doc.slides[0].elements.find((element) =>
      typeof element.html === "string" && element.html.startsWith("Antes ")
    )!;
    plain.html = "Antes <b>del</b> diagrama revisado.";
    plain.x = 173;
    const edge = doc.slides[0].elements.find((element) =>
      element.id === "edge-a/qb-edge"
    )!;
    edge.fill = "#21856c";
    edge.from = { el: "right/qb-node", side: "left" };
    const label = doc.slides[0].elements.find((element) =>
        element.id === "input/paragraph:1"
      )!,
      width = label.w;
    label.w = 1;
    state = await saveProject(f.source, doc, state.revision);
    assert(
      (await readGraphRelations(f.source)).graphs[0].slideId ===
        request.slideId,
      "pending native title must not redefine source scope",
    );
    await refuses(() => previewSync(f.source), "GRAPH_CONTENT_OVERFLOW");
    assert(await Deno.readTextFile(f.source) === text);
    doc = structuredClone(state.emitted);
    doc.slides[0].elements.find((element) => element.id === label.id)!.w =
      width;
    await saveProject(f.source, doc, state.revision);
    const plan = await previewSync(f.source);
    assert(
      plan.identities?.patches.length === 3 &&
        plan.graphs?.patches.length === 1,
    );
    assert(
      plan.result.includes('from="right" to="left"') &&
        plan.result.includes("Proceso revisado"),
    );
    assert(plan.result.includes("Antes **del** diagrama revisado."));
    assert(await Deno.readTextFile(f.source) === text);
    await applySync(f.source, plan);
    const final = await renderProject(f.source);
    assert(
      final.state.docId === f.first.state.docId && !final.state.pending.length,
    );
    assert(final.state.emitted.slides[0].id === request.slideId);
    const elements = final.state.emitted.slides[0].elements;
    assert(
      canonical(elements.find((element) => element.id === plain.id)) ===
        canonical(plain),
    );
    assert(
      canonical(elements.find((element) => element.id === edge.id)!.from) ===
        canonical(edge.from),
    );
    assert(
      elements.find((element) => element.id === edge.id)!.fill === edge.fill,
    );
    assert(
      (await readGraphRelations(f.source)).graphs[0].edges[0].fromNodeId ===
        "right",
    );
    await Deno.remove(final.output);
    const rebuilt = await renderProject(f.source);
    assert(canonical(rebuilt.state.emitted) === canonical(final.state.emitted));
  } finally {
    await Deno.remove(f.dir, { recursive: true });
  }
});

Deno.test("weak graph scope rejects missing, duplicated, moved or forged heading/graph receipts and prospective relocation", async () => {
  const f = await fixture();
  try {
    const source = scanSource(text),
      graph = sourceGraph(source, "graph"),
      good = f.first.state;
    const nativeId = good.emitted.slides[0].id,
      foreign = good.emitted.slides[1].id;
    const titleKey = targetKey({
      slideId: nativeId,
      elementId: nativeId + "-title",
    });
    const graphKey = targetKey({
      slideId: nativeId,
      elementId: "input/qb-node",
    });
    assert(nativeGraphSlide(source, good, graph) === nativeId);
    for (
      const action of [
        "missing",
        "duplicate",
        "move",
        "hash",
        "codec",
        "native-scope",
        "source-scope",
        "title-type",
      ]
    ) {
      const bad = structuredClone(good);
      if (action === "missing") delete bad.provenance[titleKey];
      if (action === "duplicate" || action === "move") {
        bad
          .provenance[
            targetKey({ slideId: foreign, elementId: "foreign-title" })
          ] = structuredClone(bad.provenance[titleKey]);
        if (action === "move") delete bad.provenance[titleKey];
      }
      if (action === "hash") {
        bad.provenance[titleKey].source!.hash = "0".repeat(64);
      }
      if (action === "codec") {
        delete bad.provenance[titleKey].source!.inlineCodec;
      }
      if (action === "native-scope") {
        (bad.provenance[graphKey].source!.graph as Record<string, unknown>)
          .nativeSlideId = foreign;
      }
      if (action === "source-scope") {
        (bad.provenance[graphKey].source!.graph as Record<string, unknown>)
          .sourceSlideId = source.slides[1].id;
      }
      if (action === "title-type") {
        bad.generatedBaseline.slides[0].elements.find((element) =>
          element.id === nativeId + "-title"
        )!.type = "shape";
      }
      await refuses(
        () => nativeGraphSlide(source, bad, graph),
        "UNMAPPED_GRAPH_SOURCE",
      );
    }
    const relocated = text.replace(graph.wrapper.raw, "") + "\n" +
      graph.wrapper.raw;
    await refuses(
      () => preflightGraphSync(good, text, relocated),
      "SOURCE_CONFLICT",
    );
    assert(await Deno.readTextFile(f.source) === text);
  } finally {
    await Deno.remove(f.dir, { recursive: true });
  }
});

Deno.test("projection under a plain heading requires its exact original reader identity and refuses foreign scope or forged title", async () => {
  const input = fork.replace("## Proceso {#flow}", "## Proceso") +
      "\n## Otro\n\nTexto externo.\n",
    source = scanSource(input);
  const child = new Deno.Command("quarto", {
    args: ["pandoc", "--from", "markdown", "--to", "json"],
    stdin: "piped",
    stdout: "piped",
    stderr: "piped",
  }).spawn();
  const output = child.output(), writer = child.stdin.getWriter();
  await writer.write(new TextEncoder().encode(input));
  await writer.close();
  const result = await output;
  assert(result.success);
  const projection = await projectAst(
      JSON.parse(new TextDecoder().decode(result.stdout)),
      "scope-test",
      [],
      source,
    ),
    inline = await readSourceInline(source);
  validateProjectionOrigins(source, projection, inline);
  const forged = structuredClone(projection);
  forged.document.slides[0].elements[0].html = "Otro";
  await refuses(
    () => validateProjectionOrigins(source, forged, inline),
    "UNMAPPED_PROVENANCE",
  );
  const foreign = structuredClone(projection),
    from = foreign.document.slides[0],
    to = foreign.document.slides[1];
  const ids = from.elements.filter((element) =>
    element.id !== from.id + "-title"
  ).map((element) => element.id);
  to.elements.push(
    ...from.elements.filter((element) => ids.includes(element.id)),
  );
  from.elements = from.elements.filter((element) => !ids.includes(element.id));
  for (const id of ids) {
    foreign.origins[to.id][id] = foreign.origins[from.id][id];
    delete foreign.origins[from.id][id];
  }
  await refuses(
    () => validateProjectionOrigins(source, foreign, inline),
    "UNMAPPED_GRAPH_PROVENANCE",
  );
});
