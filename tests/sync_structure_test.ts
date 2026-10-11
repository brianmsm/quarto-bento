import { projectAst } from "../src/render/project.ts";
import { executeQuarto } from "../src/render/quarto.ts";
import {
  applySync,
  prepareApprovedSync,
  previewSync,
  validateSyncApproval,
} from "../src/core/sync.ts";
import {
  readProject,
  renderProject,
  saveProject,
} from "../src/core/project.ts";
import {
  canonical,
  captureEdits,
  compose,
  createState,
  StateStore,
  targetKey,
} from "../src/state/mod.ts";
import type { BentoDoc, BentoSlide } from "../src/state/mod.ts";
import { hashSource, scanSource } from "../src/source/mod.ts";
function assert(ok: unknown, message = "assertion failed"): asserts ok {
  if (!ok) throw new Error(message);
}
function eq(a: unknown, b: unknown) {
  assert(canonical(a) === canonical(b), `${canonical(a)} != ${canonical(b)}`);
}
async function refuses(fn: () => unknown, code: string) {
  try {
    await fn();
  } catch (error) {
    assert(
      (error as { code?: string }).code === code ||
        String(error).includes(code),
      String(error),
    );
    return;
  }
  throw new Error(`Expected ${code}`);
}
async function simple() {
  const directory = await Deno.makeTempDir({
      prefix: "qbento-structural-sync-",
    }),
    source = directory + "/deck.qmd",
    text =
      "## A {#a}\n\n<!-- qb:a-body -->\nOriginal.\n\n## B {#b}\n\nOther.\n";
  await Deno.writeTextFile(source, text);
  const doc: BentoDoc = {
    docId: "test",
    slides: [{
      id: "a",
      notes: "",
      elements: [{ id: "a-title", type: "text", html: "A" }, {
        id: "a-body",
        type: "text",
        html: "Original.",
      }],
    }, {
      id: "b",
      notes: "",
      elements: [{ id: "b-title", type: "text", html: "B" }],
    }],
  };
  const mapping = scanSource(text),
    body = mapping.blocks.find((b) => b.id === "a-body")!;
  const state = createState(doc, {
    [targetKey({ slideId: "a", elementId: "a-body" })]: {
      origin: "authored",
      semanticId: body.id,
      source: {
        hash: mapping.hash,
        blockId: body.id,
        content: body.content,
        kind: body.kind,
        stable: true,
      },
    },
  });
  const store = new StateStore(directory + "/.qbento");
  return { directory, source, text, doc, state, store };
}
Deno.test("combined text/create/order plan rescans source, preserves native IDs, and publishes explicit approval only on apply", async () => {
  const f = await simple();
  try {
    const edited = structuredClone(f.doc);
    edited.slides[0].elements[1].html = "<strong>Approved</strong>.";
    const newSlide: BentoSlide = {
      id: "created",
      notes: "",
      elements: [
        {
          id: "native-title",
          type: "text",
          html: "Created <strong>title</strong>",
          x: 212,
        },
        { id: "native-body", type: "text", html: "New body.", y: 333 },
        { id: "native-arrow", type: "arrow", x: 22 },
      ],
    };
    edited.slides = [newSlide, edited.slides[1], edited.slides[0]];
    const pending = await f.store.save(captureEdits(f.state, edited));
    const plan = await previewSync(f.source);
    eq(plan.creationChangeIds.length, 1);
    assert(plan.structure);
    assert(plan.result.includes('bento-title-id="native-title"'));
    assert(
      plan.result.includes(
        '::: {#created-text-1 bento-element-id="native-body"}',
      ),
    );
    eq(scanSource(plan.result).slides.map((s) => s.id), ["created", "b", "a"]);
    assert(plan.result.includes("**Approved**."));
    eq(await Deno.readTextFile(f.source), f.text);
    await applySync(f.source, plan);
    const approval = JSON.parse(
      await Deno.readTextFile(f.directory + "/.qbento/sync-approved.json"),
    );
    validateSyncApproval(approval);
    eq(approval.approval.creationChangeIds, plan.creationChangeIds);
    eq(approval.approval.sourceHash, hashSource(plan.result));
    eq((await f.store.load())!.pending, pending.pending);
    await refuses(() => previewSync(f.source), "RECOVERY_OR_BUSY");
    const current = (await f.store.load())!;
    await refuses(
      () => prepareApprovedSync(current, f.doc, "other-hash", approval),
      "STALE_APPROVAL",
    );
    const changed = structuredClone(current);
    changed.pending[0].reason = "Independent pending edit";
    await refuses(
      () =>
        prepareApprovedSync(changed, f.doc, hashSource(plan.result), approval),
      "STALE_APPROVAL",
    );
    const corrupted = structuredClone(approval);
    corrupted.approval.creationChangeIds = [];
    await refuses(() => validateSyncApproval(corrupted), "INVALID_APPROVAL");
  } finally {
    await Deno.remove(f.directory, { recursive: true });
  }
});
Deno.test("deletion remains separately confirmed and rejects a computed source producer", async () => {
  const f = await simple();
  try {
    const edited = structuredClone(f.doc);
    edited.slides = edited.slides.filter((s) => s.id !== "b");
    const state = await f.store.save(captureEdits(f.state, edited)),
      deletion = state.pending.find((p) => p.kind === "delete-slide")!;
    await refuses(() => previewSync(f.source), "CONFIRM_DELETE_REQUIRED");
    const plan = await previewSync(f.source, undefined, {
      confirmedDeleteIds: [deletion.id],
    });
    assert(!scanSource(plan.result).slides.some((s) => s.id === "b"));
    await Deno.writeTextFile(f.source, f.text + "\n```{r}\nx=1\n```\n");
    await refuses(
      () =>
        previewSync(f.source, undefined, { confirmedDeleteIds: [deletion.id] }),
      "unsafe-delete",
    );
    await Deno.writeTextFile(f.source, f.text);
    await applySync(f.source, plan);
    const approved = JSON.parse(
      await Deno.readTextFile(f.directory + "/.qbento/sync-approved.json"),
    );
    const generated = structuredClone(f.doc);
    generated.slides = generated.slides.filter((slide) => slide.id !== "b");
    const promoted = prepareApprovedSync(
      (await f.store.load())!,
      generated,
      plan.resultHash,
      approved,
    );
    eq(compose(promoted, generated).state.pending.length, 0);
  } finally {
    await Deno.remove(f.directory, { recursive: true });
  }
});
const canRun =
  (await Deno.permissions.query({ name: "run" })).state === "granted";
