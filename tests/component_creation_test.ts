import { applyComponentAction } from "../src/core/component-actions.ts";
import {
  applySync,
  prepareApprovedSync,
  previewSync,
} from "../src/core/sync.ts";
import {
  readProject,
  renderProject,
  saveProject,
} from "../src/core/project.ts";
import { applySlideAction } from "../src/core/slide-actions.ts";
import { componentMarkdown } from "../src/source/component-insertion.ts";
import { hashSource, scanSource } from "../src/source/mod.ts";
import { previewStructure } from "../src/source/structure.ts";
import {
  canonical,
  clone,
  type ComponentCreation,
  type ProjectState,
  StateStore,
  validateState,
} from "../src/state/mod.ts";
import { canonicalInlineHtml } from "../src/render/inline.ts";
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
const fields = {
  label: "Participants β",
  value: "123",
  detail: "Complete cases",
};
const original =
  "---\nengine: knitr\nqbento-annotations: none\n---\n\n## A {#a}\n\n```{r}\n#| label: counter\n#| include: false\ncat('x', file='executions.txt', append=TRUE)\n```\n\n::: {#body}\nOriginal.\n:::\n\n## B {#b}\n\n::: {#other}\nOther.\n:::\n";
async function fixture(
  plain = false,
  counterOutside = false,
  controlledFailure = false,
) {
  const dir = await Deno.makeTempDir({ prefix: "qb-component-test-" }),
    source = dir + "/deck.qmd";
  let text = plain
    ? original.replace("## A {#a}", "## A").replace(
      "::: {#body}\nOriginal.\n:::",
      "Original.",
    ).replace("## B {#b}", "## B").replace(
      "::: {#other}\nOther.\n:::",
      "Other.",
    )
    : original;
  if (counterOutside) {
    const counter = text.match(/```\{r\}[\s\S]*?```\n\n/)![0];
    text = text.replace(counter, "").replace("## A", counter + "## A");
  }
  if (controlledFailure) {
    text = text.replace(
      "cat('x', file='executions.txt', append=TRUE)",
      "if (file.exists('fail-render')) stop('controlled component render failure')\ncat('x', file='executions.txt', append=TRUE)",
    );
  }
  await Deno.writeTextFile(source, text);
  const first = await renderProject(source);
  return { dir, source, text, first: first.state };
}
async function create(
  f: Awaited<ReturnType<typeof fixture>>,
  kind: "card" | "kpi" = "kpi",
  state = f.first,
) {
  return await applyComponentAction(f.source, {
    action: "create",
    kind,
    slideId: state.emitted.slides[0].id,
    fields: kind === "card"
      ? { title: "Conclusion β", body: "An authored result." }
      : fields,
    revision: state.revision,
    expectedDocId: state.docId,
  });
}
function currentMember(
  state: ProjectState,
  intent: ComponentCreation,
  role: string,
) {
  const member = intent.members.find((member) => member.role === role)!;
  return state.emitted.slides.find((slide) => slide.id === intent.slideId)!
    .elements.find((element) => element.id === member.nativeId)!;
}
Deno.test("component source insertion preserves exact source boundaries and rejects executable or retyped roles", async () => {
  for (const kind of ["card", "kpi"] as const) {
    for (const newline of ["\n", "\r\n"]) {
      const roles = kind === "card"
        ? ["title", "body"] as const
        : ["label", "value", "detail"] as const;
      const operation = {
        type: "insert-component" as const,
        kind,
        slideId: "a",
        id: "new",
        fields: roles.map((role) => ({
          role,
          sourceId: `new-${role}`,
          markdown: `Text **β** ${role}`,
        })),
      };
      const source =
        "## A {#a}\n\n::: {#old}\nOld.\n:::\n\n<!-- qb:b -->\n## B\n"
          .replaceAll("\n", newline);
      const plan = previewStructure(scanSource(source), [operation]);
      eq(plan.steps[0].edits.length, 1);
      eq(plan.steps[0].edits[0].expected, "");
      eq(plan.steps[0].edits[0].span.start, plan.steps[0].edits[0].span.end);
      ok(plan.result.indexOf("#new") < plan.result.indexOf("<!-- qb:b -->"));
      if (newline === "\r\n") {
        eq(plan.result.replaceAll("\r\n", "").includes("\n"), false);
      }
      for (
        const markdown of [
          "`r system('x')`",
          "{{< x >}}",
          "::: {#nested}\nX\n:::",
          "One\n\nTwo",
          "$$x$$",
          "<!-- comment -->X",
        ]
      ) {
        const altered = clone(operation);
        altered.fields[0].markdown = markdown;
        await refuses(
          () => componentMarkdown(altered),
          "invalid-component-insertion",
        );
      }
      const extra = { ...operation, inferredGroupId: "old" };
      await refuses(
        () => componentMarkdown(extra),
        "invalid-component-insertion",
      );
    }
  }
});
Deno.test("real card/KPI creation edits save reopen exact sync render and HTML-free rebuild retain design with zero creation/preview execution", async () => {
  const f = await fixture();
  try {
    let state = await create(f, "card");
    state = await create(f, "kpi", state);
    eq(await Deno.readTextFile(f.source), original);
    eq(await Deno.readTextFile(f.dir + "/executions.txt"), "x");
    const edited = clone(state.emitted),
      intents = clone(state.componentCreations!);
    for (const intent of intents) {
      const slide = edited.slides.find((slide) => slide.id === intent.slideId)!;
      for (
        const element of slide.elements.filter((element) =>
          element.id === intent.backgroundId ||
          intent.members.some((member) => member.nativeId === element.id)
        )
      ) {
        element.x = Number(element.x) + 80;
        element.rotation = 4;
        element.opacity = .9;
        if (element.type === "text") {
          element.html = `<strong>${element.html}</strong>`;
          if (
            intent.kind === "kpi" && element.id === intent.members[1].nativeId
          ) {
            element.lineHeight = 1.6;
            element.h = 100;
          }
          element.color = "#123456";
          element.fx = { enter: "fade-up", enterDur: .42, step: 1 };
        } else {
          element.fill = "#ddeeff";
          element.radius = 23;
        }
      }
    }
    edited.slides[1].elements.push({
      ...clone(edited.slides[1].elements[1]),
      id: "unrelated-native",
      html: "Unrelated pending.",
    });
    state = await saveProject(f.source, edited, state.revision);
    eq(
      (await readProject(f.source)).componentCreations,
      state.componentCreations,
    );
    const chosen = state.pending.filter((pending) =>
      pending.target.slideId === "a"
    ).map((pending) => pending.id);
    const plan = await previewSync(f.source, chosen);
    eq(plan.componentApprovals?.length, 2);
    eq(plan.creationChangeIds.length, 5);
    eq(plan.excludedChangeIds.length, 1);
    eq(plan.patch.patches, []);
    ok(!/bento-(?:x|y|w|h|fill|radius)=/.test(plan.result));
    eq(await Deno.readTextFile(f.dir + "/executions.txt"), "x");
    eq(await Deno.readTextFile(f.source), original);
    const tampered = clone(plan);
    tampered.componentApprovals![0].intent.members[0].snapshot.html =
      "Tampered.";
    await refuses(() => applySync(f.source, tampered), "INVALID_PLAN");
    await applySync(f.source, plan);
    eq(await Deno.readTextFile(f.dir + "/executions.txt"), "x");
    eq((await readProject(f.source)).componentCreations?.length, 2);
    const rendered = await renderProject(f.source);
    eq(rendered.state.pending.length, 1);
    eq(rendered.state.componentCreations, undefined);
    eq(
      rendered.state.componentProjections?.map((record) => record.frame),
      intents.map((intent) => intent.projectionFrame),
    );
    eq(rendered.state.docId, f.first.docId);
    eq(rendered.state.bentoOnly.length, 0);
    const normalized = clone(edited);
    for (const slide of normalized.slides) {
      for (const element of slide.elements) {
        if (element.type === "text") {
          element.html = canonicalInlineHtml(String(element.html));
        }
      }
    }
    eq(rendered.state.emitted, normalized);
    eq(await Deno.readTextFile(f.dir + "/executions.txt"), "xx");
    await Deno.remove(f.source.replace(".qmd", ".bento.html"));
    const rebuilt = await renderProject(f.source);
    eq(rebuilt.state.emitted, normalized);
    eq(rebuilt.state.docId, f.first.docId);
    eq(await Deno.readTextFile(f.dir + "/executions.txt"), "xxx");
  } finally {
    await Deno.remove(f.dir, { recursive: true });
  }
});
Deno.test("pending component partial selection missing field/background and native retyping preserve recoverable snapshots and offer explicit restore/discard", async () => {
  const f = await fixture();
  try {
    let state = await create(f), intent = state.componentCreations![0];
    await refuses(
      () => previewSync(f.source, [state.pending[0].id]),
      "PARTIAL_COMPONENT_SELECTION",
    );
    const updated = clone(state.emitted),
      value = updated.slides[0].elements.find((element) =>
        element.id === intent.members[1].nativeId
      )!;
    value.html = "Edited <em>123</em>";
    value.x = 405;
    value.fontFamily = "serif";
    state = await saveProject(f.source, updated, state.revision);
    intent = state.componentCreations![0];
    const latestValue = clone(currentMember(state, intent, "value"));
    const missing = clone(state.emitted);
    missing.slides[0].elements = missing.slides[0].elements.filter((element) =>
      ![intent.members[1].nativeId, intent.backgroundId].includes(element.id)
    );
    state = await saveProject(f.source, missing, state.revision);
    eq(state.componentCreations![0].members[1].snapshot, latestValue);
    eq(
      (await readProject(f.source)).componentCreations,
      state.componentCreations,
    );
    await refuses(() => previewSync(f.source), "COMPONENT_INCOMPLETE");
    const beforeDeletionOrder = updated.slides[0].elements.map((element) =>
      element.id
    );
    const present = clone(state.emitted.slides[0].elements);
    state = await applyComponentAction(f.source, {
      action: "restore",
      id: intent.id,
      revision: state.revision,
      expectedDocId: state.docId,
    });
    eq(currentMember(state, intent, "value"), latestValue);
    eq(
      state.emitted.slides[0].elements.map((element) => element.id),
      beforeDeletionOrder,
    );
    eq(
      state.emitted.slides[0].elements.filter((element) =>
        present.some((old) => old.id === element.id)
      ),
      present,
    );
    const reorderedMissing = clone(state.emitted);
    const originalMembers = reorderedMissing.slides[0].elements.filter((
      element,
    ) => intent.members.some((member) => member.nativeId === element.id));
    reorderedMissing.slides[0].elements = reorderedMissing.slides[0].elements
      .filter((element) =>
        element.id !== intent.backgroundId &&
        !intent.members.some((member) => member.nativeId === element.id)
      );
    reorderedMissing.slides[0].elements.push(...originalMembers.reverse());
    state = await saveProject(f.source, reorderedMissing, state.revision);
    state = await applyComponentAction(f.source, {
      action: "restore",
      id: intent.id,
      revision: state.revision,
      expectedDocId: state.docId,
    });
    const repaired = state.emitted.slides[0].elements;
    const backgroundPosition = repaired.findIndex((element) =>
      element.id === intent.backgroundId
    );
    ok(
      intent.members.every((member) =>
        repaired.findIndex((element) => element.id === member.nativeId) >
          backgroundPosition
      ),
    );
    eq(
      repaired.filter((element) => element.id !== intent.backgroundId),
      reorderedMissing.slides[0].elements,
    );
    const retyped = clone(state.emitted);
    const body = retyped.slides[0].elements.find((element) =>
      element.id === intent.members[1].nativeId
    )!;
    const validSnapshot = clone(body);
    for (const key of Object.keys(body)) {
      if (
        !["id", "x", "y", "w", "h", "rotation", "opacity", "groupId"].includes(
          key,
        )
      ) delete body[key];
    }
    body.type = "shape";
    body.shape = "rect";
    body.fill = "#000000";
    state = await saveProject(f.source, retyped, state.revision);
    eq(state.componentCreations![0].members[1].snapshot, validSnapshot);
    await refuses(() => previewSync(f.source), "COMPONENT_INCOMPLETE");
    const extra = clone(state.emitted);
    extra.slides[0].elements.push({
      ...clone(validSnapshot),
      id: "extra-group-member",
      groupId: intent.id,
    });
    state = await saveProject(f.source, extra, state.revision);
    state = await applyComponentAction(f.source, {
      action: "discard",
      id: intent.id,
      revision: state.revision,
      expectedDocId: state.docId,
    });
    eq(state.componentCreations, undefined);
    ok(
      state.emitted.slides[0].elements.some((element) =>
        element.id === "extra-group-member"
      ),
    );
    eq(await Deno.readTextFile(f.source), original);
    eq(await Deno.readTextFile(f.dir + "/executions.txt"), "x");
  } finally {
    await Deno.remove(f.dir, { recursive: true });
  }
});
Deno.test("containing slide deletion retains pending component and restores it; approved parent deletion retires only its exact children", async () => {
  const f = await fixture(false, true);
  try {
    let state = await create(f);
    const intent = state.componentCreations![0];
    const savedSlide = clone(state.emitted.slides[0]);
    state = await applySlideAction(f.source, {
      action: "delete",
      slideId: "a",
      revision: state.revision,
      expectedDocId: state.docId,
    });
    eq(state.componentCreations![0], intent);
    eq(
      state.pending.filter((pending) => pending.kind === "create-element")
        .length,
      3,
    );
    eq(state.bentoOnly.length, 1);
    await refuses(
      () =>
        applyComponentAction(f.source, {
          action: "restore",
          id: intent.id,
          revision: state.revision,
          expectedDocId: state.docId,
        }),
      "COMPONENT_PARENT_MISSING",
    );
    state = await applySlideAction(f.source, {
      action: "restore",
      slideId: "a",
      revision: state.revision,
      expectedDocId: state.docId,
    });
    eq(state.emitted.slides[0], savedSlide);
    // This parent has a computation; its deletion is correctly refused. Use an authored-only slide instead.
    state = await applyComponentAction(f.source, {
      action: "create",
      kind: "card",
      slideId: "b",
      fields: { title: "Delete later", body: "Pending content" },
      revision: state.revision,
      expectedDocId: state.docId,
    });
    const second = state.componentCreations!.find((item) =>
      item.slideId === "b"
    )!;
    state = await applySlideAction(f.source, {
      action: "delete",
      slideId: "b",
      revision: state.revision,
      expectedDocId: state.docId,
    });
    const deletion = state.pending.find((pending) =>
      pending.kind === "delete-slide"
    )!;
    await refuses(
      () =>
        previewSync(f.source, [deletion.id], {
          confirmedDeleteIds: [deletion.id],
        }),
      "PARTIAL_DELETE_SELECTION",
    );
    const affected = state.pending.filter((pending) =>
      pending.target.slideId === "b"
    ).map((pending) => pending.id);
    const plan = await previewSync(f.source, affected, {
      confirmedDeleteIds: [deletion.id],
    });
    eq(plan.componentRetirements?.map((item) => item.id), [second.id]);
    await applySync(f.source, plan);
    const rendered = await renderProject(f.source);
    eq(rendered.state.componentCreations?.map((item) => item.id), [intent.id]);
    eq(
      rendered.state.pending.filter((pending) =>
        pending.kind === "create-element"
      ).length,
      3,
    );
    ok(!rendered.state.emitted.slides.some((slide) => slide.id === "b"));
  } finally {
    await Deno.remove(f.dir, { recursive: true });
  }
});
Deno.test("component source/approval guards reject stale state unknown schema computed injection and lack of fresh role proof before consuming pending", async () => {
  const f = await fixture();
  try {
    let state = await create(f);
    const intent = state.componentCreations![0];
    await refuses(
      () =>
        applyComponentAction(f.source, {
          action: "create",
          kind: "kpi",
          slideId: "a",
          fields,
          revision: f.first.revision,
          expectedDocId: state.docId,
        }),
      "STALE_REVISION",
    );
    await refuses(
      () =>
        applyComponentAction(f.source, {
          action: "create",
          kind: "kpi",
          slideId: "a",
          fields,
          revision: state.revision,
          expectedDocId: "foreign",
        }),
      "UNRELATED_DOCUMENT",
    );
    const malformed = clone(state) as ProjectState & {
      componentCreations: unknown[];
    };
    Object.assign(malformed.componentCreations[0], { inferredGroup: true });
    await refuses(() => validateState(malformed), "INVALID_COMPONENT_INTENT");
    const largeOrder = clone(state);
    largeOrder.componentCreations![0].restoreOrder.push(
      ...Array.from({ length: 1100 }, (_, index) => `unrelated-${index}`),
    );
    validateState(largeOrder);
    const overlap = clone(state);
    overlap.componentCreations!.push(clone(intent));
    await refuses(() => validateState(overlap), "INVALID_COMPONENT_INTENT");
    const incompatible = clone(state.emitted);
    incompatible.slides[0].elements.find((element) =>
      element.id === intent.members[1].nativeId
    )!.html = "<strong>123</strong>";
    state = await saveProject(f.source, incompatible, state.revision);
    const retainedTypography = await Deno.readTextFile(
      f.dir + "/.qbento/state.json",
    );
    await refuses(() => previewSync(f.source), "KPI_TYPOGRAPHY_UNSUPPORTED");
    eq(await Deno.readTextFile(f.source), original);
    eq(
      await Deno.readTextFile(f.dir + "/.qbento/state.json"),
      retainedTypography,
    );
    incompatible.slides[0].elements.find((element) =>
      element.id === intent.members[1].nativeId
    )!.html = fields.value;
    state = await saveProject(f.source, incompatible, state.revision);
    const plan = await previewSync(f.source);
    const changed = clone(state.emitted);
    changed.slides[0].elements.find((element) =>
      element.id === intent.members[1].nativeId
    )!.x = 204;
    state = await saveProject(f.source, changed, state.revision);
    await refuses(() => applySync(f.source, plan), "STALE_REVISION");
    await Deno.writeTextFile(f.source, original + "\n");
    await refuses(() => previewSync(f.source), "STALE_SOURCE");
    await Deno.writeTextFile(f.source, original);
    const injected = clone(state.emitted);
    injected.slides[0].elements.find((element) =>
      element.id === intent.members[1].nativeId
    )!.html = '<code>r system("x")</code>';
    state = await saveProject(f.source, injected, state.revision);
    const bytes = await Deno.readTextFile(f.dir + "/.qbento/state.json");
    await refuses(() => previewSync(f.source), "invalid-component-insertion");
    eq(await Deno.readTextFile(f.dir + "/.qbento/state.json"), bytes);
    eq(await Deno.readTextFile(f.source), original);
    eq(await Deno.readTextFile(f.dir + "/executions.txt"), "x");
    injected.slides[0].elements.find((element) =>
      element.id === intent.members[1].nativeId
    )!.html = "200";
    state = await saveProject(f.source, injected, state.revision);
    await applySync(f.source, await previewSync(f.source));
    const after = await readProject(f.source),
      envelope = JSON.parse(
        await Deno.readTextFile(f.dir + "/.qbento/sync-approved.json"),
      );
    await refuses(
      async () =>
        prepareApprovedSync(
          after,
          after.emitted,
          hashSource(await Deno.readTextFile(f.source)),
          envelope,
        ),
      "COMPONENT_PROMOTION_PROOF",
    );
    eq(
      (await readProject(f.source)).componentCreations,
      after.componentCreations,
    );
    const mutated = clone(after);
    mutated.componentCreations![0].backgroundSnapshot.x = 12;
    await new StateStore(f.dir + "/.qbento").save(mutated, after.revision);
    await refuses(() => renderProject(f.source), "STALE_APPROVAL");
    eq((await readProject(f.source)).componentCreations?.length, 1);
  } finally {
    await Deno.remove(f.dir, { recursive: true });
  }
});

