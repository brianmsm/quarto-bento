import {
  applySync,
  inlineHtmlToMarkdown,
  previewSync,
} from "../src/core/sync.ts";
import {
  captureEdits,
  createState,
  StateError,
  StateStore,
  targetKey,
} from "../src/state/mod.ts";
import type { BentoDoc } from "../src/state/mod.ts";
import { scanSource } from "../src/source/mod.ts";
function eq(actual: unknown, expected: unknown) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
  }
}
async function rejects(fn: () => unknown, code: string) {
  try {
    await fn();
  } catch (error) {
    if (error instanceof StateError && error.code === code) return;
    throw error;
  }
  throw new Error(`Expected ${code}`);
}
async function fixture(
  options: {
    source?: string;
    html?: string;
    origin?: "authored" | "computed";
  } = {},
) {
  const directory = await Deno.makeTempDir({ prefix: "qbento-sync-" }),
    source = directory + "/deck.qmd",
    stateDir = directory + "/.qbento";
  const text = options.source ??
    "---\r\ntitle: Deck\r\n---\r\n\r\n## Title {#slide}\r\n\r\n<!-- qb:body -->\r\nOriginal β 😀.\r\n";
  await Deno.writeTextFile(source, text);
  const mapping = scanSource(text),
    block = mapping.blocks.find((b) => b.kind === "paragraph")!;
  const document: BentoDoc = {
    docId: "sync-fixture",
    slides: [{
      id: "slide",
      elements: [{ id: "body", type: "text", html: "Original β 😀." }],
    }],
  };
  const provenance = {
    [targetKey({ slideId: "slide", elementId: "body" })]: {
      origin: options.origin ?? "authored",
      semanticId: block.id,
      source: {
        blockId: block.id,
        content: block.content,
        kind: block.kind,
        hash: mapping.hash,
        stable: block.stable,
        ...(block.parentId
          ? {
            parentId: block.parentId,
            siblings: mapping.blocks.filter((b) =>
              b.parentId === block.parentId && b.kind === block.kind
            ).length,
          }
          : {}),
      },
    },
  };
  const initial = createState(document, provenance),
    edited = structuredClone(document);
  edited.slides[0].elements[0].html = options.html ?? "Edited β 😀.";
  const store = new StateStore(stateDir),
    state = await store.save(captureEdits(initial, edited));
  return { directory, source, stateDir, store, state, text };
}
Deno.test("preview is read-only, exact sync has durable source/state recovery and leaves pending until render", async () => {
  const f = await fixture();
  try {
    const before = await Deno.readTextFile(f.store.path),
      filesBefore = [...await Array.fromAsync(Deno.readDir(f.stateDir))].map(
        (e) => e.name,
      ).sort();
    const plan = await previewSync(f.source);
    eq(await Deno.readTextFile(f.store.path), before);
    eq(await Deno.readTextFile(f.source), f.text);
    eq(
      [...await Array.fromAsync(Deno.readDir(f.stateDir))].map((e) => e.name)
        .sort(),
      filesBefore,
    );
    eq(plan.changes[0].before, "Original β 😀.");
    eq(plan.patch.patches[0].blockId, "body");
    const receipt = await applySync(f.source, plan);
    eq(
      await Deno.readTextFile(f.source),
      f.text.replace("Original β 😀.", "Edited β 😀."),
    );
    eq(await Deno.readTextFile(receipt.sourceBackup), f.text);
    eq(await Deno.readTextFile(receipt.stateBackup), before);
    eq((await f.store.load())!.pending, f.state.pending);
    eq((await f.store.load())!.generatedBaseline, f.state.generatedBaseline);
    eq(receipt.revision, f.state.revision + 1);
    eq(receipt.renderNeeded, true);
    eq(receipt.pendingRetained, true);
    eq(
      (await Array.fromAsync(Deno.readDir(f.stateDir))).some((e) =>
        e.name === "sync-transaction.json"
      ),
      false,
    );
    eq(JSON.parse(await Deno.readTextFile(receipt.receiptPath)), receipt);
  } finally {
    await Deno.remove(f.directory, { recursive: true });
  }
});
Deno.test("independent source edits are retained when stable authored fragment is unchanged", async () => {
  const f = await fixture();
  try {
    const edited = f.text.replace("title: Deck", "title: New metadata");
    await Deno.writeTextFile(f.source, edited);
    const plan = await previewSync(f.source);
    await applySync(f.source, plan);
    eq(
      await Deno.readTextFile(f.source),
      edited.replace("Original β 😀.", "Edited β 😀."),
    );
  } finally {
    await Deno.remove(f.directory, { recursive: true });
  }
});
Deno.test("same-fragment divergence, stale source, stale state and tampered plan refuse", async () => {
  const f = await fixture();
  try {
    const plan = await previewSync(f.source);
    await Deno.writeTextFile(
      f.source,
      f.text.replace("Original", "Independent"),
    );
    await rejects(() => previewSync(f.source), "SOURCE_CONFLICT");
    await rejects(() => applySync(f.source, plan), "STALE_SOURCE");
    await Deno.writeTextFile(f.source, f.text);
    const tampered = structuredClone(plan);
    tampered.patch.result = "malicious";
    await rejects(() => applySync(f.source, tampered), "INVALID_PLAN");
    await f.store.save(f.state);
    await rejects(() => applySync(f.source, plan), "STALE_REVISION");
    eq(await Deno.readTextFile(f.source), f.text);
  } finally {
    await Deno.remove(f.directory, { recursive: true });
  }
});
Deno.test("computed, conflict, unsupported and explicitly unselected edits are never silently applied", async () => {
  const computed = await fixture({ origin: "computed" });
  try {
    await rejects(() => previewSync(computed.source), "SYNC_CONFLICT");
  } finally {
    await Deno.remove(computed.directory, { recursive: true });
  }
  const f = await fixture();
  try {
    const state = await f.store.load();
    state!.pending.push({
      id: "unsupported-field",
      target: { slideId: "slide", elementId: "body" },
      path: ["notes"],
      kind: "field",
      origin: "authored",
      status: "bento-ahead",
      before: { present: true, value: ["slide"] },
      after: { present: true, value: ["other", "slide"] },
    });
    await f.store.save(state!);
    await rejects(() => previewSync(f.source), "UNSUPPORTED_SYNC");
    const plan = await previewSync(f.source, [f.state.pending[0].id]);
    eq(plan.excludedChangeIds, ["unsupported-field"]);
    await applySync(f.source, plan);
    eq((await f.store.load())!.pending.length, 2);
  } finally {
    await Deno.remove(f.directory, { recursive: true });
  }
});
Deno.test("anonymous source identity refuses changed snapshots but singleton explicit div remains mapped", async () => {
  const f = await fixture({ source: "## Title {#slide}\n\nOriginal β 😀.\n" });
  try {
    await Deno.writeTextFile(f.source, "\n" + f.text);
    await rejects(() => previewSync(f.source), "AMBIGUOUS_IDENTITY");
  } finally {
    await Deno.remove(f.directory, { recursive: true });
  }
  const g = await fixture({
    source: "## Title {#slide}\n\n::: {#card}\nOriginal β 😀.\n:::\n",
  });
  try {
    await Deno.writeTextFile(g.source, "\n" + g.text);
    await applySync(g.source, await previewSync(g.source));
    eq((await Deno.readTextFile(g.source)).includes("Edited β 😀."), true);
  } finally {
    await Deno.remove(g.directory, { recursive: true });
  }
});
Deno.test("inline HTML conversion escapes literal Markdown and refuses unsupported tags/attributes/entities", async () => {
  eq(
    inlineHtmlToMarkdown("<p>New <b>bold</b> &amp; <i>emphasis</i>.</p>"),
    "New **bold** & *emphasis*.",
  );
  eq(
    inlineHtmlToMarkdown("Literal *x* &lt;tag&gt; &#946; &#x1f600;"),
    "Literal \\*x\\* \\<tag\\> β 😀",
  );
  eq(inlineHtmlToMarkdown("1. Literal"), "1\\. Literal");
  for (
    const html of [
      "<script>42</script>",
      '<b onclick="run()">x</b>',
      '<img src="x">',
      "<b>x</i>",
      "Unknown &evil;",
      "<p>A</p><p>B</p>",
    ]
  ) await rejects(() => inlineHtmlToMarkdown(html), "UNSUPPORTED_HTML");
});
Deno.test("partial transaction preserves recovery journal and both snapshots after state commit failure", async () => {
  const f = await fixture();
  const original = StateStore.prototype.save;
  try {
    const plan = await previewSync(f.source);
    StateStore.prototype.save = () =>
      Promise.reject(
        new StateError("INJECTED_STATE_FAILURE", "test state failure"),
      );
    await rejects(() => applySync(f.source, plan), "INJECTED_STATE_FAILURE");
    const journal = JSON.parse(
      await Deno.readTextFile(f.stateDir + "/sync-transaction.json"),
    );
    eq(await Deno.readTextFile(journal.sourceBackup), f.text);
    eq(await Deno.readTextFile(f.source), plan.patch.result);
    eq((await f.store.load())!.revision, f.state.revision);
    await rejects(() => previewSync(f.source), "RECOVERY_OR_BUSY");
  } finally {
    StateStore.prototype.save = original;
    await Deno.remove(f.directory, { recursive: true });
  }
});
Deno.test("symlink source and state directory are refused without modifying targets", async () => {
  if (Deno.build.os === "windows") return;
  const f = await fixture();
  try {
    const alias = f.directory + "/alias.qmd";
    await Deno.symlink(f.source, alias);
    await rejects(() => previewSync(alias), "UNSAFE_SOURCE_PATH");
    eq(await Deno.readTextFile(f.source), f.text);
    await Deno.rename(f.stateDir, f.directory + "/state-real");
    await Deno.symlink(f.directory + "/state-real", f.stateDir);
    await rejects(() => previewSync(f.source), "UNSAFE_STATE_PATH");
  } finally {
    await Deno.remove(f.directory, { recursive: true });
  }
});
Deno.test("concurrent source recreation is never overwritten and retains source backup plus journal", async () => {
  const f = await fixture(), original = Deno.link;
  try {
    const plan = await previewSync(f.source);
    Deno.link = async (oldpath: string, newpath: string) => {
      if (newpath === f.source) {
        await Deno.writeTextFile(f.source, "Concurrent user source.\n", {
          createNew: true,
        });
      }
      return await original(oldpath, newpath);
    };
    let failed = false;
    try {
      await applySync(f.source, plan);
    } catch (error) {
      if (
        !(error instanceof StateError && error.code === "CONCURRENT_SOURCE")
      ) throw error;
      failed = true;
    }
    eq(failed, true);
    eq(await Deno.readTextFile(f.source), "Concurrent user source.\n");
    const journal = JSON.parse(
      await Deno.readTextFile(f.stateDir + "/sync-transaction.json"),
    );
    eq(await Deno.readTextFile(journal.sourceBackup), f.text);
    eq((await f.store.load())!.revision, f.state.revision);
  } finally {
    Deno.link = original;
    await Deno.remove(f.directory, { recursive: true });
  }
});
Deno.test("inline subset refuses formatting whose Markdown conversion is ambiguous", async () => {
  for (
    const html of [
      "<b> spaced </b>",
      "<b>one<br>two</b>",
      "<b><i>nested</i></b>",
      "<b>one</b><b>two</b>",
    ]
  ) await rejects(() => inlineHtmlToMarkdown(html), "UNSUPPORTED_HTML");
  const f = await fixture({ html: "Changed <b>bold</b> &amp; <i>italic</i>." });
  try {
    const plan = await previewSync(f.source);
    await applySync(f.source, plan);
    eq(
      (await Deno.readTextFile(f.source)).includes(
        "Changed **bold** & *italic*.",
      ),
      true,
    );
  } finally {
    await Deno.remove(f.directory, { recursive: true });
  }
});
Deno.test("bounded sync refuses rich original source from a legacy flattened baseline", async () => {
  for (
    const content of [
      "Read [manual](https://example.org) using `foo`.",
      "Use `foo` today.",
      "Read [manual].",
      "Visit <https://example.org>.",
    ]
  ) {
    const f = await fixture({
      source: `## Title {#slide}\n\n<!-- qb:body -->\n${content}\n`,
      html: "Please read manual using foo.",
    });
    try {
      await rejects(() => previewSync(f.source), "SOURCE_FORMAT_UNSUPPORTED");
      eq(await Deno.readTextFile(f.source), f.text);
    } finally {
      await Deno.remove(f.directory, { recursive: true });
    }
  }
});
