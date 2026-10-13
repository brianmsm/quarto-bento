import {
  applyIdentities,
  previewIdentities,
} from "../src/source/identities.ts";
import { hashSource, scanSource, sliceBytes } from "../src/source/mod.ts";
import { readSourceInline } from "../src/render/source-inline.ts";
import {
  assertProjectionIdentity,
  readProject,
  renderProject,
  saveProject,
} from "../src/core/project.ts";
import {
  applySync,
  prepareApprovedSync,
  previewSync,
  type SyncApprovalEnvelope,
} from "../src/core/sync.ts";
import { canonical, type ProvenanceMap, targetKey } from "../src/state/mod.ts";

function eq(actual: unknown, expected: unknown) {
  if (canonical(actual) !== canonical(expected)) {
    throw new Error(`${canonical(actual)} != ${canonical(expected)}`);
  }
}
function ok(value: unknown, message = "assertion failed"): asserts value {
  if (!value) throw new Error(message);
}
async function refuses(action: () => unknown, code: string) {
  try {
    await action();
  } catch (error) {
    if (
      (error as { code?: string }).code === code || String(error).includes(code)
    ) return;
    throw error;
  }
  throw new Error(`Expected ${code}`);
}
const canRun =
  (await Deno.permissions.query({ name: "run" })).state === "granted";