Deno.test("plain QMD Studio component creation saves source unchanged and acquires exact existing identities only in reviewed sync", async () => {
  const f = await fixture(true);
  try {
    let state = await create(f, "card");
    const intent = state.componentCreations![0];
    eq(await Deno.readTextFile(f.source), f.text);
    eq(await Deno.readTextFile(f.dir + "/executions.txt"), "x");
    const plan = await previewSync(f.source);
    ok(plan.identities?.bindings.length);
    eq(plan.componentApprovals?.length, 1);
    ok(
      plan.identities!.bindings.some((binding) =>
        binding.newBlockId === intent.slideId
      ),
    );
    eq(await Deno.readTextFile(f.source), f.text);
    eq(await Deno.readTextFile(f.dir + "/executions.txt"), "x");
    await applySync(f.source, plan);
    state = (await renderProject(f.source)).state;
    eq(state.componentCreations, undefined);
    eq(state.pending, []);
    eq(state.emitted.slides[0].id, intent.slideId);
    eq(state.docId, f.first.docId);
    for (const member of intent.members) {
      eq(currentMember(state, intent, member.role), member.snapshot);
    }
    eq(await Deno.readTextFile(f.dir + "/executions.txt"), "xx");
  } finally {
    await Deno.remove(f.dir, { recursive: true });
  }
});

