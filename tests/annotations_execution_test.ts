import {
  readProject,
  renderProject,
  saveProject,
} from "../src/core/project.ts";
import { applySync, previewSync } from "../src/core/sync.ts";
import { originalAnnotationLevel } from "../src/core/annotations.ts";
import {
  canonical,
  StateError,
  StateStore,
  targetKey,
} from "../src/state/mod.ts";
import { recoverProject } from "../src/core/recovery.ts";
import { hashSource, scanSource } from "../src/source/mod.ts";
function eq(a: unknown, b: unknown) {
  if (canonical(a) !== canonical(b)) {
    throw new Error(`${canonical(a)} != ${canonical(b)}`);
  }
}
async function refuses(fn: () => unknown, code: string) {
  try {
    await fn();
  } catch (e) {
    if (String(e).includes(code) || (e as { code?: string }).code === code) {
      return;
    }
    throw e;
  }
  throw new Error(`Expected ${code}`);
}
const canRun =
  (await Deno.permissions.query({ name: "run" })).state === "granted";
const text =
  "---\r\ntitle: Anotación β\r\n---\r\n\r\n## Título {#slide .original}\r\n\r\n::: {#body}\r\nTexto β 😀.\r\n:::\r\n";
Deno.test({
  name:
    "real Quarto accepts original top-level annotation key and metadata-only parsing never executes the body",
  ignore: !canRun,
  fn: async () => {
    for (const level of ["none", "minimal", "detailed"]) {
      eq(
        await originalAnnotationLevel(
          `---\n"qbento-annotations": '${level}'\n---\n\n` +
            '```{r}\nstop("do not execute")\n```\n',
        ),
        level,
      );
    }
    for (
      const config of [
        "qbento-annotations: none\nqbento-annotations: detailed",
        "qbento-annotations: mínimo",
        "qbento-annotations: [detailed]",
        'qbento-annotations: "detailed',
        "qbento-annotations: null",
      ]
    ) {
      await refuses(
        () => originalAnnotationLevel(`---\n${config}\n---\n`),
        "INVALID_ANNOTATION_CONFIG",
      );
    }
    eq(await originalAnnotationLevel("---\n---\n"), "minimal");
  },
});
Deno.test({
  name:
    "real minimal sync previews all CRLF patches recovers source and preserves visual state across recompute",
  ignore: !canRun,
  fn: async () => {
    const dir = await Deno.makeTempDir({ prefix: "qbento-annotations-real-" });
    const source = dir + "/deck.qmd";
    try {
      await Deno.writeTextFile(source, text);
      const first = await renderProject(source);
      const edited = structuredClone(first.state.emitted);
      const body = edited.slides[0].elements.find((e) =>
        e.type === "text" && e.html === "Texto β 😀."
      )!;
      body.x = 222;
      body.html = "Texto editado β 😀.";
      const saved = await saveProject(source, edited, first.state.revision);
      eq(await Deno.readTextFile(source), text);
      const rerendered = await renderProject(source);
      eq(await Deno.readTextFile(source), text);
      eq(rerendered.state.pending.length, 1);
      const beforeState = await Deno.readTextFile(dir + "/.qbento/state.json");
      const files = (await Array.fromAsync(Deno.readDir(dir + "/.qbento"))).map(
        (x) => x.name,
      ).sort();
      const plan = await previewSync(source);
      eq(plan.annotations.level, "minimal");
      eq(plan.annotations.patches.length, 1);
      eq(plan.annotations.diagnostics, []);
      eq(plan.changes.filter((c) => c.kind === "visual-annotation").length, 1);
      const expected = text.replace(".original}", ".original .qbento-design}")
        .replace("Texto β 😀.", "Texto editado β 😀.");
      eq(plan.result, expected);
      eq(await Deno.readTextFile(source), text);
      eq(await Deno.readTextFile(dir + "/.qbento/state.json"), beforeState);
      eq(
        (await Array.fromAsync(Deno.readDir(dir + "/.qbento"))).map((x) =>
          x.name
        ).sort(),
        files,
      );
      const receipt = await applySync(source, plan);
      eq(await Deno.readTextFile(receipt.sourceBackup), text);
      eq(await Deno.readTextFile(source), expected);
      eq(receipt.appliedChangeIds, saved.pending.map((c) => c.id));
      const next = await renderProject(source);
      eq(next.state.pending, []);
      eq(
        next.state.emitted.slides[0].elements.find((e) => e.id === body.id)!.x,
        222,
      );
      eq(next.state.ownership, first.state.ownership);
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  },
});
Deno.test({
  name:
    "annotation-only detailed transitions and none cleanup never freeze geometry or alter technical IDs",
  ignore: !canRun,
  fn: async () => {
    const dir = await Deno.makeTempDir({ prefix: "qbento-annotation-levels-" });
    const source = dir + "/deck.qmd";
    try {
      const original = text.replace(
        "title: Anotación β",
        "title: Anotación β\r\nqbento-annotations: detailed",
      );
      await Deno.writeTextFile(source, original);
      const first = await renderProject(source);
      const edited = structuredClone(first.state.emitted);
      edited.slides[0].elements[1].x = 237;
      await saveProject(source, edited, first.state.revision);
      eq(await Deno.readTextFile(source), original);
      const plan = await previewSync(source);
      eq(plan.selectedChangeIds, []);
      eq(plan.annotations.patches.length, 2);
      if (plan.result.includes("237")) {
        throw new Error("Geometry leaked to source");
      }
      await applySync(source, plan);
      const second = await renderProject(source);
      eq(second.state.pending, []);
      eq(second.state.emitted.slides[0].elements[1].x, 237);
      const detailed = await Deno.readTextFile(source);
      await Deno.writeTextFile(
        source,
        detailed.replace(
          "qbento-annotations: detailed",
          "qbento-annotations: none",
        ),
      );
      const none = await previewSync(source);
      eq(none.annotations.patches.length, 2);
      await applySync(source, none);
      eq(
        await Deno.readTextFile(source),
        original.replace(
          "qbento-annotations: detailed",
          "qbento-annotations: none",
        ),
      );
      const third = await renderProject(source);
      eq(third.state.emitted.slides[0].elements[1].x, 237);
      eq(
        third.state.emitted.slides[0].elements.map((e) => e.id),
        first.state.emitted.slides[0].elements.map((e) => e.id),
      );
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  },
});
Deno.test({
  name:
    "weak identities retain diagnostic-only refusal and semantic sync acquires reviewed IDs before optional traces",
  ignore: !canRun,
  fn: async () => {
    const dir = await Deno.makeTempDir({ prefix: "qbento-annotation-weak-" });
    const source = dir + "/deck.qmd";
    const original =
      "## Título {#slide}\n\nPrimer párrafo.\n\nSegundo párrafo.\n";
    try {
      await Deno.writeTextFile(source, original);
      const first = await renderProject(source);
      const edited = structuredClone(first.state.emitted);
      edited.slides[0].elements[1].x = 240;
      await saveProject(source, edited, first.state.revision);
      const blocked = await previewSync(source);
      eq(blocked.annotations.patches, []);
      eq(blocked.annotations.diagnostics[0].code, "ANNOTATION_UNSAFE_REBUILD");
      eq(blocked.changes[0].kind, "annotation-diagnostic");
      eq((await previewSync(source)).planHash, blocked.planHash);
      const before = await Deno.readTextFile(dir + "/.qbento/state.json"),
        beforeOutput = await Deno.readTextFile(dir + "/deck.bento.html");
      eq(blocked.identities, undefined);
      await refuses(() => applySync(source, blocked), "NO_SOURCE_CHANGES");
      eq(await Deno.readTextFile(source), original);
      eq(await Deno.readTextFile(dir + "/.qbento/state.json"), before);
      eq(await Deno.readTextFile(dir + "/deck.bento.html"), beforeOutput);
      const loaded = await readProject(source);
      const semantic = structuredClone(loaded.emitted);
      semantic.slides[0].elements[0].html = "Título editado";
      const saved = await saveProject(source, semantic, loaded.revision),
        savedBytes = await Deno.readTextFile(dir + "/.qbento/state.json"),
        savedOutput = await Deno.readTextFile(dir + "/deck.bento.html");
      eq(await Deno.readTextFile(source), original);
      const plan = await previewSync(source),
        paragraphIds = semantic.slides[0].elements.slice(1).map((e) => e.id),
        sourceIds = paragraphIds.map((id) =>
          `qb-identity-${
            hashSource(canonical([saved.docId, semantic.slides[0].id, id]))
              .slice(0, 24)
          }`
        ),
        weakParagraphs = scanSource(original).blocks.filter((block) =>
          block.kind === "paragraph"
        );
      eq(
        plan.identities?.requests,
        weakParagraphs.map((block, index) => ({
          blockId: block.id,
          sourceId: sourceIds[index],
          nativeId: paragraphIds[index],
          title: false,
        })),
      );
      eq(plan.identityBindings?.length, 2);
      eq(
        plan.changes.filter((change) => change.kind === "source-identity")
          .length,
        2,
      );
      eq(plan.selectedChangeIds, saved.pending.map((change) => change.id));
      eq(plan.annotations.diagnostics, []);
      eq(plan.annotations.patches.length, 1);
      eq(plan.annotations.patches[0].replacement, " .qbento-design");
      const expected = [
        "## Título editado {#slide .qbento-design}",
        "",
        `::: {#${sourceIds[0]} bento-element-id="${paragraphIds[0]}"}`,
        "",
        "Primer párrafo.",
        "",
        ":::",
        "",
        `::: {#${sourceIds[1]} bento-element-id="${paragraphIds[1]}"}`,
        "",
        "Segundo párrafo.",
        "",
        ":::",
        "",
      ].join("\n");
      eq(plan.result, expected);
      eq(await Deno.readTextFile(source), original);
      eq(await Deno.readTextFile(dir + "/.qbento/state.json"), savedBytes);
      eq(await Deno.readTextFile(dir + "/deck.bento.html"), savedOutput);
      const receipt = await applySync(source, plan);
      eq(receipt.annotations.diagnostics, []);
      eq(receipt.annotations.patchCount, 1);
      eq(await Deno.readTextFile(source), expected);
      eq(await Deno.readTextFile(receipt.sourceBackup), original);
      const next = await renderProject(source);
      eq(next.state.pending, []);
      eq(next.state.emitted, semantic);
      eq(next.state.docId, first.state.docId);
      eq(next.state.emitted.slides[0].elements[1].x, 240);
      eq(
        next.state.generatedBaseline.slides[0].elements[1].x,
        first.state.generatedBaseline.slides[0].elements[1].x,
      );
      for (const [index, id] of paragraphIds.entries()) {
        const proof = next.state.provenance[
          targetKey({
            slideId: semantic.slides[0].id,
            elementId: id,
          })
        ];
        eq(proof.origin, "authored");
        eq(proof.source?.blockId, `${sourceIds[index]}/paragraph:1`);
        eq(proof.source?.stable, false);
        eq(proof.source?.parentId, sourceIds[index]);
        eq(proof.source?.siblings, 1);
        eq(
          scanSource(expected).blocks.find((block) =>
            block.id === sourceIds[index]
          )
            ?.stable,
          true,
        );
        eq(proof.source?.hash, hashSource(expected));
      }
      eq(await Deno.readTextFile(source), expected);
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  },
});
Deno.test({
  name:
    "source state registry and malformed trace conflicts retain original QMD",
  ignore: !canRun,
  fn: async () => {
    const dir = await Deno.makeTempDir({ prefix: "qbento-annotation-stale-" });
    const source = dir + "/deck.qmd";
    try {
      await Deno.writeTextFile(source, text);
      const first = await renderProject(source);
      const edited = structuredClone(first.state.emitted);
      edited.slides[0].elements[1].x = 220;
      await saveProject(source, edited, first.state.revision);
      const plan = await previewSync(source);
      const forged = structuredClone(plan);
      forged.annotations.patches[0].replacement = " x=900";
      await refuses(() => applySync(source, forged), "INVALID_PLAN");
      await Deno.writeTextFile(source, text + "\r\n");
      await refuses(() => applySync(source, plan), "STALE_SOURCE");
      await Deno.writeTextFile(source, text);
      await Deno.writeTextFile(
        dir + "/.qbento/design.json",
        JSON.stringify({
          schemaVersion: 1,
          themes: {
            local: {
              background: "#fff",
              color: "#000",
              accent: "#123",
              fontFamily: "Arial",
            },
          },
          activeTheme: "local",
        }),
      );
      await refuses(() => applySync(source, plan), "STALE_DESIGN_REGISTRY");
      const fresh = await previewSync(source);
      eq(fresh.annotations.requests[0].features.includes("theme"), true);
      const malformed = text.replace(
        ".original}\r\n",
        ".original}\r\n<!-- qbento-design: broken -->\r\n",
      );
      await Deno.writeTextFile(source, malformed);
      await refuses(() => previewSync(source), "invalid-annotation");
      eq(await Deno.readTextFile(source), malformed);
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  },
});

Deno.test({
  name:
    "byte-noop notes normalization remains approved and clears on real recompute",
  ignore: !canRun,
  fn: async () => {
    const dir = await Deno.makeTempDir({
      prefix: "qbento-annotation-normalization-",
    });
    const source = dir + "/deck.qmd";
    const original =
      "---\nqbento-annotations: none\n---\n\n## Title {#slide}\n\n::: {#speaker .notes}\nFirst\nSecond\n:::\n";
    try {
      await Deno.writeTextFile(source, original);
      const first = await renderProject(source);
      const edited = structuredClone(first.state.emitted);
      edited.slides[0].notes = "First\r\nSecond";
      await saveProject(source, edited, first.state.revision);
      const plan = await previewSync(source);
      eq(plan.result, original);
      eq(plan.normalizations.length, 1);
      const receipt = await applySync(source, plan);
      eq(receipt.annotations, {
        level: "none",
        patchCount: 0,
        diagnostics: [],
      });
      const rendered = await renderProject(source);
      eq(rendered.state.pending, []);
      eq(rendered.state.emitted.slides[0].notes, "First\nSecond");
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  },
});

Deno.test({
  name:
    "partial annotation transaction recovers exact source and retains validated summary",
  ignore: !canRun,
  fn: async () => {
    const dir = await Deno.makeTempDir({
      prefix: "qbento-annotation-recovery-",
    });
    const source = dir + "/deck.qmd";
    const save = StateStore.prototype.save;
    try {
      await Deno.writeTextFile(source, text);
      const first = await renderProject(source);
      const edited = structuredClone(first.state.emitted);
      edited.slides[0].elements[1].x = 230;
      await saveProject(source, edited, first.state.revision);
      const plan = await previewSync(source);
      StateStore.prototype.save = () =>
        Promise.reject(
          new StateError("INJECTED_STATE_FAILURE", "simulated state failure"),
        );
      await refuses(() => applySync(source, plan), "INJECTED_STATE_FAILURE");
      StateStore.prototype.save = save;
      const journalPath = dir + "/.qbento/sync-transaction.json";
      const journal = JSON.parse(await Deno.readTextFile(journalPath));
      eq(await Deno.readTextFile(journal.sourceBackup), text);
      eq(await Deno.readTextFile(source), plan.result);
      eq(journal.annotations, {
        level: "minimal",
        patchCount: 1,
        diagnostics: [],
      });
      const malformed = structuredClone(journal);
      malformed.annotations.patchCount = -1;
      await Deno.writeTextFile(journalPath, JSON.stringify(malformed));
      await refuses(
        () => recoverProject(source, "finish"),
        "INVALID_ANNOTATION_SUMMARY",
      );
      eq(await Deno.readTextFile(source), plan.result);
      await Deno.writeTextFile(journalPath, JSON.stringify(journal));
      await recoverProject(source, "finish");
      const receipt = JSON.parse(await Deno.readTextFile(journal.receiptPath));
      eq(receipt.annotations, journal.annotations);
      const rendered = await renderProject(source);
      eq(rendered.state.emitted.slides[0].elements[1].x, 230);
    } finally {
      StateStore.prototype.save = save;
      await Deno.remove(dir, { recursive: true });
    }
  },
});
