import { createBentoBridge } from "../src/bridge/browser.js";
import {
  ISOLATION_BOOTSTRAP,
  OFFLINE_CSP,
  prepareIsolatedDocument,
} from "../src/bridge/isolation.ts";
function assert(value: unknown, message = "assertion failed"): asserts value {
  if (!value) throw new Error(message);
}
function equal(a: unknown, b: unknown) {
  assert(
    JSON.stringify(a) === JSON.stringify(b),
    `${JSON.stringify(a)} != ${JSON.stringify(b)}`,
  );
}
function throws(fn: () => unknown, code: string) {
  try {
    fn();
  } catch (e) {
    assert(String(e).includes(code));
    return;
  }
  throw new Error("did not throw");
}
const initial = () => ({
  format: "bento/slides",
  version: 1,
  docId: "stable",
  slides: [{ id: "s1", elements: [] }, { id: "s2", elements: [] }],
  title: "Original",
});
function fixture() {
  let doc = initial();
  let selection: string[] = [];
  const history: typeof doc[] = [], future: typeof doc[] = [];
  const api = {
    get doc() {
      return doc;
    },
    get selection() {
      return selection;
    },
    loadDoc(json: string) {
      history.push(structuredClone(doc));
      doc = JSON.parse(json);
      return {
        ok: true,
        dropped: [] as Array<{ path: string; reason: string }>,
      };
    },
    undo() {
      if (history.length) {
        future.push(doc);
        doc = history.pop()!;
      }
    },
    redo() {
      if (future.length) {
        history.push(doc);
        doc = future.pop()!;
      }
    },
  };
  return {
    api,
    select: (ids: string[]) => {
      selection = ids;
    },
  };
}
Deno.test("observes in-place native edits, selection, reorder, undo and redo without mutating snapshots", () => {
  const { api, select } = fixture();
  const events: Array<{ type: string }> = [];
  const b = createBentoBridge(api, {
    docId: "stable",
    persist: async () => {},
    onEvent: (e) => events.push(e),
    pollMs: 0,
  });
  api.doc.title = "Native edit";
  select(["element"]);
  b.poll();
  assert(b.dirty);
  equal(events.map((e) => e.type), ["document", "selection"]);
  const next = b.snapshot().doc;
  next.slides.reverse();
  b.load(next);
  assert(events.some((e) => e.type === "slides"));
  equal(api.doc.slides.map((s) => s.id), ["s2", "s1"]);
  b.undo();
  equal(api.doc.slides.map((s) => s.id), ["s1", "s2"]);
  b.redo();
  equal(api.doc.slides.map((s) => s.id), ["s2", "s1"]);
  next.title = "mutated externally";
  assert(api.doc.title === "Native edit");
  b.dispose();
});
Deno.test("save queue preserves order and never marks an edit during an in-flight save clean", async () => {
  const { api } = fixture();
  const writes: string[] = [];
  let release!: () => void;
  const first = new Promise<void>((r) => release = r);
  let n = 0;
  const b = createBentoBridge(api, {
    docId: "stable",
    pollMs: 0,
    persist: async ({ doc }) => {
      if (++n === 1) await first;
      writes.push(doc.title);
    },
  });
  api.doc.title = "A";
  const a = b.save();
  await Promise.resolve();
  api.doc.title = "B";
  release();
  await a;
  assert(b.dirty);
  await b.save();
  assert(!b.dirty);
  equal(writes, ["A", "B"]);
  b.dispose();
});
Deno.test("failed durable persistence stays dirty and next save can retry", async () => {
  const { api } = fixture();
  let fail = true;
  const b = createBentoBridge(api, {
    docId: "stable",
    pollMs: 0,
    persist: () =>
      fail ? Promise.reject(new Error("disk full")) : Promise.resolve(),
  });
  api.doc.title = "pending";
  await b.save().then(() => {
    throw new Error("unexpected success");
  }, () => {});
  assert(b.dirty);
  fail = false;
  await b.save();
  assert(!b.dirty);
  b.dispose();
});
Deno.test("identity/collaboration/load failures refuse without replacing project document", () => {
  const { api } = fixture();
  const b = createBentoBridge(api, {
    docId: "stable",
    pollMs: 0,
    persist: async () => {},
  });
  throws(
    () => b.load({ ...initial(), docId: "foreign" }),
    "BENTO_IDENTITY_CHANGED",
  );
  throws(() => b.load({ ...initial(), collab: {} }), "BENTO_COLLAB_DISABLED");
  equal(api.doc, initial());
  b.dispose();
  throws(() => b.poll(), "BENTO_BRIDGE_DISPOSED");
});
Deno.test("lossy upstream restore is reported and rolled back rather than silently dropping fields", () => {
  const { api } = fixture();
  const load = api.loadDoc;
  api.loadDoc = (j) => {
    const report = load(j);
    return { ...report, dropped: [{ path: "theme.bad", reason: "unknown" }] };
  };
  const b = createBentoBridge(api, {
    docId: "stable",
    pollMs: 0,
    persist: async () => {},
  });
  throws(
    () => b.load({ ...initial(), title: "unsupported" }),
    "BENTO_LOAD_LOSSY",
  );
  equal(api.doc, initial());
  b.dispose();
});
Deno.test("isolation bootstrap disables only capabilities in the supplied realm", () => {
  const fake: Record<string, unknown> = {};
  const doc = {
    documentElement: {},
    querySelectorAll: () => [],
    addEventListener: () => {},
  };
  const observer = class {
    observe() {}
  };
  new Function(
    "globalThis",
    "document",
    "MutationObserver",
    ISOLATION_BOOTSTRAP,
  )(fake, doc, observer);
  assert(fake.indexedDB === undefined);
  assert(fake.__qbentoIsolatedHost === "qbento-isolated-host-v1");
  throws(
    () => new (fake.WebSocket as typeof WebSocket)("wss://example.com"),
    "QBENTO_COLLAB_DISABLED",
  );
  const Channel = fake.BroadcastChannel as typeof BroadcastChannel;
  const channel = new Channel("bento-sync-stable");
  channel.postMessage({ data: "private" });
  channel.close();
  assert(OFFLINE_CSP.includes("frame-src 'none'"));
  assert(!OFFLINE_CSP.includes("https:"));
});

Deno.test("off sentinel is credential-free and never silently strips a real collaborative document", () => {
  const input = initial();
  const prepared = prepareIsolatedDocument(input);
  equal(prepared.collab, { room: "", key: "", on: false });
  assert(!("collab" in input));
  throws(
    () =>
      prepareIsolatedDocument({
        ...input,
        collab: { room: "wss://example.test", key: "secret", on: false },
      }),
    "BENTO_COLLAB_DISABLED",
  );
  const { api } = fixture();
  api.loadDoc(JSON.stringify(prepared));
  const bridge = createBentoBridge(api, {
    docId: "stable",
    pollMs: 0,
    persist: async () => {},
  });
  equal((bridge.snapshot().doc as typeof prepared).collab, prepared.collab);
  bridge.dispose();
});
