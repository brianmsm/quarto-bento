import { createBentoBridge } from "../src/bridge/browser.js";
function ok(value: unknown, message = "assertion failed"): asserts value {
  if (!value) throw new Error(message);
}
function eq(actual: unknown, expected: unknown) {
  ok(
    JSON.stringify(actual) === JSON.stringify(expected),
    `${JSON.stringify(actual)} != ${JSON.stringify(expected)}`,
  );
}
class Node {
  textContent = "";
  children: Node[] = [];
  disabled = false;
  hidden = false;
  inert = false;
  open = false;
  closeCount = 0;
  src = "";
  onclick?: () => Promise<void> | void;
  private listeners = new Map<string, ((event: Event) => void)[]>();
  append(...children: Node[]) {
    this.children.push(...children);
  }
  replaceChildren(...children: Node[]) {
    this.children = children;
  }
  querySelectorAll() {
    return [];
  }
  focus() {}
  addEventListener(type: string, listener: (event: Event) => void) {
    this.listeners.set(type, [...this.listeners.get(type) ?? [], listener]);
  }
  dispatchEvent(event: Event) {
    for (const listener of this.listeners.get(event.type) ?? []) {
      listener(event);
    }
    return !event.defaultPrevented;
  }
  showModal() {
    this.open = true;
  }
  close() {
    if (!this.open) return;
    this.open = false;
    this.closeCount++;
    this.dispatchEvent(new Event("close"));
  }
  escape() {
    const event = new Event("cancel", { cancelable: true });
    if (this.dispatchEvent(event)) this.close();
    return event.defaultPrevented;
  }
}
async function client() {
  const nodes = new Map<string, Node>();
  const node = (id: string) => {
    if (!nodes.has(id)) nodes.set(id, new Node());
    return nodes.get(id)!;
  };
  const native = {
    doc: {
      docId: "doc",
      format: "bento/slides",
      version: 1,
      slides: [{ id: "slide", elements: [] }],
    },
    selection: [],
    loadDoc() {},
    undo() {},
    redo() {},
  };
  Object.assign(node("editor"), {
    contentWindow: {
      bento: native,
      __qbentoSnapshot: { docId: "doc", revision: 3, pending: 1 },
    },
    contentDocument: {},
  });
  let revision = 3, source = "## Slide\n\nOriginal.\n", sourceWrites = 0;
  let failApply = false, release: (() => void) | undefined;
  const requests: { path: string; body?: { revision?: number } }[] = [];
  const bridges: ReturnType<typeof createBentoBridge>[] = [];
  const shipped = await Deno.readTextFile(
    new URL("../src/studio/client.js", import.meta.url),
  );
  const response = (result: unknown, status = 200) =>
    new Response(JSON.stringify(result), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  const run = new Function(
    "document",
    "fetch",
    "globalThis",
    "createBentoBridge",
    "attachRegistryEditor",
    "attachGraphRelations",
    "attachComponentEditor",
    `${
      shipped.replace(/^import [^\n]+\n/gm, "")
    }\nreturn { prepareSyncPreview };`,
  );
  const callbacks = run(
    { getElementById: node, createElement: () => new Node() },
    (url: string, options?: { body?: string }) => {
      const path = url.slice("/api/".length);
      const body = options?.body ? JSON.parse(options.body) : undefined;
      requests.push({ path, body });
      if (path === "sync/apply") {
        eq(body.stateRevision, revision);
        const failed = failApply;
        if (!failed) {
          source = body.result;
          sourceWrites++;
          revision++;
        }
        const receipt = failed
          ? response(
            { message: "No se pudo aplicar; conserva la revisión." },
            409,
          )
          : response({ revision });
        // The server can commit before the client receives its new revision.
        return new Promise<Response>((resolve) => {
          release = () => {
            release = undefined;
            resolve(receipt);
          };
        });
      }
      if (path === "save") {
        eq(body.revision, revision);
        return Promise.resolve(response({ revision: ++revision }));
      }
      if (path === "state") {
        return Promise.resolve(response({ revision, pending: [] }));
      }
      if (path === "sync/preview") {
        return Promise.resolve(response({
          stateRevision: revision,
          patch: {
            patches: [{
              blockId: "body",
              expected: "Original.",
              replacement: "Editado.",
            }],
          },
          changes: [],
          result: "## Slide\n\nEditado.\n",
        }));
      }
      return Promise.resolve(response(
        path === "render" ? { revision: ++revision, diagnostics: [] } : [],
      ));
    },
    { qbentoToken: "local", addEventListener() {} },
    (...args: Parameters<typeof createBentoBridge>) => {
      const bridge = createBentoBridge(args[0], { ...args[1], pollMs: 0 });
      bridges.push(bridge);
      return bridge;
    },
    () => {},
    () => {},
    () => {},
  );
  return {
    node,
    requests,
    callbacks,
    source: () => source,
    sourceWrites: () => sourceWrites,
    revision: () => revision,
    failApply(value: boolean) {
      failApply = value;
    },
    releaseApply() {
      ok(release, "no Apply request pending");
      release();
    },
    dispose() {
      for (const bridge of bridges) bridge.dispose();
    },
  };
}
Deno.test("Studio serializes delayed Apply against Close, Escape, duplicate Apply, Save and Recalculate until the fresh revision arrives", async () => {
  const c = await client(), dialog = c.node("review-dialog");
  try {
    await c.node("review").onclick!();
    ok(!c.node("apply").disabled);
    eq(c.sourceWrites(), 0);
    c.node("close").onclick!();
    ok(!dialog.open);
    await c.node("review").onclick!();
    eq(dialog.escape(), false);
    ok(!dialog.open);
    await c.node("review").onclick!();
    const applying = c.node("apply").onclick!();
    eq(c.sourceWrites(), 1);
    const count = c.requests.length, closes = dialog.closeCount;
    ok(c.node("close").disabled && c.node("apply").disabled);
    ok(c.node("editor").inert && !c.node("busy").hidden);
    for (const id of ["save", "render", "review"]) ok(c.node(id).disabled);
    await c.node("close").onclick!();
    eq(dialog.escape(), true);
    ok(dialog.open);
    eq(dialog.closeCount, closes);
    for (const id of ["apply", "save", "render", "review"]) {
      await c.node(id).onclick!();
    }
    await c.callbacks.prepareSyncPreview();
    eq(c.requests.length, count);
    eq(c.sourceWrites(), 1);
    const appliedRevision = c.revision();
    c.releaseApply();
    await applying;
    ok(c.node("busy").hidden && !c.node("editor").inert);
    ok(!c.node("close").disabled && c.node("apply").disabled);
    await c.node("close").onclick!();
    ok(!dialog.open);
    await c.node("save").onclick!();
    eq(
      c.requests.filter((r) => r.path === "save").at(-1)?.body?.revision,
      appliedRevision,
    );
    await c.node("render").onclick!();
    eq(c.requests.filter((r) => r.path === "render").length, 1);
    eq(c.requests.filter((r) => r.path === "sync/apply").length, 1);
    eq(c.sourceWrites(), 1);
    eq(c.source(), "## Slide\n\nEditado.\n");
  } finally {
    c.dispose();
  }
});
Deno.test("Studio releases the Apply lock on error and preserves explicit retry and normal cancellation", async () => {
  const c = await client(), dialog = c.node("review-dialog");
  try {
    await c.node("review").onclick!();
    c.failApply(true);
    const applying = c.node("apply").onclick!();
    eq(dialog.escape(), true);
    c.releaseApply();
    await applying;
    eq(c.sourceWrites(), 0);
    eq(c.source(), "## Slide\n\nOriginal.\n");
    ok(c.node("sync-note").textContent.includes("No se pudo aplicar"));
    ok(c.node("busy").hidden && !c.node("editor").inert);
    for (const id of ["apply", "close", "save", "render"]) {
      ok(!c.node(id).disabled);
    }
    ok(dialog.open);
    eq(c.requests.filter((r) => r.path === "sync/apply").length, 1);
    c.failApply(false);
    const retry = c.node("apply").onclick!();
    c.releaseApply();
    await retry;
    eq(c.sourceWrites(), 1);
    eq(c.requests.filter((r) => r.path === "sync/apply").length, 2);
    eq(dialog.escape(), false);
    ok(!dialog.open);
    await c.node("save").onclick!();
  } finally {
    c.dispose();
  }
});