Deno.test({
  name:
    "real Quarto execution after approved creation/order/text sync retains native design, decoration and canonical authored content",
  ignore: !canRun,
  fn: async () => {
    const dir = await Deno.makeTempDir({ prefix: "qbento-sync-execution-" });
    try {
      for (const file of ["presentation.qmd", "data.csv"]) {
        await Deno.copyFile(
          new URL("../fixtures/basic/" + file, import.meta.url),
          dir + "/" + file,
        );
      }
      const source = dir + "/presentation.qmd",
        initial = await renderProject(source),
        edited = structuredClone(initial.state.emitted);
      const paragraph = edited.slides[0].elements.find((e) =>
        e.id === "finding/paragraph:1"
      )!;
      paragraph.html = "<strong>Approved authored change</strong>.";
      const title = structuredClone(
        edited.slides[0].elements.find((e) => e.id.endsWith("-title"))!,
      );
      title.id = "created-title";
      title.html = "New <strong>title</strong>";
      title.x = 201;
      title.fontSize = 39;
      const body = structuredClone(paragraph);
      body.id = "created-body";
      body.html = "Body text.";
      body.x = 411;
      body.y = 255;
      const decoration = {
        id: "created-arrow",
        type: "shape",
        shape: "arrow",
        fill: "#156f65",
        x: 77,
        y: 99,
        w: 100,
        h: 33,
      };
      const created = {
        ...edited.slides[1],
        id: "created",
        elements: [title, body, decoration],
      };
      edited.slides = [created, edited.slides[1], edited.slides[0]];
      await saveProject(source, edited, initial.state.revision);
      const plan = await previewSync(source);
      await applySync(source, plan);
      const published = await renderProject(source);
      const merged = {
        state: published.state,
        document: published.state.emitted,
      };
      const reopened = await readProject(source);
      eq(reopened.pending.length, 0);
      await refuses(
        () => Deno.readTextFile(dir + "/.qbento/sync-approved.json"),
        "No such file",
      );
      eq(merged.document.slides.map((s) => s.id), [
        "created",
        edited.slides[1].id,
        edited.slides[2].id,
      ]);
      eq(merged.state.pending.length, 0);
      const actual = merged.document.slides[0];
      eq(actual.elements.map((e) => e.id), [
        "created-title",
        "created-body",
        "created-arrow",
      ]);
      eq(actual.elements[0].html, "New <b>title</b>");
      eq(actual.elements[0].x, 201);
      eq(actual.elements[0].fontSize, 39);
      eq(actual.elements[1].x, 411);
      eq(actual.elements[2], decoration);
      eq(merged.document.docId, initial.state.docId);
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  },
});
Deno.test({
  name:
    "real R as-is headings are refused when Quarto erases origin boundaries",
  ignore: !canRun,
  fn: async () => {
    const { validateProjectionOrigins } = await import(
      "../src/render/project.ts"
    );
    const dir = await Deno.makeTempDir({ prefix: "qbento-asis-guard-" });
    try {
      const source = dir + "/heading.qmd",
        text =
          '---\nformat: html\n---\n\n```{r}\n#| label: producer\n#| results: asis\n#| echo: false\ncat("## Generated {#generated}\\n\\nText.\\n")\n```\n';
      await Deno.writeTextFile(source, text);
      const ast = await executeQuarto(source, dir + "/build"),
        projected = await projectAst(ast, "doc", [dir + "/build", dir]);
      await refuses(
        () => validateProjectionOrigins(scanSource(text), projected),
        "UNMAPPED_PROVENANCE",
      );
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  },
});
Deno.test({
  name:
    "two native template slides retain repeated visual IDs and synchronize their bodies independently",
  ignore: !canRun,
  fn: async () => {
    const dir = await Deno.makeTempDir({ prefix: "qbento-repeated-native-" });
    try {
      const source = dir + "/deck.qmd";
      const original =
        "## Original {#original}\n\n::: {#original-body}\nOriginal body.\n:::\n";
      await Deno.writeTextFile(source, original);
      const initial = await renderProject(source);
      const edited = structuredClone(initial.state.emitted);
      const nativeSlides = ["first", "second"].map((id, index) => ({
        ...edited.slides[0],
        id,
        elements: edited.slides[0].elements.map((e, i) => ({
          ...e,
          id: i === 0 ? "ltc-title" : "ltc-body",
          html: i === 0 ? id : `${id} body.`,
          x: 111 + index * 100,
        })),
      }));
      edited.slides.push(...nativeSlides);
      const saved = await saveProject(source, edited, initial.state.revision);
      eq(saved.pending.filter((p) => p.kind === "create-slide").length, 2);
      const plan = await previewSync(source);
      eq(scanSource(plan.result).diagnostics, []);
      await applySync(source, plan);
      const rendered = await renderProject(source);
      eq(rendered.state.pending.length, 0);
      eq(rendered.state.emitted.slides.slice(1), nativeSlides);
      const next = structuredClone(rendered.state.emitted);
      next.slides[2].elements[1].html = "Only second changes.";
      await saveProject(source, next, rendered.state.revision);
      const second = await previewSync(source);
      eq(second.changes.length, 1);
      eq(second.changes[0].blockId, "second-text-1/paragraph:1");
      assert(second.result.startsWith(original));
      assert(second.result.includes("first body."));
      assert(!second.result.includes("second body."));
      await applySync(source, second);
      const reopened = await renderProject(source);
      eq(reopened.state.pending.length, 0);
      eq(reopened.state.emitted.slides[1], nativeSlides[0]);
      eq(
        reopened.state.emitted.slides[2].elements[1].html,
        "Only second changes.",
      );
      eq(reopened.state.emitted.slides[2].elements[1].x, 211);
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  },
});
