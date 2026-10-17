import { renderProjectFromAst, saveProject } from "../src/core/project.ts";
import { hashSource } from "../src/source/mod.ts";
import { startStudio } from "../src/studio/server.ts";
import { canonical } from "../src/state/json.ts";

function ok(value: unknown, message = "assertion failed"): asserts value {
  if (!value) throw new Error(message);
}
function eq(actual: unknown, expected: unknown) {
  ok(
    canonical(actual) === canonical(expected),
    `${canonical(actual)} != ${canonical(expected)}`,
  );
}
class Node {
  content = "";
  children: Node[] = [];
  checked = false;
  disabled = false;
  inert = false;
  hidden = false;
  dataset: Record<string, string> = {};
  onchange?: () => Promise<void>;
  onclick?: () => Promise<void>;
  constructor(public tag = "") {}
  get textContent(): string {
    return this.content +
      this.children.map((child) => child.textContent).join("");
  }
  set textContent(value: string) {
    this.content = value;
    this.children = [];
  }
  append(...children: Node[]) {
    this.children.push(...children);
  }
  replaceChildren(...children: Node[]) {
    this.content = "";
    this.children = children;
  }
  querySelectorAll(tag: string): Node[] {
    return this.children.flatMap((
      child,
    ) => [
      ...(child.tag === tag ? [child] : []),
      ...child.querySelectorAll(tag),
    ]);
  }
  addEventListener() {}
  focus() {}
  showModal() {}
  close() {}
}
const pending = [{
  id: "text",
  kind: "field",
  target: { slideId: "slide", elementId: "body" },
  path: ["html"],
  before: { present: true, value: "Before" },
  after: { present: true, value: "After" },
}, {
  id: "delete",
  kind: "delete-element",
  target: { slideId: "slide", elementId: "other" },
  path: [],
  before: { present: true, value: {} },
  after: { present: false },
}];
async function client() {
  const nodes = new Map<string, Node>();
  const node = (id: string) => {
    if (!nodes.has(id)) nodes.set(id, new Node());
    return nodes.get(id)!;
  };
  Object.assign(node("editor"), {
    contentWindow: {
      bento: {},
      __qbentoSnapshot: { docId: "doc", revision: 4, pending: 2 },
    },
    contentDocument: {},
  });
  const requests: { path: string; body: Record<string, unknown> }[] = [];
  const queue: {
    body: Record<string, unknown>;
    resolve: (response: Response) => void;
  }[] = [];
  const response = (value: unknown, status = 200) =>
    new Response(JSON.stringify(value), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  const source = await Deno.readTextFile(
    new URL("../src/studio/client.js", import.meta.url),
  );
  const run = new Function(
    "document",
    "fetch",
    "globalThis",
    "attachLayoutEditor",
    "createBentoBridge",
    "attachRegistryEditor",
    "attachGraphRelations",
    "attachComponentEditor",
    source.replace(/^import [^\n]+\n/gm, ""),
  );
  run(
    {
      getElementById: node,
      createElement: (tag: string) => new Node(tag),
      createTextNode: (text: string) => {
        const n = new Node();
        n.textContent = text;
        return n;
      },
    },
    (url: string, options?: { body?: string }) => {
      const path = url.slice(5),
        body = options?.body ? JSON.parse(options.body) : {};
      requests.push({ path, body });
      if (path === "sync/preview") {
        return new Promise<Response>((resolve) =>
          queue.push({ body, resolve })
        );
      }
      return Promise.resolve(response(
        path === "state"
          ? { revision: 4, pending }
          : path === "sync/apply"
          ? { revision: 5 }
          : [],
      ));
    },
    { qbentoToken: "token", addEventListener() {} },
    () => ({ open() {} }),
    () => ({ save: async () => {}, dispose() {}, dirty: false }),
    () => {},
    () => {},
    () => {},
  );
  return {
    node,
    requests,
    queue,
    response,
    resolve(index: number, error?: string) {
      const q = queue[index];
      q.resolve(
        error ? response({ message: error }, 409) : response({
          stateRevision: 4,
          selectedChangeIds: q.body.selectedChangeIds,
          excludedChangeIds: pending.map((p) => p.id).filter((id) =>
            !(q.body.selectedChangeIds as string[]).includes(id)
          ),
          patch: {
            patches: [{
              blockId: "body",
              expected: "Before",
              replacement: "After",
            }],
          },
          changes: [],
          result: "After",
        }),
      );
    },
  };
}
Deno.test("Studio excludes unconfirmed deletions, binds selection to identity/revision, and discards late previews", async () => {
  const c = await client();
  await c.node("review").onclick!();
  eq(c.queue.length, 0);
  const selection = c.node("sync-selection").querySelectorAll("input");
  eq(selection.length, 2);
  selection[1].checked = false;
  const preview1 = selection[1].onchange!();
  eq(c.queue[0].body, {
    version: 1,
    docId: "doc",
    expectedRevision: 4,
    selectedChangeIds: ["text"],
    confirmedDeleteIds: [],
  });
  ok(c.node("delete-confirmations").querySelectorAll("input")[0].disabled);
  ok(c.node("sync-selection-summary").textContent.includes("1 excluidos"));
  selection[0].checked = false;
  const preview2 = selection[0].onchange!();
  eq(c.queue[1].body.selectedChangeIds, []);
  c.resolve(
    1,
    "PARTIAL_COMPONENT_SELECTION: review all component members together",
  );
  await preview2;
  ok(c.node("apply").disabled);
  c.resolve(0);
  await preview1;
  ok(
    c.node("apply").disabled,
    "stale preview enabled Apply after a newer selection failed",
  );
  ok(c.node("sync-note").textContent.includes("PARTIAL_COMPONENT_SELECTION"));
  selection[0].checked = true;
  const preview3 = selection[0].onchange!();
  c.resolve(2);
  await preview3;
  ok(!c.node("apply").disabled);
  // A selection mutation without its change event must still fail closed at Apply.
  selection[0].checked = false;
  await c.node("apply").onclick!();
  eq(c.requests.filter((request) => request.path === "sync/apply").length, 0);
  ok(c.node("apply").disabled);
  selection[0].checked = true;
  const preview4 = selection[0].onchange!();
  c.resolve(3);
  await preview4;
  await c.node("apply").onclick!();
  const applied = c.requests.filter((request) => request.path === "sync/apply");
  eq(applied.length, 1);
  eq(applied[0].body.selectedChangeIds, ["text"]);
  ok(c.node("sync-note").textContent.includes("Seguirán pendientes"));
});

const canServe =
  (await Deno.permissions.query({ name: "net", host: "127.0.0.1" })).state ===
    "granted";
Deno.test({
  name:
    "Studio selective preview requires current binding and preserves excluded deletions without confirmation",
  ignore: !canServe,
  fn: async () => {
    const dir = await Deno.makeTempDir({ prefix: "qbento-selective-studio-" });
    let studio: Awaited<ReturnType<typeof startStudio>> | undefined;
    try {
      const source = dir + "/deck.qmd",
        text =
          "---\nqbento-annotations: none\n---\n\n## Slide {#slide}\n\n::: {#body}\nBefore.\n:::\n\n::: {#other}\nKeep.\n:::\n";
      await Deno.writeTextFile(source, text);
      const { state } = await renderProjectFromAst(source, {
        ast: {
          meta: { "qbento-annotations": { t: "MetaString", c: "none" } },
          blocks: [
            {
              t: "Header",
              c: [2, ["slide", [], []], [{ t: "Str", c: "Slide" }]],
            },
            ...["body", "other"].map((id) => ({
              t: "Div",
              c: [[id, [], []], [{
                t: "Para",
                c: [{ t: "Str", c: id === "body" ? "Before." : "Keep." }],
              }]],
            })),
          ],
        },
        sourceHash: hashSource(text),
        assetDirectories: [dir],
      });
      const doc = structuredClone(state.emitted);
      doc.slides[0].elements.find((e) => e.id.startsWith("body/"))!.html =
        "After.";
      doc.slides[0].elements = doc.slides[0].elements.filter((e) =>
        !e.id.startsWith("other/")
      );
      const saved = await saveProject(source, doc, state.revision);
      eq(saved.pending.length, 2);
      studio = await startStudio(source);
      const page = await (await fetch(studio.url)).text(),
        token = JSON.parse(page.match(/qbentoToken\s*=\s*("[^"]+")/)![1]);
      const post = (body: unknown) =>
        fetch(studio!.url + "/api/sync/preview", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-qbento-token": token,
          },
          body: JSON.stringify(body),
        });
      const selected = saved.pending.find((p) =>
        p.kind !== "delete-element"
      )!.id;
      const request = {
        version: 1,
        docId: saved.docId,
        expectedRevision: saved.revision,
        selectedChangeIds: [selected],
        confirmedDeleteIds: [],
      };
      const preview = await post(request);
      eq(preview.status, 200);
      const plan = await preview.json();
      eq(plan.selectedChangeIds, [selected]);
      eq(plan.excludedChangeIds.length, 1);
      ok(plan.result.includes("After."));
      ok(plan.result.includes("Keep."));
      eq(await Deno.readTextFile(source), text);
      for (
        const [override, code] of [
          [{ docId: "another-document" }, "UNRELATED_DOCUMENT"],
          [{ expectedRevision: saved.revision - 1 }, "STALE_REVISION"],
          [{ version: 2 }, "INVALID_SELECTION"],
        ] as const
      ) {
        const invalid = await post({ ...request, ...override });
        eq(invalid.status, 409);
        eq((await invalid.json()).error, code);
      }
      // A malformed new request must not silently fall back to selecting everything.
      const incomplete = { ...request } as Partial<typeof request>;
      delete incomplete.selectedChangeIds;
      for (
        const malformed of [incomplete, null, [], {
          guessedSelection: [selected],
        }]
      ) {
        const refused = await post(malformed);
        eq(refused.status, 409);
        eq((await refused.json()).error, "INVALID_SELECTION");
      }
      // Existing callers that preview all pending changes remain on the checked legacy route.
      const legacy = await post({
        confirmedDeleteIds: [
          saved.pending.find((p) => p.kind === "delete-element")!.id,
        ],
      });
      eq(legacy.status, 200);
      eq((await legacy.json()).selectedChangeIds.length, 2);
    } finally {
      await studio?.shutdown();
      await Deno.remove(dir, { recursive: true });
    }
  },
});
