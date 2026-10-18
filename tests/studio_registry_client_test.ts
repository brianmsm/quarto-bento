function assert(value: unknown, message = "assertion failed"): asserts value {
  if (!value) throw new Error(message);
}
function equal(actual: unknown, expected: unknown) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `${JSON.stringify(actual)} !== ${JSON.stringify(expected)}`,
    );
  }
}
class Element {
  id = "";
  tagName: string;
  value = "";
  fields: Record<string, Element> = {};
  textContent = "";
  disabled = false;
  children: Element[] = [];
  parentNode?: Element;
  onclick?: () => unknown;
  oninput?: () => unknown;
  onchange?: () => unknown;
  onsubmit?: (event: { preventDefault(): void }) => unknown;
  #listeners = new Map<
    string,
    (event: { preventDefault(): void }) => unknown
  >();
  constructor(tagName = "div") {
    this.tagName = tagName.toLowerCase();
  }
  append(...nodes: Element[]) {
    for (const node of nodes) {
      node.parentNode = this;
      this.children.push(node);
    }
  }
  replaceChildren(...nodes: Element[]) {
    this.children = [];
    this.append(...nodes);
  }
  add(node: Element) {
    this.append(node);
  }
  addEventListener(
    type: string,
    listener: (event: { preventDefault(): void }) => unknown,
  ) {
    this.#listeners.set(type, listener);
  }
  async emit(type: string) {
    return await this.#listeners.get(type)?.({ preventDefault() {} });
  }
  showModal() {}
  close() {}
  setAttribute() {}
  querySelectorAll(selector: string): Element[] {
    const tags = selector.split(",").map((part) => part.trim());
    return this.children.flatMap((child) => [
      ...(tags.includes(child.tagName) ? [child] : []),
      ...child.querySelectorAll(selector),
    ]);
  }
}
const theme = {
  background: "#ffffff",
  color: "#172a35",
  accent: "#156f65",
  fontFamily: "Arial, sans-serif",
  styles: { title: { fontSize: 42, color: "#172a35" } },
  namedStyles: { title: "title" },
  variants: {
    light: { background: "#ffffff" },
    dark: { background: "#111111" },
  },
  defaultVariant: "light",
};
async function loadEditor() {
  const nodes = new Map<string, Element>();
  const node = (id: string) => {
    if (!nodes.has(id)) {
      const value = new Element();
      value.id = id;
      nodes.set(id, value);
    }
    return nodes.get(id)!;
  };
  const form = node("registry-form");
  for (
    const id of [
      "designs",
      "registry-note",
      "registry-layouts",
      "registry-themes",
      "registry-active",
      "registry-dialog",
      "registry-add-layout",
      "registry-add-theme",
      "registry-reload",
      "registry-close",
    ]
  ) form.append(node(id));
  const initial = {
    docId: "doc-1",
    revision: 3,
    hash: "registry-hash",
    registry: {
      schemaVersion: 1,
      themes: { spp: structuredClone(theme) },
      activeTheme: "spp",
    },
  };
  const calls: Array<[string, unknown]> = [], errors: string[] = [];
  const document = {
    getElementById: node,
    createElement: (tag: string) => new Element(tag),
    createTextNode: (text: string) => {
      const result = new Element("#text");
      result.textContent = text;
      return result;
    },
  };
  const source = await Deno.readTextFile(
    new URL("../src/studio/registry.js", import.meta.url),
  );
  const code = source.replace(
    "export function attachRegistryEditor",
    "function attachRegistryEditor",
  );
  const run = new Function(
    "document",
    "Option",
    "addEventListener",
    "api",
    "getState",
    "showError",
    `${code}\nreturn attachRegistryEditor;`,
  );
  const api = (path: string, body?: unknown) => {
    calls.push([path, body]);
    if (body === undefined) return Promise.resolve(initial);
    return Promise.resolve({
      ...initial,
      hash: "saved-registry-hash",
      registry: (body as { registry: unknown }).registry,
    });
  };
  const getState = () => ({ docId: "doc-1", revision: 3 }),
    showError = (error: Error) => errors.push(error.message);
  const attach = run(
    document,
    class Option extends Element {
      constructor(label: string, value: string) {
        super("option");
        this.textContent = label;
        this.value = value;
      }
    },
    () => {},
    api,
    getState,
    showError,
  );
  const editor = attach({ api, getState, showError });
  await node("designs").onclick?.();
  return { calls, editor, errors, node };
}
Deno.test("registry form editing a base color preserves every advanced theme property", async () => {
  const c = await loadEditor(), row = c.node("registry-themes").children[0];
  assert(row.fields, "theme controls were not built");
  equal(row.fields.styles.value, JSON.stringify(theme.styles, null, 2));
  equal(
    row.fields.namedStyles.value,
    JSON.stringify(theme.namedStyles, null, 2),
  );
  equal(row.fields.variants.value, JSON.stringify(theme.variants, null, 2));
  equal(row.fields.defaultVariant.value, "light");

  row.fields.background.value = "#fafafa";
  row.fields.background.oninput?.();
  await c.node("registry-form").onsubmit?.({ preventDefault() {} });
  const saved = c.calls.find(([path, body]) =>
    path === "design-registry" && body !== undefined
  )?.[1] as { registry: { themes: Record<string, Record<string, unknown>> } };
  const updated = saved.registry.themes.spp;
  equal(updated.background, "#fafafa");
  equal(updated.styles, theme.styles);
  equal(updated.namedStyles, theme.namedStyles);
  equal(updated.variants, theme.variants);
  equal(updated.defaultVariant, theme.defaultVariant);
  equal(c.editor.isDirty(), false);
});
Deno.test("invalid advanced JSON refuses save and guarded reload retains the form draft", async () => {
  const c = await loadEditor(), row = c.node("registry-themes").children[0];
  row.fields.variants.value = "{broken";
  row.fields.variants.oninput?.();
  await c.node("registry-form").onsubmit?.({ preventDefault() {} });
  equal(
    c.calls.filter(([path, body]) =>
      path === "design-registry" && body !== undefined
    ).length,
    0,
  );
  equal(row.fields.variants.value, "{broken");
  equal(c.editor.isDirty(), true);
  assert(c.node("registry-note").textContent.includes("JSON válido"));
  try {
    await c.editor.reload();
  } catch (error) {
    assert(String(error).includes("Guarda o descarta el borrador"));
    return;
  }
  throw new Error("reload unexpectedly discarded a dirty draft");
});