Deno.test("identity acquisition preserves UTF8 CRLF and authored bytes with surgical checked patches", async () => {
  for (const newline of ["\n", "\r\n"]) {
    for (const ending of ["", newline]) {
      const original = [
        "---",
        "title: β 😀",
        "---",
        "",
        "## Cálculo **útil** ## {.unnumbered}",
        "",
        "Texto con **énfasis** y `R`.",
      ].join(newline) + ending;
      const document = scanSource(original),
        [heading, paragraph] = document.blocks;
      const plan = previewIdentities(document, [
        {
          blockId: heading.id,
          sourceId: "cálculo-útil",
          nativeId: "cálculo-útil-title",
          title: true,
        },
        {
          blockId: paragraph.id,
          sourceId: "qb-paragraph-source",
          nativeId: "qb-paragraph-1",
          title: false,
        },
      ]);
      eq(applyIdentities(original, plan), plan.result);
      eq(
        sliceBytes(plan.result, scanSource(plan.result).preambleSpan),
        sliceBytes(original, document.preambleSpan),
      );
      const acquired = scanSource(plan.result);
      eq(
        acquired.blocks.find((block) => block.id === "cálculo-útil")?.content,
        heading.content,
      );
      eq(
        acquired.blocks.find((block) =>
          block.id === "qb-paragraph-source/paragraph:1"
        )?.content,
        paragraph.content,
      );
      eq(acquired.slides[0].stable, true);
      if (newline === "\r\n") {
        eq(plan.result.replaceAll("\r\n", "").includes("\n"), false);
      }
      await refuses(
        () => applyIdentities(original + newline, plan),
        "stale-source",
      );
      const altered = structuredClone(plan);
      altered.requests[1].nativeId = "different-native";
      await refuses(
        () => applyIdentities(original, altered),
        "invalid-identity-plan",
      );
      await refuses(
        () => previewIdentities(document, [plan.requests[0], plan.requests[0]]),
        "ambiguous-identity",
      );
    }
  }
});
Deno.test({
  name:
    "Pandoc proof reads faithful authored rich fragments without executing inline computation",
  ignore: !canRun,
  fn: async () => {
    const document = scanSource(
      "## Cálculo **útil**\n\nTexto *ligero* y `fit(x)` con [Fuente](https://example.org/Case).\n\nValor `r stop('must not execute')`.\n",
    );
    const proof = await readSourceInline(document);
    eq(proof.get(document.blocks[0].id)?.readerId, "cálculo-útil");
    eq(proof.get(document.blocks[0].id)?.html, "Cálculo <b>útil</b>");
    eq(
      proof.get(document.blocks[1].id)?.html,
      'Texto <i>ligero</i> y <code>fit(x)</code> con <a href="https://example.org/Case">Fuente</a>.',
    );
    eq(proof.has(document.blocks[2].id), false);
  },
});
Deno.test({
  name:
    "real plain QMD selected sync pins all weak blocks then reopens and recomputes with native identities and design",
  ignore: !canRun,
  fn: async () => {
    const directory = await Deno.makeTempDir({
        prefix: "qbento-plain-roundtrip-",
      }),
      source = directory + "/deck.qmd";
    try {
      const text = [
        "---",
        "title: Autoría normal",
        "engine: knitr",
        "qbento-annotations: none",
        "---",
        "",
        "## Cálculo **útil** y `R`",
        "",
        "Un resultado con **énfasis** y `código`.",
        "",
        "La segunda frase se conserva al editar la primera.",
        "",
        "## Revisión final",
        "",
        "Un resultado con **énfasis** y `código`.",
        "",
        "```{r}",
        "#| label: counter",
        "#| include: false",
        "cat('x', file='executions.txt', append=TRUE)",
        "```",
        "",
        "```{r}",
        "#| label: fig-values",
        "#| echo: false",
        "#| dev: svg",
        'values <- read.csv("data.csv")',
        'plot(values$x, values$y, type="b", col="#156f65", pch=19)',
        "```",
        "",
      ].join("\r\n");
      await Deno.writeTextFile(source, text);
      await Deno.writeTextFile(directory + "/data.csv", "x,y\n1,2\n2,4\n3,3\n");
      const first = await renderProject(source),
        edited = structuredClone(first.state.emitted);
      const [title, paragraph, other] = edited.slides[0].elements;
      eq(title.html, "Cálculo <b>útil</b> y <code>R</code>");
      eq(
        paragraph.html,
        "Un resultado con <b>énfasis</b> y <code>código</code>.",
      );
      title.html = "Título revisado con <b>β</b>";
      paragraph.html = "Resultado <b>revisado</b> con <code>modelo</code>.";
      paragraph.x = 371;
      paragraph.y = 258;
      paragraph.w = 651;
      paragraph.fontSize = 29;
      other.html = "Cambio aún pendiente en otro párrafo.";
      other.x = 279;
      const figure = edited.slides[1].elements.find((element) =>
        element.id === "fig-values"
      )!;
      figure.x = 412;
      figure.y = 261;
      figure.w = 572;
      const saved = await saveProject(source, edited, first.state.revision),
        selected = saved.pending.filter((change) =>
          change.target.slideId === edited.slides[0].id &&
          [title.id, paragraph.id].includes(change.target.elementId!)
        ).map((change) => change.id);
      eq(saved.pending.length, 3);
      eq(selected.length, 2);
      eq(await Deno.readTextFile(source), text);
      const savedBytes = await Deno.readTextFile(
          directory + "/.qbento/state.json",
        ),
        plan = await previewSync(source, selected);
      eq(await Deno.readTextFile(source), text);
      eq(
        await Deno.readTextFile(directory + "/.qbento/state.json"),
        savedBytes,
      );
      eq(await Deno.readTextFile(directory + "/executions.txt"), "x");
      eq(plan.identityBindings?.length, 5);
      eq(plan.excludedChangeIds.length, 1);
      eq(
        plan.changes.filter((change) => change.kind === "source-identity")
          .length,
        5,
      );
      for (
        const chunk of scanSource(text).blocks.filter((block) =>
          block.kind === "chunk"
        )
      ) {
        eq(
          scanSource(plan.result).blocks.find((block) => block.id === chunk.id)
            ?.raw,
          chunk.raw,
        );
      }
      const tampered = structuredClone(plan);
      tampered.identities!.requests[1].nativeId = "changed-native";
      tampered.planHash = hashSource(
        canonical(Object.fromEntries(
          Object.entries(tampered).filter(([name]) => name !== "planHash"),
        )),
      );
      await refuses(() => applySync(source, tampered), "INVALID_PLAN");
      eq(await Deno.readTextFile(source), text);
      eq(
        await Deno.readTextFile(directory + "/.qbento/state.json"),
        savedBytes,
      );
      const receipt = await applySync(source, plan);
      eq(await Deno.readTextFile(receipt.sourceBackup), text);
      eq((await readProject(source)).pending.length, 3);
      eq(await Deno.readTextFile(directory + "/executions.txt"), "x");
      const envelope = JSON.parse(
          await Deno.readTextFile(directory + "/.qbento/sync-approved.json"),
        ) as SyncApprovalEnvelope,
        current = await readProject(source),
        appliedBytes = await Deno.readTextFile(
          directory + "/.qbento/state.json",
        );
      const generated = structuredClone(first.state.generatedBaseline),
        provenance: ProvenanceMap = structuredClone(first.state.provenance);
      for (const binding of plan.identityBindings!) {
        provenance[targetKey(binding.target)] = structuredClone(binding.after);
        generated.slides.find((slide) => slide.id === binding.target.slideId)!
          .elements.find((element) => element.id === binding.target.elementId)!
          .html = binding.expectedHtml!;
      }
      const prepared = prepareApprovedSync(
        current,
        generated,
        plan.resultHash,
        envelope,
        provenance,
      );
      assertProjectionIdentity(prepared, provenance, plan.resultHash);
      await refuses(
        () =>
          prepareApprovedSync(current, generated, plan.resultHash, envelope),
        "STALE_APPROVAL",
      );
      const missing = structuredClone(provenance);
      delete missing[targetKey(plan.identityBindings![1].target)];
      await refuses(
        () =>
          prepareApprovedSync(
            current,
            generated,
            plan.resultHash,
            envelope,
            missing,
          ),
        "STALE_APPROVAL",
      );
      const wrong = structuredClone(provenance);
      wrong[targetKey(plan.identityBindings![1].target)].source!.content =
        "Unapproved.";
      await refuses(
        () =>
          prepareApprovedSync(
            current,
            generated,
            plan.resultHash,
            envelope,
            wrong,
          ),
        "STALE_APPROVAL",
      );
      const corrupt = structuredClone(envelope);
      corrupt.approval.identityBindings![0].expectedHtml = "Unapproved.";
      await refuses(
        () =>
          prepareApprovedSync(
            current,
            generated,
            plan.resultHash,
            corrupt,
            provenance,
          ),
        "INVALID_APPROVAL",
      );
      corrupt.sha256 = hashSource(canonical(corrupt.approval));
      await refuses(
        () =>
          prepareApprovedSync(
            current,
            generated,
            plan.resultHash,
            corrupt,
            provenance,
          ),
        "STALE_APPROVAL",
      );
      const changedPending = structuredClone(current);
      changedPending.pending.find((change) => change.id === selected[0])!
        .after = { present: true, value: "Changed after approval." };
      await refuses(
        () =>
          prepareApprovedSync(
            changedPending,
            generated,
            plan.resultHash,
            envelope,
            provenance,
          ),
        "STALE_APPROVAL",
      );
      const malformed = structuredClone(envelope);
      malformed.approval.identityBindings = [
        null,
      ] as unknown as typeof plan.identityBindings;
      malformed.sha256 = hashSource(canonical(malformed.approval));
      await refuses(
        () =>
          prepareApprovedSync(
            current,
            generated,
            plan.resultHash,
            malformed,
            provenance,
          ),
        "INVALID_APPROVAL",
      );
      eq(
        await Deno.readTextFile(directory + "/.qbento/state.json"),
        appliedBytes,
      );
      const rebuilt = await renderProject(source),
        reopened = await readProject(source);
      eq(rebuilt.state.docId, first.state.docId);
      eq(reopened.pending.length, 1);
      eq(
        rebuilt.state.emitted.slides.map((
          slide,
        ) => [slide.id, slide.elements.map((element) => element.id)]),
        edited.slides.map((
          slide,
        ) => [slide.id, slide.elements.map((element) => element.id)]),
      );
      for (const expected of [paragraph, other]) {
        const actual = reopened.emitted.slides[0].elements.find((element) =>
          element.id === expected.id
        )!;
        eq(actual.html, expected.html);
        eq(actual.x, expected.x);
        eq(actual.w, expected.w);
      }
      const beforeFigure = reopened.emitted.slides[1].elements.find((element) =>
        element.id === figure.id
      )!;
      eq(beforeFigure.x, figure.x);
      eq(beforeFigure.w, figure.w);
      await Deno.writeTextFile(directory + "/data.csv", "x,y\n1,8\n2,1\n3,6\n");
      const recomputed = await renderProject(source),
        afterFigure = recomputed.state.emitted.slides[1].elements.find((
          element,
        ) => element.id === figure.id)!;
      ok(afterFigure.src !== beforeFigure.src, "computed SVG must change");
      eq(afterFigure.x, figure.x);
      eq(afterFigure.w, figure.w);
      eq(recomputed.state.pending.length, 1);
      const followup = await previewSync(source);
      eq(followup.identities, undefined);
      await applySync(source, followup);
      const done = await renderProject(source);
      eq(done.state.pending.length, 0);
      eq(done.state.docId, first.state.docId);
      eq(await Deno.readTextFile(directory + "/executions.txt"), "xxxx");
      eq(
        (await Deno.readTextFile(source)).replaceAll("\r\n", "").includes("\n"),
        false,
      );
    } finally {
      await Deno.remove(directory, { recursive: true });
    }
  },
});
Deno.test({
  name:
    "reviewed identity acquisition composes minimal and detailed annotations with Unicode native/source headings",
  ignore: !canRun,
  fn: async () => {
    for (
      const [level, heading] of [["minimal", "Cálculo útil"], [
        "detailed",
        "Ca\u0301lculo útil",
      ]]
    ) {
      const directory = await Deno.makeTempDir({
          prefix: "qbento-plain-annotations-",
        }),
        source = directory + "/deck.qmd";
      try {
        const original =
          `---\nqbento-annotations: ${level}\n---\n\n## ${heading}\n\nTexto **original**.\n`;
        await Deno.writeTextFile(source, original);
        const first = await renderProject(source),
          edited = structuredClone(first.state.emitted);
        edited.slides[0].elements[1].html = "Texto <b>revisado</b>.";
        edited.slides[0].elements[1].x = 377;
        await saveProject(source, edited, first.state.revision);
        const plan = await previewSync(source);
        eq(plan.identities?.bindings.length, 2);
        ok(plan.annotations.patches.length > 0);
        eq(plan.annotations.diagnostics, []);
        eq(await Deno.readTextFile(source), original);
        await applySync(source, plan);
        const done = await renderProject(source);
        eq(done.state.pending.length, 0);
        eq(done.state.docId, first.state.docId);
        eq(done.state.emitted.slides[0].id, first.state.emitted.slides[0].id);
        eq(
          done.state.emitted.slides[0].elements[1].id,
          first.state.emitted.slides[0].elements[1].id,
        );
        eq(done.state.emitted.slides[0].elements[1].x, 377);
      } finally {
        await Deno.remove(directory, { recursive: true });
      }
    }
  },
});
Deno.test({
  name:
    "plain mapping and sync refuse ambiguous same-slide computed and externally changed weak fragments before source write",
  ignore: !canRun,
  fn: async () => {
    for (
      const body of [
        "Texto **duplicado**.\n\nTexto **duplicado**.",
        "Valor `r 1 + 1`.",
      ]
    ) {
      const directory = await Deno.makeTempDir({
          prefix: "qbento-plain-refusal-",
        }),
        source = directory + "/deck.qmd",
        text = `## Resultado\n\n${body}\n`;
      try {
        await Deno.writeTextFile(source, text);
        await refuses(() => renderProject(source), "UNMAPPED_PROVENANCE");
        eq(await Deno.readTextFile(source), text);
      } finally {
        await Deno.remove(directory, { recursive: true });
      }
    }
    for (const extra of ["", "\n$$\nx + y\n$$\n"]) {
      const directory = await Deno.makeTempDir({
          prefix: "qbento-plain-external-",
        }),
        source = directory + "/deck.qmd",
        text = "## Resultado\n\nTexto original.\n" + extra;
      try {
        await Deno.writeTextFile(source, text);
        const first = await renderProject(source),
          edited = structuredClone(first.state.emitted);
        edited.slides[0].elements[1].html = "Texto editado.";
        await saveProject(source, edited, first.state.revision);
        await Deno.writeTextFile(source, "\n" + text);
        const before = await Deno.readTextFile(
            directory + "/.qbento/state.json",
          ),
          qmd = await Deno.readTextFile(source),
          output = await Deno.readTextFile(directory + "/deck.bento.html");
        await refuses(() => previewSync(source), "AMBIGUOUS_IDENTITY");
        eq(await Deno.readTextFile(source), qmd);
        eq(await Deno.readTextFile(directory + "/.qbento/state.json"), before);
        eq(await Deno.readTextFile(directory + "/deck.bento.html"), output);
      } finally {
        await Deno.remove(directory, { recursive: true });
      }
    }
  },
});