Deno.test("approved creation frame stays independent from native background-only edits and retires only under exact parent deletion", async () => {
  const f = await fixture(true, true);
  try {
    let state = await create(f);
    const first = clone(state.componentCreations![0]);
    state = await applyComponentAction(f.source, {
      action: "create",
      kind: "card",
      slideId: state.emitted.slides[1].id,
      fields: { title: "Visible title", body: "Authored body" },
      revision: state.revision,
      expectedDocId: state.docId,
    });
    const intents = clone(state.componentCreations!);
    const edited = clone(state.emitted);
    for (const intent of intents) {
      const background = edited.slides.find((slide) =>
        slide.id === intent.slideId
      )!
        .elements.find((element) => element.id === intent.backgroundId)!;
      background.x = Number(background.x) + 100;
      background.y = Number(background.y) + 40;
      background.w = 120;
      background.h = 60;
    }
    state = await saveProject(f.source, edited, state.revision);
    eq(
      state.componentCreations?.map((intent) => intent.projectionFrame),
      intents.map((intent) => intent.projectionFrame),
    );
    eq(await Deno.readTextFile(f.dir + "/executions.txt"), "x");
    await applySync(f.source, await previewSync(f.source));
    eq(await Deno.readTextFile(f.dir + "/executions.txt"), "x");
    state = (await renderProject(f.source)).state;
    eq(state.emitted, edited);
    eq(state.componentProjections?.length, 2);
    const unknown = clone(state);
    Object.assign(unknown.componentProjections![0], { guessedFromGroup: true });
    await refuses(() => validateState(unknown), "INVALID_COMPONENT_PROJECTION");
    const overlapping = clone(state);
    overlapping.componentProjections!.push(
      clone(overlapping.componentProjections![0]),
    );
    await refuses(
      () => validateState(overlapping),
      "INVALID_COMPONENT_PROJECTION",
    );
    const moved = clone(state.emitted);
    for (const intent of intents) {
      const background = moved.slides.find((slide) =>
        slide.id === intent.slideId
      )!
        .elements.find((element) => element.id === intent.backgroundId)!;
      background.x = Number(background.x) - 60;
      background.y = Number(background.y) + 30;
      background.w = 80;
      background.h = 10;
    }
    state = await saveProject(f.source, moved, state.revision);
    eq((await renderProject(f.source)).state.emitted, moved);
    await Deno.remove(f.source.replace(".qmd", ".bento.html"));
    state = (await renderProject(f.source)).state;
    eq(state.emitted, moved);
    eq(await Deno.readTextFile(f.dir + "/executions.txt"), "xxxx");
    const source = await Deno.readTextFile(f.source),
      before = await Deno.readTextFile(f.dir + "/.qbento/state.json");
    await Deno.writeTextFile(
      f.source,
      source.replace(
        `.bento-${first.kind}}`,
        `.bento-${first.kind} w="80" h="10"}`,
      ),
    );
    await refuses(() => renderProject(f.source), "KPI_CONTENT_OVERFLOW");
    eq(await Deno.readTextFile(f.dir + "/.qbento/state.json"), before);
    await Deno.writeTextFile(f.source, source);
    const second = state.componentProjections![1];
    state = await applySlideAction(f.source, {
      action: "delete",
      slideId: second.slideId,
      revision: state.revision,
      expectedDocId: state.docId,
    });
    const deletion = state.pending.find((pending) =>
      pending.kind === "delete-slide"
    )!;
    const plan = await previewSync(f.source, [deletion.id], {
      confirmedDeleteIds: [deletion.id],
    });
    eq(plan.componentProjectionRetirements, [second]);
    await applySync(f.source, plan);
    const approvedState = await readProject(f.source);
    const approval = JSON.parse(
      await Deno.readTextFile(f.dir + "/.qbento/sync-approved.json"),
    );
    const changed = clone(approvedState);
    changed.componentProjections![0].frame.h = 469;
    await refuses(
      () =>
        prepareApprovedSync(
          changed,
          changed.emitted,
          hashSource(plan.result),
          approval,
        ),
      "STALE_APPROVAL",
    );
    state = (await renderProject(f.source)).state;
    eq(state.componentProjections?.map((record) => record.id), [first.id]);
    ok(!state.emitted.slides.some((slide) => slide.id === second.slideId));
  } finally {
    await Deno.remove(f.dir, { recursive: true });
  }
});

