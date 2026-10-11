import { applySync, previewSync } from "../src/core/sync.ts";
import { renderProject, saveProject } from "../src/core/project.ts";
import { canonical } from "../src/state/mod.ts";
function eq(actual: unknown, expected: unknown) {
  if (canonical(actual) !== canonical(expected)) {
    throw new Error(`${canonical(actual)} != ${canonical(expected)}`);
  }
}
function ok(value: unknown, message = "assertion failed"): asserts value {
  if (!value) throw new Error(message);
}
class Element {
  textContent = "";
  className = "";
  children: Element[] = [];
  disabled = false;
  hidden = false;
  inert = false;
  onclick?: () => Promise<void>;
  append(...children: Element[]) {
    this.children.push(...children);
  }
  replaceChildren(...children: Element[]) {
    this.children = children;
  }
  addEventListener() {}
  focus() {}
  querySelectorAll() {
    return [];
  }
}
async function client(plan: unknown, revision: number) {
  const nodes = new Map<string, Element>();
  const node = (id: string) => {
    if (!nodes.has(id)) nodes.set(id, new Element());
    return nodes.get(id)!;
  };
  Object.assign(node("editor"), {
    contentWindow: {
      bento: {},
      __qbentoSnapshot: { docId: "doc", revision, pending: 1 },
    },
    contentDocument: {},
  });
  const calls: string[] = [],
    source = await Deno.readTextFile(
      new URL("../src/studio/client.js", import.meta.url),
    );
  const code = source.replace(/^import [^\n]+\n/gm, "");
  const run = new Function(
    "document",
    "fetch",
    "globalThis",
    "createBentoBridge",
    "attachRegistryEditor",
    "attachGraphRelations",
    `${code}\nreturn { prepareSyncPreview };`,
  );
  const callbacks = run(
    { getElementById: node, createElement: () => new Element() },
    (url: string) => {
      calls.push(url);
      return Promise.resolve(
        new Response(JSON.stringify(url === "/api/sync/preview" ? plan : []), {
          headers: { "Content-Type": "application/json" },
        }),
      );
    },
    { qbentoToken: "local", addEventListener() {} },
    () => ({ save: async () => {}, dispose() {}, dirty: false }),
    () => {},
    () => {},
  );
  await callbacks.prepareSyncPreview();
  return { node, calls };
}
const canRun =
  (await Deno.permissions.query({ name: "run" })).state === "granted";
Deno.test({
  name:
    "Studio shows every acquired identity before authored changes and full plain QMD before explicit apply",
  ignore: !canRun,
  fn: async () => {
    const directory = await Deno.makeTempDir({
        prefix: "qbento-plain-review-client-",
      }),
      source = directory + "/deck.qmd";
    try {
      const original =
        "---\nqbento-annotations: none\n---\n\n## Cálculo útil\n\nTexto **original**.\n\nEste párrafo no se ha editado.\n";
      await Deno.writeTextFile(source, original);
      const first = await renderProject(source),
        edited = structuredClone(first.state.emitted);
      edited.slides[0].elements[1].html = "Texto <b>revisado</b>.";
      const saved = await saveProject(source, edited, first.state.revision),
        plan = await previewSync(source),
        c = await client(plan, saved.revision);
      const children = c.node("patches").children,
        sections = children.filter((element) =>
          element.children[0]?.textContent.startsWith("1. Identidad de fuente")
        );
      eq(sections.length, 3);
      eq(
        sections.map((section) =>
          section.children.slice(1).map((element) => element.textContent)
        ),
        plan.identities!.patches.map((
          patch,
        ) => [patch.expected, patch.replacement]),
      );
      ok(children[0].textContent.includes("incluidos los que no has editado"));
      const content = children.findIndex((element) =>
        element.children[0]?.textContent.startsWith("2. Contenido")
      );
      ok(content > children.indexOf(sections.at(-1)!));
      eq(children.at(-1)?.children[0].textContent, "QMD completo propuesto");
      eq(children.at(-1)?.children[1].textContent, plan.result);
      eq(c.node("apply").disabled, false);
      eq(c.calls.includes("/api/sync/apply"), false);
      eq(await Deno.readTextFile(source), original);
      eq(saved.pending.length, 1);
      // This remains the checked backend plan; rendering its review cannot
      // alter fields or authorize an automatic application.
      await applySync(source, plan);
      eq(await Deno.readTextFile(source), plan.result);
    } finally {
      await Deno.remove(directory, { recursive: true });
    }
  },
});
Deno.test("Studio treats an identity-only preview as a reviewed change and never autoapplies it", async () => {
  const plan = {
    stateRevision: 3,
    patch: { patches: [] },
    changes: [],
    identities: {
      patches: [{
        blockId: "heading@0",
        expected: "## Título\n",
        replacement: '## Título {#título bento-title-id="título-title"}\n',
      }],
    },
    result: '## Título {#título bento-title-id="título-title"}\n',
  };
  const c = await client(plan, 3);
  eq(c.node("apply").disabled, false);
  eq(c.calls.includes("/api/sync/apply"), false);
  eq(c.node("patches").children.at(-1)?.children[1].textContent, plan.result);
});
