import { renderProject, saveProject } from "../src/core/project.ts";
import { previewSync } from "../src/core/sync.ts";
import { fork } from "./helpers/graphs.ts";

function assert(value: unknown, message = "assertion failed"): asserts value {
  if (!value) throw new Error(message);
}
class Node {
  textContent = "";
  className = "";
  children: Node[] = [];
  hidden = false;
  disabled = false;
  inert = false;
  src = "";
  dataset: Record<string, string> = {};
  replaceChildren(...children: Node[]) {
    this.children = children;
  }
  append(...children: Node[]) {
    this.children.push(...children);
  }
  addEventListener() {}
  querySelectorAll() {
    return [];
  }
  focus() {}
}

Deno.test("Studio reviews an actual endpoint-only plan with its exact source patch and complete QMD before enabling apply", async () => {
  const dir = await Deno.makeTempDir({ prefix: "qbento-graph-studio-" });
  try {
    const sourcePath = dir + "/deck.qmd";
    const original = "---\nqbento-annotations: none\n---\n\n" + fork;
    await Deno.writeTextFile(sourcePath, original);
    const rendered = await renderProject(sourcePath),
      doc = structuredClone(rendered.state.emitted);
    doc.slides[0].elements.find((element) => element.id === "edge-a/qb-edge")!
      .from = { el: "right/qb-node", side: "left" };
    const saved = await saveProject(sourcePath, doc, rendered.state.revision),
      plan = await previewSync(sourcePath);
    assert(plan.patch.patches.length === 0);
    assert(!plan.attributes && !plan.notes && !plan.structure);
    assert(plan.annotations.patches.length === 0);
    assert(plan.graphs?.patches.length === 1);

    const nodes = new Map<string, Node>();
    const node = (id: string) => {
      if (!nodes.has(id)) nodes.set(id, new Node());
      return nodes.get(id)!;
    };
    Object.assign(node("editor"), {
      contentWindow: {
        bento: {},
        __qbentoSnapshot: {
          docId: saved.docId,
          revision: saved.revision,
          pending: saved.pending.length,
        },
      },
      contentDocument: {},
    });
    const source = await Deno.readTextFile(
      new URL("../src/studio/client.js", import.meta.url),
    );
    // Run the complete shipped client; only transport, DOM and bridge are doubles.
    // Its real preview lifecycle, phase presentation and apply gate stay intact.
    const run = new Function(
      "document",
      "fetch",
      "globalThis",
      "createBentoBridge",
      "attachRegistryEditor",
      "attachGraphRelations",
      source.replace(/^import [^\n]+\n/gm, "") +
        "\nreturn { prepareSyncPreview, showPatches };",
    );
    const requests: string[] = [];
    const client = run(
      {
        getElementById: node,
        createElement: () => new Node(),
      },
      (url: string) => {
        requests.push(url);
        return Promise.resolve(
          new Response(
            JSON.stringify(url === "/api/sync/preview" ? plan : []),
            {
              headers: { "Content-Type": "application/json" },
            },
          ),
        );
      },
      { qbentoToken: "local", addEventListener() {} },
      () => ({ save: async () => {}, dispose() {}, dirty: false }),
      () => {},
      () => {},
    );
    await client.prepareSyncPreview();
    assert(requests.filter((url) => url === "/api/sync/preview").length === 1);
    assert(node("apply").disabled === false, node("sync-note").textContent);
    const sections = node("patches").children,
      relationship = sections.find((section) =>
        section.children[0]?.textContent.includes("Relación del diagrama")
      );
    assert(relationship, "missing endpoint source review");
    assert(
      relationship.children[0].textContent.includes("graph · edge-a · from"),
    );
    assert(relationship.children[1].className === "before");
    assert(
      relationship.children[1].textContent === plan.graphs.patches[0].expected,
    );
    assert(relationship.children[2].className === "after");
    assert(
      relationship.children[2].textContent ===
        plan.graphs.patches[0].replacement,
    );
    const full = sections.find((section) =>
      section.children[0]?.textContent === "QMD completo propuesto"
    );
    assert(
      full?.children[1].textContent === plan.result,
      "missing complete proposed source",
    );
    assert(plan.result.includes('from="right" to="left"'));
    assert(
      await Deno.readTextFile(sourcePath) === original,
      "preview changed source",
    );
    // The ordinary annotation phase follows relationship patches in the actual
    // source transaction. Review must retain that order when annotations exist.
    const annotated = original.replace(
      "qbento-annotations: none",
      "qbento-annotations: minimal",
    );
    await Deno.writeTextFile(sourcePath, annotated);
    const annotatedPlan = await previewSync(sourcePath);
    assert(annotatedPlan.annotations.patches.length > 0);
    client.showPatches(annotatedPlan);
    const titles = node("patches").children.map((section) =>
      section.children[0]?.textContent ?? ""
    );
    const relationIndex = titles.findIndex((title) =>
      title.startsWith("6. Relación")
    );
    const annotationIndex = titles.findIndex((title) =>
      title.startsWith("7. Anotación")
    );
    assert(
      relationIndex >= 0 && annotationIndex > relationIndex,
      "wrong source phase order",
    );
    assert(
      node("patches").children.at(-1)?.children[1].textContent ===
        annotatedPlan.result,
    );
    assert(
      await Deno.readTextFile(sourcePath) === annotated,
      "annotated preview changed source",
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