Deno.test("source-authored conversion of a promoted KPI value to computation keeps its saved bootstrap and cannot forge authored promotion", async () => {
  const f = await fixture();
  try {
    let state = await create(f);
    const intent = clone(state.componentCreations![0]);
    await applySync(f.source, await previewSync(f.source));
    state = (await renderProject(f.source)).state;
    const native = clone(state.emitted);
    const source = await Deno.readTextFile(f.source);
    await Deno.writeTextFile(
      f.source,
      source.replace("\n123\n", "\n`r 123 + 1`\n"),
    );
    state = (await renderProject(f.source)).state;
    const value = currentMember(state, intent, "value");
    eq(value.html, "124");
    const expected = clone(native);
    expected.slides[0].elements.find((element) => element.id === value.id)!
      .html = "124";
    eq(state.emitted, expected);
    eq(state.componentProjections?.[0].frame, intent.projectionFrame);
    eq(
      state.provenance[JSON.stringify([intent.slideId, value.id])].origin,
      "computed",
    );
    const edited = clone(state.emitted);
    edited.slides[0].elements.find((element) => element.id === value.id)!.html =
      "999";
    state = await saveProject(f.source, edited, state.revision);
    ok(
      state.pending.some((pending) =>
        pending.origin === "computed" && pending.status === "conflict"
      ),
    );
    const computedSource = await Deno.readTextFile(f.source);
    await refuses(() => previewSync(f.source), "SYNC_CONFLICT");
    eq(await Deno.readTextFile(f.source), computedSource);
    eq(state.componentCreations, undefined);
  } finally {
    await Deno.remove(f.dir, { recursive: true });
  }
});

