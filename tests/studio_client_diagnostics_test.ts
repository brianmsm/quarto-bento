function assert(value: unknown, message = "assertion failed"): asserts value {
  if (!value) throw new Error(message);
}
type Diagnostic = { code: string; message: string; elementId?: string };
class Node {
  textContent = "";
  children: Node[] = [];
  hidden = false;
  disabled = false;
  inert = false;
  src = "";
  onclick?: () => Promise<void>;
  replaceChildren(...children: Node[]) {
    this.children = children;
  }
  append(child: Node) {
    this.children.push(child);
  }
  addEventListener() {}
  focus() {}
}
async function client() {
  const nodes = new Map<string, Node>();
  const node = (id: string) => {
    if (!nodes.has(id)) nodes.set(id, new Node());
    return nodes.get(id)!;
  };
  const editor = Object.assign(node("editor"), {
    contentWindow: {
      bento: {},
      __qbentoSnapshot: { docId: "doc", revision: 1, pending: 0 },
    },
    contentDocument: {},
  });
  let design: Diagnostic[] = [], render: Diagnostic[] = [], revision = 1;
  const source = await Deno.readTextFile(
    new URL("../src/studio/client.js", import.meta.url),
  );
  // Execute the complete shipped client with local DOM/transport/bridge doubles.
  // Imports are injected; diagnostic and lifecycle code stays unchanged.
  const code = source.replace(/^import [^\n]+\n/gm, "");
  const run = new Function(
    "document",
    "fetch",
    "globalThis",
    "createBentoBridge",
    "attachRegistryEditor",
    `${code}\nreturn { connect, refreshDiagnostics };`,
  );
  const callbacks = run(
    { getElementById: node, createElement: () => new Node() },
    (url: string) => {
      const result = url === "/api/diagnostics" ? design : {
        revision: ++revision,
        pending: 0,
        diagnostics: render,
      };
      return Promise.resolve(
        new Response(JSON.stringify(result), {
          headers: { "Content-Type": "application/json" },
        }),
      );
    },
    { qbentoToken: "local", addEventListener() {} },
    () => ({ save: async () => {}, dispose() {}, dirty: false }),
    () => {},
  );
  await callbacks.refreshDiagnostics();
  const codes = () =>
    node("diagnostic-list").children.map((n) =>
      n.textContent.split(/[·:]/)[0].trim()
    );
  return {
    codes,
    texts: () => node("diagnostic-list").children.map((n) => n.textContent),
    editor,
    refresh: callbacks.refreshDiagnostics,
    connect: callbacks.connect,
    setDesign(value: Diagnostic[]) {
      design = value;
    },
    async recalc(value: Diagnostic[]) {
      render = value;
      await node("render").onclick!();
      editor.contentWindow = {
        bento: {},
        __qbentoSnapshot: { docId: "doc", revision, pending: 0 },
      };
      callbacks.connect();
      await callbacks.refreshDiagnostics();
    },
  };
}
Deno.test("Studio retains render OVERFLOW after reconnect and design refresh, then replaces it on corrected render", async () => {
  const c = await client();
  const overflow = {
    code: "OVERFLOW",
    message: "Element exceeds slide slide",
    elementId: "paragraph-6/paragraph:1",
  };
  const missing = {
    code: "MISSING_DESIGN",
    message: "Restore .qbento from Git",
  };
  c.setDesign([missing]);
  await c.recalc([overflow, missing]);
  assert(c.codes().includes("OVERFLOW"), JSON.stringify(c.codes()));
  assert(c.texts().some((text) => text.includes("paragraph-6/paragraph:1")));
  assert(c.codes().filter((v) => v === "MISSING_DESIGN").length === 1);
  c.setDesign([]);
  await c.refresh();
  assert(c.codes().join() === "OVERFLOW", JSON.stringify(c.codes()));
  await c.recalc([]);
  assert(c.codes().length === 0, JSON.stringify(c.codes()));
});
Deno.test("Studio drops previous render warnings on an unrelated native snapshot, without claiming reopen persistence", async () => {
  const c = await client();
  await c.recalc([{
    code: "OVERFLOW",
    message: "Element exceeds slide slide",
  }]);
  c.editor.contentWindow = {
    bento: {},
    __qbentoSnapshot: { docId: "other-doc", revision: 30, pending: 0 },
  };
  c.connect();
  await c.refresh();
  assert(c.codes().length === 0, JSON.stringify(c.codes()));
});
