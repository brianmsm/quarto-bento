import {
  type GraphRelations,
  readGraphRelations,
  saveGraphRelation,
} from "../src/core/graph-relations.ts";
import {
  readProject,
  renderProject,
  saveProject,
} from "../src/core/project.ts";
import { applySync, previewSync } from "../src/core/sync.ts";
import { hashSource } from "../src/source/mod.ts";
import { StateStore } from "../src/state/store.ts";
import { targetKey } from "../src/state/mod.ts";
import { fork, timeline } from "./helpers/graphs.ts";

function assert(value: unknown, message = "assertion failed"): asserts value {
  if (!value) throw new Error(message);
}
function eq(actual: unknown, expected: unknown) {
  assert(
    JSON.stringify(actual) === JSON.stringify(expected),
    JSON.stringify({ actual, expected }),
  );
}
async function refuses(action: () => Promise<unknown>, code: string) {
  try {
    await action();
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
async function fixture() {
  const dir = await Deno.makeTempDir({ prefix: "qbento-relations-" }),
    source = dir + "/deck.qmd";
  const text = "---\nqbento-annotations: none\n---\n\n" + fork + "\n" +
    timeline;
  await Deno.writeTextFile(source, text);
  const rendered = await renderProject(source);
  return { dir, source, text, rendered };
}
const request = (
  snapshot: GraphRelations,
  fromNodeId = "right",
  toNodeId = "left",
) => ({
  expectedDocId: snapshot.docId,
  expectedRevision: snapshot.revision,
  expectedSourceHash: snapshot.sourceHash,
  slideId: "flow",
  componentId: "graph",
  edgeId: "edge-a",
  fromNodeId,
  toNodeId,
});
function edge(state: Awaited<ReturnType<typeof readProject>>) {
  return state.emitted.slides[0].elements.find((element) =>
    element.id === "edge-a/qb-edge"
  )!;
}

Deno.test("bounded relationship Save persists pending native endpoints and visual side without source writes, then ordinary review/apply/render succeeds", async () => {
  const f = await fixture();
  try {
    const doc = structuredClone(f.rendered.state.emitted),
      native = doc.slides[0].elements.find((element) =>
        element.id === "edge-a/qb-edge"
      )!;
    native.from = { ...(native.from as object), side: "top" };
    native.fill = "#21856c";
    doc.slides[0].elements.find((element) =>
      element.id === "input/paragraph:1"
    )!.html = "Muestra";
    await saveProject(f.source, doc, f.rendered.state.revision);
    const snapshot = await readGraphRelations(f.source);
    eq(snapshot.graphs.map((graph) => graph.kind), ["diagram", "timeline"]);
    eq(snapshot.graphs[0].nodes.map((node) => node.id), [
      "input",
      "left",
      "right",
    ]);
    const beforeOutput = await Deno.readTextFile(f.rendered.output);
    const saved = await saveGraphRelation(f.source, request(snapshot));
    assert(
      saved.revision > snapshot.revision && saved.docId === snapshot.docId,
    );
    eq(edge(saved).from, { el: "right/qb-node", side: "top" });
    assert(saved.pending.some((change) => change.path.join("/") === "from/el"));
    assert(saved.pending.some((change) => change.path.join("/") === "html"));
    assert(await Deno.readTextFile(f.source) === f.text);
    assert(await Deno.readTextFile(f.rendered.output) === beforeOutput);
    eq((await readProject(f.source)).pending, saved.pending);
    const plan = await previewSync(f.source);
    assert(
      plan.graphs?.patches.length === 1 &&
        plan.result.includes('from="right" to="left"'),
    );
    assert(plan.result.includes("Muestra"));
    await applySync(f.source, plan);
    const final = (await renderProject(f.source)).state;
    eq(final.pending, []);
    eq(edge(final).from, { el: "right/qb-node", side: "top" });
    eq(edge(final).fill, "#21856c");
    eq(final.docId, snapshot.docId);
  } finally {
    await Deno.remove(f.dir, { recursive: true });
  }
});

Deno.test("change, detach both anchors and reconnect normalizes old root/leaf pending while retaining side, geometry and unrelated edits", async () => {
  const f = await fixture();
  try {
    let state = await saveGraphRelation(
      f.source,
      request(await readGraphRelations(f.source)),
    );
    let doc = structuredClone(state.emitted),
      native = doc.slides[0].elements.find((element) =>
        element.id === "edge-a/qb-edge"
      )!;
    native.from = { ...(native.from as object), side: "top" };
    native.rotation = 77;
    doc.slides[0].elements.find((element) =>
      element.id === "input/paragraph:1"
    )!.html = "Pendiente";
    state = await saveProject(f.source, doc, state.revision);
    doc = structuredClone(state.emitted);
    native = doc.slides[0].elements.find((element) =>
      element.id === "edge-a/qb-edge"
    )!;
    delete native.from;
    delete native.to;
    state = await saveProject(f.source, doc, state.revision);
    assert(
      state.pending.filter((change) =>
        change.target.elementId === "edge-a/qb-edge" &&
        change.path[0] === "from"
      ).length === 1,
    );
    assert((await readGraphRelations(f.source)).graphs[0].edges[0].detached);
    state = await saveGraphRelation(
      f.source,
      request(await readGraphRelations(f.source), "input", "left"),
    );
    eq(edge(state).from, { el: "input/qb-node", side: "top" });
    eq(edge(state).to, { el: "left/qb-node", side: "auto" });
    eq(edge(state).rotation, 77);
    assert(
      !state.pending.some((change) =>
        change.target.elementId === "edge-a/qb-edge" &&
        ["from", "to"].includes(change.path[0])
      ),
    );
    assert(state.pending.some((change) => change.path[0] === "html"));
    const restoredPlan = await previewSync(f.source);
    assert(
      !restoredPlan.graphs,
      "stale child endpoint leaked into restored source review",
    );
    await applySync(f.source, restoredPlan);
    state = (await renderProject(f.source)).state;
    eq(edge(state).from, { el: "input/qb-node", side: "top" });
    // Repeat with a genuinely new pair after another full detachment.
    doc = structuredClone(state.emitted);
    native = doc.slides[0].elements.find((element) =>
      element.id === "edge-a/qb-edge"
    )!;
    delete native.from;
    delete native.to;
    state = await saveProject(f.source, doc, state.revision);
    state = await saveGraphRelation(
      f.source,
      request(await readGraphRelations(f.source), "right", "input"),
    );
    const changes = state.pending.filter((change) =>
      change.target.elementId === "edge-a/qb-edge" &&
      ["from", "to"].includes(change.path[0])
    );
    eq(changes.map((change) => change.path.join("/")).sort(), [
      "from/el",
      "to/el",
    ]);
    eq(changes.find((change) => change.path[0] === "from")!.before, {
      present: true,
      value: "input/qb-node",
    });
    eq(changes.find((change) => change.path[0] === "to")!.before, {
      present: true,
      value: "left/qb-node",
    });
    await refuses(() => previewSync(f.source), "GRAPH_TOPOLOGY_UNSUPPORTED");
    assert(
      !((await Deno.readTextFile(f.source)).includes(
        'from="right" to="input"',
      )),
    );
  } finally {
    await Deno.remove(f.dir, { recursive: true });
  }
});

Deno.test("relationship actions refuse foreign identities, timelines, stale source/revision, conflicts and incomplete graph members without changing bytes", async () => {
  const f = await fixture();
  try {
    const snapshot = await readGraphRelations(f.source),
      good = request(snapshot);
    const before = await Deno.readTextFile(f.dir + "/.qbento/state.json");
    for (
      const [patch, code] of [
        [{ expectedDocId: "foreign" }, "UNRELATED_DOCUMENT"],
        [{ expectedRevision: snapshot.revision - 1 }, "STALE_REVISION"],
        [{ fromNodeId: "input/paragraph:1" }, "GRAPH_ENDPOINT_SCOPE"],
        [{ fromNodeId: "start" }, "GRAPH_ENDPOINT_SCOPE"],
        [{ componentId: "foreign" }, "GRAPH_ENDPOINT_SCOPE"],
        [{ edgeId: "edge-b/qb-edge" }, "GRAPH_ENDPOINT_SCOPE"],
        [{
          slideId: "history",
          componentId: "story",
          edgeId: snapshot.graphs[1].edges[0].id,
          fromNodeId: "start",
          toNodeId: "study",
        }, "UNSUPPORTED_TIMELINE_RELATION"],
        [{ unexpected: true }, "INVALID_GRAPH_RELATION"],
      ] as [object, string][]
    ) {
      await refuses(
        () => saveGraphRelation(f.source, { ...good, ...patch }),
        code,
      );
    }
    assert(await Deno.readTextFile(f.dir + "/.qbento/state.json") === before);
    await Deno.writeTextFile(f.source, f.text + "\nOtro texto.\n");
    await refuses(() => saveGraphRelation(f.source, good), "STALE_SOURCE");
    await refuses(() => readGraphRelations(f.source), "STALE_SOURCE");
    await Deno.writeTextFile(f.source, f.text);
    let state = await saveGraphRelation(f.source, good);
    await refuses(() => saveGraphRelation(f.source, good), "STALE_REVISION");
    const conflict = state.pending.find((change) =>
      change.path.join("/") === "from/el"
    )!;
    conflict.status = "conflict";
    conflict.source = { present: true, value: "left/qb-node" };
    const store = new StateStore(f.dir + "/.qbento");
    state = await store.save(state);
    const conflicting = await Deno.readTextFile(f.dir + "/.qbento/state.json");
    await refuses(
      async () =>
        saveGraphRelation(
          f.source,
          request(await readGraphRelations(f.source)),
        ),
      "GRAPH_RELATION_CONFLICT",
    );
    assert(
      await Deno.readTextFile(f.dir + "/.qbento/state.json") === conflicting,
    );
    let doc = structuredClone(state.emitted);
    doc.slides[0].elements.find((element) => element.id === "input/qb-node")!
      .fill = "#e0e8e4";
    state = await saveProject(f.source, doc, state.revision);
    eq(state.pending.find((change) => change.id === conflict.id), conflict);
    doc = structuredClone(state.emitted);
    doc.slides[0].elements.find((element) => element.id === "edge-a/qb-edge")!
      .shape = "rect";
    state = await saveProject(f.source, doc, state.revision);
    await refuses(
      () => readGraphRelations(f.source),
      "GRAPH_PENDING_STRUCTURE",
    );
    await refuses(
      () =>
        saveGraphRelation(
          f.source,
          request({ ...snapshot, revision: state.revision }),
        ),
      "GRAPH_PENDING_STRUCTURE",
    );
    doc = structuredClone(state.emitted);
    doc.slides[0].elements.find((element) => element.id === "edge-a/qb-edge")!
      .shape = "line";
    state = await saveProject(f.source, doc, state.revision);
    doc = structuredClone(state.emitted);
    doc.slides[0].elements = doc.slides[0].elements.filter((element) =>
      element.id !== "left/qb-node"
    );
    state = await saveProject(f.source, doc, state.revision);
    await refuses(() => readGraphRelations(f.source), "GRAPH_PENDING_DELETION");
    await refuses(
      () =>
        saveGraphRelation(
          f.source,
          request({ ...snapshot, revision: state.revision }),
        ),
      "GRAPH_PENDING_DELETION",
    );
    assert(await Deno.readTextFile(f.source) === f.text);
    assert(
      state
        .provenance[targetKey({ slideId: "flow", elementId: "edge-a/qb-edge" })]
        .source?.hash === hashSource(f.text),
    );
  } finally {
    await Deno.remove(f.dir, { recursive: true });
  }
});

Deno.test("relationship source and revision races are rechecked by the shared durable Save pipeline", async () => {
  const f = await fixture();
  const write = Deno.readTextFile;
  try {
    const snapshot = await readGraphRelations(f.source),
      good = request(snapshot),
      before = await write(f.dir + "/.qbento/state.json");
    let reads = 0;
    Deno.readTextFile = async (path: string | URL) => {
      const result = await write(path);
      if (path === f.source && ++reads === 1) {
        await Deno.writeTextFile(f.source, f.text + "\nConcurrencia.\n");
      }
      return result;
    };
    await refuses(() => saveGraphRelation(f.source, good), "STALE_SOURCE");
    Deno.readTextFile = write;
    assert(await write(f.dir + "/.qbento/state.json") === before);
    await Deno.writeTextFile(f.source, f.text);
    reads = 0;
    Deno.readTextFile = async (path: string | URL) => {
      const result = await write(path);
      if (path === f.source && ++reads === 1) {
        const state = await readProject(f.source);
        const doc = structuredClone(state.emitted);
        doc.slides[0].background = "#fffdf8";
        await saveProject(f.source, doc, state.revision);
      }
      return result;
    };
    await refuses(() => saveGraphRelation(f.source, good), "STALE_REVISION");
    Deno.readTextFile = write;
    const final = await readProject(f.source);
    eq(edge(final).from, { el: "input/qb-node", side: "auto" });
    eq(final.emitted.slides[0].background, "#fffdf8");
  } finally {
    Deno.readTextFile = write;
    await Deno.remove(f.dir, { recursive: true });
  }
});

Deno.test("legacy endpoint journal must match the actual saved connector before proposing any source patch", async () => {
  const f = await fixture();
  try {
    let state = await saveGraphRelation(
      f.source,
      request(await readGraphRelations(f.source)),
    );
    // Represent a previously saved inconsistent journal; a no-op Save does
    // not migrate or silently discard evidence that the user has not reviewed.
    edge(state).from = { el: "input/qb-node", side: "auto" };
    state = await new StateStore(f.dir + "/.qbento").save(state);
    const unchanged = await saveGraphRelation(
      f.source,
      request(await readGraphRelations(f.source), "input", "left"),
    );
    eq(unchanged.revision, state.revision);
    await refuses(() => previewSync(f.source), "GRAPH_RELATION_SNAPSHOT");
    assert(await Deno.readTextFile(f.source) === f.text);
    eq((await readProject(f.source)).pending, state.pending);
  } finally {
    await Deno.remove(f.dir, { recursive: true });
  }
});