Deno.test("failed approved component execution preserves pending snapshots approval and published HTML for a checked retry", async () => {
  const f = await fixture(false, false, true);
  try {
    const created = await create(f), expected = clone(created.emitted);
    const plan = await previewSync(f.source);
    await applySync(f.source, plan);
    const saved = await Deno.readTextFile(f.dir + "/.qbento/state.json"),
      approval = await Deno.readTextFile(f.dir + "/.qbento/sync-approved.json"),
      source = await Deno.readTextFile(f.source),
      output = await Deno.readTextFile(f.source.replace(".qmd", ".bento.html"));
    eq(await Deno.readTextFile(f.dir + "/executions.txt"), "x");
    await Deno.writeTextFile(f.dir + "/fail-render", "controlled test failure");
    await refuses(() => renderProject(f.source), "QUARTO_FAILED");
    eq(await Deno.readTextFile(f.dir + "/.qbento/state.json"), saved);
    eq(
      await Deno.readTextFile(f.dir + "/.qbento/sync-approved.json"),
      approval,
    );
    eq(await Deno.readTextFile(f.source), source);
    eq(
      await Deno.readTextFile(f.source.replace(".qmd", ".bento.html")),
      output,
    );
    eq(await Deno.readTextFile(f.dir + "/executions.txt"), "x");
    eq(
      (await readProject(f.source)).componentCreations,
      created.componentCreations,
    );
    await Deno.remove(f.dir + "/fail-render");
    const completed = (await renderProject(f.source)).state;
    eq(completed.emitted, expected);
    eq(completed.componentCreations, undefined);
    eq(completed.componentProjections?.length, 1);
    eq(completed.pending.length, 0);
    eq(await Deno.readTextFile(f.dir + "/executions.txt"), "xx");
    let exists = true;
    try {
      await Deno.stat(f.dir + "/.qbento/sync-approved.json");
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) throw error;
      exists = false;
    }
    eq(exists, false);
  } finally {
    await Deno.remove(f.dir, { recursive: true });
  }
});
