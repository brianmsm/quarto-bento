import { canonical } from "../src/state/json.ts";
function ok(value: unknown, message = "assertion failed"): asserts value {
  if (!value) throw new Error(message);
}
function eq(a: unknown, b: unknown) {
  ok(canonical(a) === canonical(b), `${canonical(a)} != ${canonical(b)}`);
}
class Node {
  content = "";
  children: Node[] = [];
  tag = "";
  checked = false;
  disabled = false;
  hidden = false;
  inert = false;
  src = "";
  value = "";
  dataset: Record<string, string> = {};
  onclick?: () => Promise<void>;
  onchange?: () => Promise<void>;
  constructor(tag = "") {
    this.tag = tag;
  }
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
  focus() {}
  addEventListener() {}
  showModal() {}
  close() {}
}
Deno.test("shipped Studio client requires a specific checkbox for each source deletion and exposes recoverable element restoration", async () => {
  const nodes = new Map<string, Node>();
  const node = (id: string) => {
    if (!nodes.has(id)) nodes.set(id, new Node());
    return nodes.get(id)!;
  };
  Object.assign(node("editor"), {
    contentWindow: {
      bento: {},
      __qbentoSnapshot: { docId: "doc", revision: 1, pending: 2 },
    },
    contentDocument: {},
  });
  const pending = [{
    id: "element-deletion",
    kind: "delete-element",
    target: { slideId: "a", elementId: "body/paragraph:1" },
    path: [],
    origin: "authored",
    status: "bento-ahead",
    before: { present: true, value: { id: "body/paragraph:1" } },
    after: { present: false },
  }, {
    id: "slide-deletion",
    kind: "delete-slide",
    target: { slideId: "b" },
    path: [],
    origin: "authored",
    status: "bento-ahead",
    before: { present: true, value: { id: "b" } },
    after: { present: false },
  }];
  const requests: { path: string; body: unknown }[] = [];
  const plan = {
    stateRevision: 1,
    patch: { patches: [] },
    changes: [],
    structure: {
      steps: [{
        operation: {
          type: "delete-block",
          blockId: "body/paragraph:1",
          confirmed: true,
        },
        edits: [{ expected: "::: {#body}\nLiteral.\n:::\n", replacement: "" }],
      }],
    },
    result: "## A {#a}\n",
    annotations: { patches: [], diagnostics: [] },
  };
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
    `${source.replace(/^import [^\n]+\n/gm, "")}\nreturn { showChanges };`,
  );
  const callbacks = run(
    {
      getElementById: node,
      createElement: (tag: string) => new Node(tag),
      createTextNode: (text: string) => {
        const result = new Node("#text");
        result.textContent = text;
        return result;
      },
    },
    (url: string, options?: { body?: string }) => {
      const path = url.slice("/api/".length),
        body = options?.body ? JSON.parse(options.body) : undefined;
      requests.push({ path, body });
      const result = path === "diagnostics"
        ? []
        : path === "state"
        ? { revision: 1, pending }
        : path === "sync/preview"
        ? plan
        : { revision: 2 };
      return Promise.resolve(
        new Response(JSON.stringify(result), {
          headers: { "Content-Type": "application/json" },
        }),
      );
    },
    { qbentoToken: "token", addEventListener() {} },
    () => ({ open() {} }),
    () => ({ save: () => Promise.resolve(), dispose() {}, dirty: false }),
    () => {},
    () => {},
    () => {},
  );
  await node("review").onclick!();
  const boxes = node("delete-confirmations").querySelectorAll("input");
  eq(boxes.length, 2);
  eq(boxes.map((box) => box.dataset.change), [
    "element-deletion",
    "slide-deletion",
  ]);
  ok(
    node("delete-confirmations").textContent.includes(
      "elemento body/paragraph:1 de la diapositiva a",
    ),
  );
  ok(
    node("delete-confirmations").textContent.includes(
      "diapositiva b y su contenido",
    ),
  );
  ok(node("apply").disabled);
  eq(requests.filter((r) => r.path === "sync/preview").length, 0);
  boxes[0].checked = true;
  await boxes[0].onchange!();
  eq(requests.filter((r) => r.path === "sync/preview").length, 0);
  boxes[1].checked = true;
  await boxes[1].onchange!();
  eq(requests.filter((r) => r.path === "sync/preview").at(-1)!.body, {
    confirmedDeleteIds: ["element-deletion", "slide-deletion"],
  });
  ok(!node("apply").disabled);
  ok(
    node("patches").textContent.includes(
      "Eliminar elemento body/paragraph:1 del QMD",
    ),
  );
  boxes[0].checked = false;
  await boxes[0].onchange!();
  await node("apply").onclick!();
  eq(requests.filter((r) => r.path === "sync/apply").length, 0);
  boxes[0].checked = true;
  await boxes[0].onchange!();
  await node("apply").onclick!();
  eq(requests.filter((r) => r.path === "sync/apply").length, 1);
  const container = new Node();
  callbacks.showChanges(container, [{
    change: { ...pending[0], source: { present: true, value: {} } },
    actions: ["keep-source", "keep-bento"],
  }], true);
  ok(
    container.textContent.includes(
      "Restaurar elemento con su texto y diseño pendientes",
    ),
  );
  callbacks.showChanges(container, [{
    change: { ...pending[0], source: { present: false } },
    actions: ["keep-source"],
  }], true);
  ok(!container.textContent.includes("Restaurar elemento"));
  ok(container.textContent.includes("recuperar su fuente desde historial"));
});
