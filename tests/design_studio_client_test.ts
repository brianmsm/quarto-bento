function assert(value: unknown, message = "assertion failed"): asserts value {
  if (!value) throw new Error(message);
}
function equal(actual: unknown, expected: unknown, message?: string) {
  if (actual !== expected) {
    throw new Error(message ?? `${String(actual)} !== ${String(expected)}`);
  }
}
class Element {
  id = "";
  value = "";
  textContent = "";
  disabled = false;
  files: Array<{ name: string; size: number; text(): Promise<string> }> = [];
  href = "";
  download = "";
  clicked = false;
  parentNode?: Element;
  children: Element[] = [];
  #listeners = new Map<string, (event?: unknown) => unknown>();
  append(...children: Element[]) {
    for (const child of children) {
      child.parentNode = this;
      this.children.push(child);
    }
  }
  replaceChildren(...children: Element[]) {
    this.children = [];
    this.append(...children);
  }
  addEventListener(type: string, listener: (event?: unknown) => unknown) {
    this.#listeners.set(type, listener);
  }
  async emit(type: string) {
    return await this.#listeners.get(type)?.({ target: this });
  }
  click() {
    this.clicked = true;
  }
  remove() {
    if (this.parentNode) {
      this.parentNode.children = this.parentNode.children.filter((node) =>
        node !== this
      );
    }
  }
}
const packageValue = {
  format: "qbento/design",
  version: 1,
  name: "SPP Bifactor",
  registry: {
    schemaVersion: 1,
    layouts: { triad: { columns: 3, gap: 24, padding: 8 } },
    themes: {
      spp: {
        background: "#ffffff",
        color: "#172a35",
        accent: "#156f65",
        fontFamily: "Arial, sans-serif",
        styles: { heading: { color: "#172a35" } },
      },
    },
    activeTheme: "spp",
  },
};
function makePlan(pkg = packageValue, revision = 5) {
  return {
    version: 1,
    docId: "doc-1",
    expectedRevision: revision,
    expectedHash: null,
    sourceHash: "source-hash",
    packageHash: "package-hash",
    package: pkg,
    changes: {
      operation: "replace-registry",
      before: {
        schemaVersion: 1,
        layouts: { old: { columns: 2, gap: 16, padding: 0 } },
        themes: {
          old: {
            background: "#ffffff",
            color: "#111111",
            accent: "#333333",
            fontFamily: "Arial, sans-serif",
          },
        },
        activeTheme: "old",
      },
      after: pkg.registry,
      removed: { layouts: ["old"], themes: ["old"] },
      renderNeeded: true,
    },
  };
}
async function loadClient({
  state = { docId: "doc-1", revision: 4 },
  dirty = false,
  api = () => Promise.resolve({}),
  saveBefore = () => Promise.resolve(),
  reload = () => Promise.resolve(),
}: {
  state?: { docId: string; revision: number };
  dirty?: boolean;
  api?: (path: string, body?: unknown) => Promise<unknown>;
  saveBefore?: () => Promise<void>;
  reload?: () => Promise<void>;
} = {}) {
  const nodes = new Map<string, Element>(), created: Element[] = [];
  const node = (id: string) => {
    if (!nodes.has(id)) {
      const value = new Element();
      value.id = id;
      nodes.set(id, value);
    }
    return nodes.get(id)!;
  };
  const body = new Element(), blobs: Blob[] = [], revoked: string[] = [];
  const document = {
    body,
    getElementById: node,
    createElement() {
      const value = new Element();
      created.push(value);
      return value;
    },
    createTextNode(text: string) {
      const value = new Element();
      value.textContent = text;
      return value;
    },
  };
  const url = {
    createObjectURL(blob: Blob) {
      blobs.push(blob);
      return `blob:${blobs.length}`;
    },
    revokeObjectURL(value: string) {
      revoked.push(value);
    },
  };
  const source = await Deno.readTextFile(
    new URL("../src/studio/designs.js", import.meta.url),
  );
  const run = new Function(
    "document",
    "URL",
    "Blob",
    "setTimeout",
    source.replace(
      "export function attachReusableDesigns",
      "function attachReusableDesigns",
    ) +
      "\nreturn attachReusableDesigns;",
  );
  const attach = run(
    document,
    url,
    Blob,
    (callback: () => void) => {
      callback();
      return 1;
    },
  );
  let saved = 0, errors = 0, reloads = 0;
  const editor = attach({
    api,
    getState: () => state,
    showError: () => errors++,
    saveBefore: async () => {
      saved++;
      await saveBefore();
    },
    registryEditor: {
      isDirty: () => dirty,
      reload: async () => {
        reloads++;
        await reload();
      },
    },
  });
  return {
    body,
    blobs,
    created,
    editor,
    errors: () => errors,
    node,
    reloads: () => reloads,
    revoked,
    saved: () => saved,
    state,
  };
}
function textTree(root: Element): string {
  return root.textContent + root.children.map(textTree).join("");
}
Deno.test("design export saves first, downloads the named JSON package, and does not render", async () => {
  const state = { docId: "doc-1", revision: 4 },
    calls: Array<[string, unknown]> = [],
    c = await loadClient({
      state,
      saveBefore: () => {
        state.revision++;
        return Promise.resolve();
      },
      api: (path, body) => {
        calls.push([path, body]);
        return Promise.resolve(packageValue);
      },
    });
  c.node("design-name").value = "SPP Bifactor";
  await c.node("design-export").emit("click");
  equal(c.saved(), 1);
  equal(calls.length, 1);
  equal(calls[0][0], "design/export");
  equal(JSON.stringify(calls[0][1]), JSON.stringify({ name: "SPP Bifactor" }));
  equal(c.blobs.length, 1);
  const file = await c.blobs[0].text();
  equal(JSON.parse(file).format, "qbento/design");
  equal(JSON.parse(file).name, "SPP Bifactor");
  equal(
    c.created.find((element) => element.download)?.download,
    "SPP-Bifactor.qbento-design.json",
  );
  equal(c.revoked[0], "blob:1");
  equal(calls.some(([path]) => path === "render"), false);
});
Deno.test("import preview shows the full replacement and deleted definitions before explicit apply", async () => {
  const calls: Array<[string, unknown]> = [],
    plan = makePlan(),
    c = await loadClient({
      state: { docId: "doc-1", revision: 5 },
      api: (path, body) => {
        calls.push([path, body]);
        if (path === "design/preview") return Promise.resolve(plan);
        return Promise.resolve({
          docId: "doc-1",
          revision: 5,
          registry: packageValue.registry,
          renderNeeded: true,
        });
      },
    });
  c.editor.offerPackage(
    packageValue,
    "Reveal styles were mapped to Bento fields.",
  );
  assert(c.node("design-apply").disabled, "apply was enabled without preview");
  await c.node("design-preview").emit("click");
  equal(c.saved(), 1);
  equal(calls[0][0], "design/preview");
  equal(JSON.stringify(calls[0][1]), JSON.stringify({ package: packageValue }));
  assert(
    !c.node("design-apply").disabled,
    "apply was not enabled after preview",
  );
  const visible = textTree(c.node("design-plan"));
  assert(visible.includes("registro completo"));
  assert(visible.includes("styles"));
  assert(visible.includes('"triad"'));
  assert(visible.includes('"old"'));
  assert(visible.includes("Definiciones que se eliminarán"));
  assert(visible.includes("Recalcular"));
  equal(calls.some(([path]) => path === "design/apply"), false);
  await c.node("design-apply").emit("click");
  equal(c.saved(), 2);
  equal(calls[1][0], "design/apply");
  equal(JSON.stringify(calls[1][1]), JSON.stringify({ plan }));
  equal(c.reloads(), 1);
  equal(c.node("design-apply").disabled, true);
  assert(c.node("design-note").textContent.includes("Pulsa Recalcular"));
  equal(calls.some(([path]) => path === "render"), false);
});
Deno.test("design package actions refuse dirty registry drafts and preserve them", async () => {
  let calls = 0, saved = 0;
  const c = await loadClient({
    dirty: true,
    api: () => Promise.resolve(calls++),
    saveBefore: () => {
      saved++;
      return Promise.resolve();
    },
  });
  c.node("design-name").value = "SPP";
  await c.node("design-export").emit("click");
  c.editor.offerPackage(packageValue);
  await c.node("design-preview").emit("click");
  equal(saved, 0);
  equal(calls, 0);
  assert(c.node("design-note").textContent.includes("Guarda o descarta"));
  equal(c.errors(), 2);
});
Deno.test("stale import preview is refused after native edits advance the saved revision", async () => {
  const state = { docId: "doc-1", revision: 5 },
    calls: string[] = [],
    c = await loadClient({
      state,
      api: (path) => {
        calls.push(path);
        return Promise.resolve(
          path === "design/preview" ? makePlan() : {
            docId: "doc-1",
            revision: state.revision,
            registry: packageValue.registry,
          },
        );
      },
    });
  c.editor.offerPackage(packageValue);
  await c.node("design-preview").emit("click");
  state.revision++;
  await c.node("design-apply").emit("click");
  equal(calls.filter((path) => path === "design/apply").length, 0);
  assert(c.node("design-note").textContent.includes("Vuelve a revisar"));
  assert(c.node("design-apply").disabled);
});
Deno.test("file selection rejects oversized packages and ignores a stale asynchronous read", async () => {
  let resolveFirst!: (value: string) => void;
  const first = {
      name: "first.json",
      size: 20,
      text: () => new Promise<string>((resolve) => resolveFirst = resolve),
    },
    second = {
      name: "second.json",
      size: 20,
      text: () => Promise.resolve(JSON.stringify(packageValue)),
    },
    large = {
      name: "large.json",
      size: 262145,
      text: () => Promise.resolve("{}"),
    },
    c = await loadClient();
  const input = c.node("design-file");
  input.files = [first];
  const pending = input.emit("change");
  input.files = [second];
  await input.emit("change");
  resolveFirst(JSON.stringify({ name: "stale package" }));
  await pending;
  assert(textTree(c.node("design-plan")).includes("SPP Bifactor"));
  assert(!textTree(c.node("design-plan")).includes("stale package"));
  input.files = [large];
  await input.emit("change");
  assert(c.node("design-note").textContent.includes("256 KiB"));
  assert(c.node("design-preview").disabled);
});
