import {
  applySync,
  previewSelectedSync,
  previewSync,
  readSyncSelectionFile,
  type SyncSelection,
} from "../src/core/sync.ts";
import {
  canonical,
  captureEdits,
  compose,
  createState,
  StateStore,
  targetKey,
} from "../src/state/mod.ts";
import type { BentoDoc } from "../src/state/mod.ts";
import { scanSource } from "../src/source/mod.ts";
import {
  readProject,
  renderProject,
  saveProject,
} from "../src/core/project.ts";

function eq(actual: unknown, expected: unknown) {
  if (canonical(actual) !== canonical(expected)) {
    throw new Error(`${canonical(actual)} != ${canonical(expected)}`);
  }
}
async function refuses(fn: () => unknown, code: string) {
  try {
    await fn();
  } catch (error) {
    if ((error as { code?: string }).code === code) return;
    throw error;
  }
  throw new Error(`Expected ${code}`);
}
async function fixture(deleting = false) {
  const directory = await Deno.makeTempDir({ prefix: "qbento-selection-" });
  const source = `${directory}/deck.qmd`, stateDir = `${directory}/.qbento`;
  const text =
    "## A {#a}\n\n<!-- qb:body -->\nOriginal.\n\n## B {#b}\n\nOther.\n";
  await Deno.writeTextFile(source, text);
  const doc: BentoDoc = {
    docId: "selection-doc",
    slides: [{
      id: "a",
      notes: "",
      elements: [{ id: "body", type: "text", html: "Original." }],
    }, { id: "b", notes: "", elements: [] }],
  };
  const mapping = scanSource(text),
    body = mapping.blocks.find((b) => b.id === "body")!;
  const initial = createState(doc, {
    [targetKey({ slideId: "a", elementId: "body" })]: {
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
  const edited = structuredClone(doc);
  edited.slides[0].elements[0].html = "Selected edit.";
  if (deleting) edited.slides.pop();
  const store = new StateStore(stateDir);
  const state = await store.save(captureEdits(initial, edited));
  await Deno.writeTextFile(
    `${stateDir}/project.json`,
    JSON.stringify({ version: 1, source: "deck.qmd" }),
  );
  const request: SyncSelection = {
    version: 1,
    docId: state.docId,
    expectedRevision: state.revision,
    selectedChangeIds: [state.pending.find((p) => p.kind === "field")!.id],
  };
  return {
    directory,
    source,
    stateDir,
    text,
    doc,
    edited,
    state,
    store,
    request,
  };
}

Deno.test("selected sync excludes unsupported pending edits, is read-only and preserves exclusions through apply and recomposition", async () => {
  const f = await fixture();
  try {
    f.state.pending.push({
      id: "unsupported-edit",
      target: { slideId: "a", elementId: "body" },
      path: ["notes"],
      kind: "field",
      origin: "authored",
      status: "bento-ahead",
      before: { present: true, value: ["a"] },
      after: { present: true, value: ["b", "a"] },
    });
    const state = await f.store.save(f.state);
    f.request.expectedRevision = state.revision;
    await refuses(() => previewSync(f.source), "UNSUPPORTED_SYNC");
    const before = await Deno.readTextFile(f.store.path);
    const filesBefore = (await Array.fromAsync(Deno.readDir(f.stateDir))).map((
      e,
    ) => e.name).sort();
    const plan = await previewSelectedSync(f.source, f.request);
    eq(plan.selectedChangeIds, f.request.selectedChangeIds);
    eq(plan.excludedChangeIds, ["unsupported-edit"]);
    eq(await Deno.readTextFile(f.store.path), before);
    eq(await Deno.readTextFile(f.source), f.text);
    eq(
      (await Array.fromAsync(Deno.readDir(f.stateDir))).map((e) => e.name)
        .sort(),
      filesBefore,
    );
    await applySync(f.source, plan);
    eq(
      await Deno.readTextFile(f.source),
      f.text.replace("Original.", "Selected edit."),
    );
    const after = (await f.store.load())!;
    eq(after.pending, state.pending);
    const generated = structuredClone(f.doc);
    generated.slides[0].elements[0].html = "Selected edit.";
    eq(
      compose(after, generated, undefined, undefined, { strict: false }).state
        .pending.map(
          (p) => p.id,
        ),
      [
        "unsupported-edit",
      ],
    );
  } finally {
    await Deno.remove(f.directory, { recursive: true });
  }
});

Deno.test("selection binds document and revision and refuses malformed, duplicate and unknown identifiers", async () => {
  const f = await fixture();
  try {
    await refuses(
      () => previewSelectedSync(f.source, { ...f.request, docId: "other" }),
      "UNRELATED_DOCUMENT",
    );
    await refuses(
      () =>
        previewSelectedSync(f.source, {
          ...f.request,
          expectedRevision: f.request.expectedRevision + 1,
        }),
      "STALE_REVISION",
    );
    for (
      const request of [
        null,
        [],
        { ...f.request, version: 2 },
        { ...f.request, expectedRevision: -1 },
        { ...f.request, unexpected: true },
        { ...f.request, selectedChangeIds: ["missing"] },
        {
          ...f.request,
          selectedChangeIds: [
            ...f.request.selectedChangeIds,
            ...f.request.selectedChangeIds,
          ],
        },
        { ...f.request, confirmedDeleteIds: ["missing"] },
        { ...f.request, selectedChangeIds: [" "] },
        { ...f.request, selectedChangeIds: [1] },
      ]
    ) {
      await refuses(
        () => previewSelectedSync(f.source, request),
        "INVALID_SELECTION",
      );
    }
    const plan = await previewSelectedSync(f.source, f.request);
    await f.store.save(f.state);
    await refuses(
      () => previewSelectedSync(f.source, f.request),
      "STALE_REVISION",
    );
    await refuses(() => applySync(f.source, plan), "STALE_REVISION");
    eq(await Deno.readTextFile(f.source), f.text);
  } finally {
    await Deno.remove(f.directory, { recursive: true });
  }
});

Deno.test("empty selection excludes all pending edits and deletion requires a separate selected confirmation", async () => {
  const f = await fixture(true);
  try {
    await refuses(() =>
      previewSelectedSync(f.source, {
        ...f.request,
        selectedChangeIds: [],
      }), "NO_PENDING_CHANGES");
    const deletion = f.state.pending.find((p) => p.kind === "delete-slide")!;
    const selected = { ...f.request, selectedChangeIds: [deletion.id] };
    await refuses(
      () => previewSelectedSync(f.source, selected),
      "CONFIRM_DELETE_REQUIRED",
    );
    await refuses(
      () =>
        previewSelectedSync(f.source, {
          ...f.request,
          confirmedDeleteIds: [deletion.id],
        }),
      "INVALID_SELECTION",
    );
    const plan = await previewSelectedSync(f.source, {
      ...selected,
      confirmedDeleteIds: [deletion.id],
    });
    eq(scanSource(plan.result).slides.map((s) => s.id), ["a"]);
    eq(
      plan.excludedChangeIds,
      f.state.pending.filter((p) => p.id !== deletion.id).map((p) => p.id),
    );
    await applySync(f.source, plan);
    eq((await Deno.readTextFile(f.source)).includes("Original."), true);
  } finally {
    await Deno.remove(f.directory, { recursive: true });
  }
});

Deno.test("selection file reader bounds allocation and refuses links, invalid JSON and invalid UTF-8", async () => {
  const f = await fixture();
  try {
    const path = `${f.directory}/selection.json`;
    await Deno.writeTextFile(path, JSON.stringify(f.request));
    eq(await readSyncSelectionFile(path), f.request);
    await Deno.symlink(path, `${path}.link`);
    await refuses(
      () => readSyncSelectionFile(`${path}.link`),
      "SYNC_INPUT_FILE",
    );
    await refuses(() => readSyncSelectionFile(f.directory), "SYNC_INPUT_FILE");
    await Deno.writeTextFile(path, "{");
    await refuses(() => readSyncSelectionFile(path), "SYNC_INVALID_JSON");
    await Deno.writeFile(path, new Uint8Array([0xff]));
    await refuses(() => readSyncSelectionFile(path), "SYNC_INVALID_JSON");
    await Deno.writeFile(path, new Uint8Array(1024 * 1024 + 1));
    await refuses(() => readSyncSelectionFile(path), "SYNC_INPUT_TOO_LARGE");
  } finally {
    await Deno.remove(f.directory, { recursive: true });
  }
});

Deno.test("legacy and selected previews fail closed and remain read-only when saved state loses its source binding", async () => {
  const f = await fixture();
  try {
    await Deno.remove(`${f.stateDir}/project.json`);
    const before = await Deno.readTextFile(f.store.path);
    const names = (await Array.fromAsync(Deno.readDir(f.stateDir))).map((
      entry,
    ) => entry.name).sort();
    await refuses(() => previewSync(f.source), "PROJECT_BINDING_MISSING");
    await refuses(
      () => previewSelectedSync(f.source, f.request),
      "PROJECT_BINDING_MISSING",
    );
    eq(await Deno.readTextFile(f.source), f.text);
    eq(await Deno.readTextFile(f.store.path), before);
    eq(
      (await Array.fromAsync(Deno.readDir(f.stateDir))).map((entry) =>
        entry.name
      ).sort(),
      names,
    );
  } finally {
    await Deno.remove(f.directory, { recursive: true });
  }
});

Deno.test("CLI selective preview accepts the envelope and refuses extra sync arguments before writing", async () => {
  const f = await fixture();
  try {
    const cli = new URL("../src/cli.ts", import.meta.url).pathname;
    const selection = `${f.directory}/selection.json`,
      planPath = `${f.directory}/plan.json`;
    await Deno.writeTextFile(selection, JSON.stringify(f.request));
    const run = (args: string[]) =>
      new Deno.Command(Deno.execPath(), {
        args: [
          "run",
          "--no-config",
          "--no-remote",
          "--no-npm",
          "--allow-read",
          "--allow-write",
          "--allow-run",
          "--allow-env",
          cli,
          "sync",
          f.source,
          ...args,
        ],
        stdout: "piped",
        stderr: "piped",
      }).output();
    const result = await run(["--select", selection]);
    eq(new TextDecoder().decode(result.stderr), "");
    eq(result.success, true);
    const plan = JSON.parse(new TextDecoder().decode(result.stdout));
    eq(plan.selectedChangeIds, f.request.selectedChangeIds);
    await Deno.writeTextFile(planPath, JSON.stringify(plan));
    for (
      const args of [
        ["--select"],
        ["--apply"],
        ["--select", selection, "extra"],
        ["--apply", planPath, "extra"],
        ["--select", selection, "--apply", planPath],
      ]
    ) {
      eq((await run(args)).success, false);
    }
    eq(await Deno.readTextFile(f.source), f.text);
    eq((await f.store.load())!.revision, f.request.expectedRevision);
  } finally {
    await Deno.remove(f.directory, { recursive: true });
  }
});

Deno.test("selective slide and element deletion require all affected pending edits and preserve unrelated content through real execution", async () => {
  for (const kind of ["delete-slide", "delete-element"] as const) {
    const directory = await Deno.makeTempDir({
      prefix: "qbento-selected-delete-",
    });
    const source = `${directory}/deck.qmd`;
    const text =
      "---\ntitle: Selected deletion\nformat: html\n---\n\n## A {#a}\n\n::: {#body}\nOriginal A.\n:::\n\n::: {#keep}\nKeep A.\n:::\n\n## B {#b}\n\n::: {#other}\nOriginal B.\n:::\n";
    try {
      await Deno.writeTextFile(source, text);
      const initial = (await renderProject(source)).state;
      const edited = structuredClone(initial.emitted);
      edited.slides[0].elements.find((e) => e.id === "body/paragraph:1")!.html =
        "Review before deleting A.";
      edited.slides[1].elements.find((e) => e.id === "other/paragraph:1")!
        .html = "Excluded B edit must survive.";
      let state = await saveProject(source, edited, initial.revision);
      const removed = structuredClone(state.emitted);
      if (kind === "delete-slide") removed.slides.shift();
      else {removed.slides[0].elements = removed.slides[0].elements.filter((
          e,
        ) => e.id !== "body/paragraph:1"
        );}
      state = await saveProject(source, removed, state.revision);
      const deletion = state.pending.find((p) => p.kind === kind)!;
      const affected = state.pending.filter((p) =>
        p.id !== deletion.id && p.target.slideId === "a" &&
        (kind === "delete-slide" || p.target.elementId === "body/paragraph:1")
      );
      const unrelated = state.pending.find((p) =>
        p.target.slideId === "b" && p.kind === "field"
      )!;
      const request: SyncSelection = {
        version: 1,
        docId: state.docId,
        expectedRevision: state.revision,
        selectedChangeIds: [deletion.id],
        confirmedDeleteIds: [deletion.id],
      };
      await refuses(
        () => previewSelectedSync(source, request),
        "PARTIAL_DELETE_SELECTION",
      );
      eq(canonical(await readProject(source)), canonical(state));
      eq(await Deno.readTextFile(source), text);
      const legacy = await previewSync(source, undefined, {
        confirmedDeleteIds: [deletion.id],
      });
      eq(legacy.excludedChangeIds, []);
      request.selectedChangeIds.push(...affected.map((p) => p.id));
      const plan = await previewSelectedSync(source, request);
      eq(plan.excludedChangeIds.includes(unrelated.id), true);
      await applySync(source, plan);
      eq((await readProject(source)).pending, state.pending);
      const final = (await renderProject(source)).state;
      eq(final.docId, initial.docId);
      const retained = structuredClone(
        final.pending.find((p) => p.id === unrelated.id)!,
      );
      // Re-execution adds the fresh source comparison without changing the edit.
      delete retained.source;
      eq(retained, unrelated);
      eq(
        final.pending.some((p) => request.selectedChangeIds.includes(p.id)),
        false,
      );
      eq(
        final.emitted.slides.find((s) => s.id === "b")!.elements.find((e) =>
          e.id === "other/paragraph:1"
        )!.html,
        "Excluded B edit must survive.",
      );
      eq((await Deno.readTextFile(source)).includes("Original B."), true);
      eq(
        (await Deno.readTextFile(source)).includes("Review before deleting A."),
        false,
      );
    } finally {
      await Deno.remove(directory, { recursive: true });
    }
  }
});

Deno.test({
  name:
    "CLI edit bootstraps a fresh QMD and serves Studio after a typed NO_BASELINE error",
  ignore:
    (await Deno.permissions.query({ name: "net", host: "127.0.0.1" })).state !==
      "granted",
  fn: async () => {
    const directory = await Deno.makeTempDir({
      prefix: "qbento-fresh-cli-edit-",
    });
    const source = `${directory}/deck.qmd`;
    const text =
      "---\ntitle: Fresh CLI edit\nformat: html\n---\n\n## Slide {#slide}\n\n::: {#body}\nFresh body.\n:::\n";
    await Deno.writeTextFile(source, text);
    const child = new Deno.Command(Deno.execPath(), {
      args: [
        "run",
        "--no-config",
        "--allow-read",
        "--allow-write",
        "--allow-run",
        "--allow-env",
        "--allow-net=127.0.0.1",
        new URL("../src/cli.ts", import.meta.url).pathname,
        "edit",
        source,
      ],
      stdout: "piped",
      stderr: "piped",
    }).spawn();
    const errors = child.stderr.pipeTo(new WritableStream({ write() {} }));
    const reader = child.stdout.pipeThrough(new TextDecoderStream())
      .getReader();
    const timeout = setTimeout(() => {
      try {
        child.kill("SIGTERM");
      } catch { /* Already exited. */ }
    }, 60000);
    try {
      let output = "";
      while (!output.includes("\n")) {
        const chunk = await reader.read();
        if (chunk.done) {
          throw new Error(`CLI exited before starting Studio: ${output}`);
        }
        output += chunk.value;
      }
      const { url } = JSON.parse(output.slice(0, output.indexOf("\n")));
      const response = await fetch(url);
      eq(response.status, 200);
      await response.text();
      eq((await readProject(source)).pending, []);
      eq((await Deno.stat(`${directory}/deck.bento.html`)).isFile, true);
      eq(await Deno.readTextFile(source), text);
    } finally {
      clearTimeout(timeout);
      try {
        child.kill("SIGTERM");
      } catch { /* Already exited. */ }
      await reader.cancel();
      reader.releaseLock();
      await child.status;
      await errors;
      await Deno.remove(directory, { recursive: true });
    }
  },
});
