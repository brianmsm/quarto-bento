import {
  readProject,
  renderProject,
  saveProject,
} from "../src/core/project.ts";
import { applySlideAction } from "../src/core/slide-actions.ts";
import { applySync, previewSync } from "../src/core/sync.ts";
import { startStudio } from "../src/studio/server.ts";
import {
  canonical,
  captureEdits,
  createState,
  validateState,
} from "../src/state/mod.ts";

function assert(ok: unknown, message = "assertion failed"): asserts ok {
  if (!ok) throw new Error(message);
}
async function refuses(fn: () => Promise<unknown>, code: string) {
  try {
    await fn();
  } catch (error) {
    assert(
      String(error).includes(code) ||
        (error as { code?: string }).code === code,
      String(error),
    );
    return;
  }
  throw new Error(`Expected ${code}`);
}
async function fixture(computed = false) {
  const directory = await Deno.makeTempDir({ prefix: "qbento-slide-actions-" });
  const source = directory + "/deck.qmd";
  const text = `## Start {#start}

${
    computed
      ? `\`\`\`{r}
#| label: fig-values
#| echo: false
#| dev: svg
plot(1:3)
\`\`\`
`
      : "::: {#startbody}\nStart text.\n:::\n"
  }
## Appendix {#appendix}

::: {#body}
Original text.
:::

## End {#end}

::: {#endbody}
End text.
:::
`;
  await Deno.writeTextFile(source, text);
  const initial = await renderProject(source);
  return { directory, source, text, initial: initial.state };
}
const canRun =
  (await Deno.permissions.query({ name: "run" })).state === "granted";
const canServe =
  (await Deno.permissions.query({ name: "net", host: "127.0.0.1" })).state ===
    "granted";

Deno.test("retiring an unsourced native creation does not become a source deletion", () => {
  const initial = createState({
    docId: "deck",
    slides: [{ id: "base", elements: [] }],
  });
  const edited = structuredClone(initial.emitted);
  edited.slides.push({ id: "fresh", elements: [] });
  const created = captureEdits(initial, edited);
  const cancelled = captureEdits(created, initial.emitted);
  validateState(cancelled);
  assert(cancelled.pending.length === 0);
  assert(canonical(cancelled.emitted) === canonical(initial.emitted));
});

Deno.test({
  name: "pending restoration retains the observed manual order across renders",
  ignore: !canRun,
  fn: async () => {
    const f = await fixture();
    try {
      const edited = structuredClone(f.initial.emitted);
      edited.slides = ["end", "start", "appendix"].map((id) =>
        edited.slides.find((slide) => slide.id === id)!
      );
      let state = await saveProject(f.source, edited, f.initial.revision);
      const nativeDeleted = structuredClone(state.emitted);
      nativeDeleted.slides = nativeDeleted.slides.filter((slide) =>
        slide.id !== "appendix"
      );
      state = await saveProject(f.source, nativeDeleted, state.revision);
      assert(
        canonical(
          state.pending.find((change) => change.kind === "delete-slide")
            ?.restoreOrder,
        ) === canonical(["end", "start", "appendix"]),
        "direct native removal did not retain the observed order",
      );
      state = (await renderProject(f.source)).state;
      state = await applySlideAction(f.source, {
        action: "restore",
        slideId: "appendix",
        revision: state.revision,
      });
      assert(
        canonical(state.emitted.slides.map((slide) => slide.id)) ===
          canonical(["end", "start", "appendix"]),
        "restoration lost the pre-deletion order",
      );
      state = await applySlideAction(f.source, {
        action: "delete",
        slideId: "appendix",
        revision: state.revision,
      });
      const reordered = structuredClone(state.emitted);
      reordered.slides.reverse();
      state = await saveProject(f.source, reordered, state.revision);
      state = (await renderProject(f.source)).state;
      state = await applySlideAction(f.source, {
        action: "restore",
        slideId: "appendix",
        revision: state.revision,
      });
      assert(
        canonical(state.emitted.slides.map((slide) => slide.id)) ===
          canonical(["start", "appendix", "end"]),
        "restoration reordered surviving slides",
      );
      assert(await Deno.readTextFile(f.source) === f.text);
    } finally {
      await Deno.remove(f.directory, { recursive: true });
    }
  },
});

Deno.test({
  name:
    "hide/show and pending deletion restore preserve design and semantic edits through actual renders",
  ignore: !canRun,
  fn: async () => {
    const f = await fixture(true);
    try {
      const edited = structuredClone(f.initial.emitted);
      const appendix = edited.slides.find((slide) => slide.id === "appendix")!;
      const body = appendix.elements.find((element) =>
        element.id === "body/paragraph:1"
      )!;
      body.html = "Pending text.";
      body.x = 211;
      appendix.elements.push({
        id: "decoration",
        type: "shape",
        shape: "rect",
        fill: "#123456",
        x: 70,
        y: 80,
        w: 100,
        h: 50,
      });
      let state = await saveProject(f.source, edited, f.initial.revision);
      const pendingText = state.pending.find((change) =>
        change.path[0] === "html"
      )!;
      state = await applySlideAction(f.source, {
        action: "hide",
        slideId: "appendix",
        revision: state.revision,
      });
      assert(
        state.emitted.slides.find((slide) => slide.id === "appendix")
          ?.hidden === true,
      );
      assert(await Deno.readTextFile(f.source) === f.text);
      assert(state.pending.length === 1, "hidden became a semantic edit");
      await refuses(() =>
        applySlideAction(f.source, {
          action: "show",
          slideId: "appendix",
          revision: f.initial.revision,
        }), "STALE_REVISION");
      state = (await renderProject(f.source)).state;
      assert(
        state.emitted.slides.find((slide) => slide.id === "appendix")
          ?.hidden === true,
      );
      assert(state.pending.some((change) => change.id === pendingText.id));
      state = await applySlideAction(f.source, {
        action: "show",
        slideId: "appendix",
        revision: state.revision,
      });
      assert(
        !state.emitted.slides.find((slide) => slide.id === "appendix")?.hidden,
      );

      const beforeDeletion = canonical(
        state.emitted.slides.find((slide) => slide.id === "appendix"),
      );
      state = await applySlideAction(f.source, {
        action: "delete",
        slideId: "appendix",
        revision: state.revision,
      });
      assert(!state.emitted.slides.some((slide) => slide.id === "appendix"));
      assert(await Deno.readTextFile(f.source) === f.text);
      state = (await renderProject(f.source)).state;
      assert(!state.emitted.slides.some((slide) => slide.id === "appendix"));
      state = await applySlideAction(f.source, {
        action: "restore",
        slideId: "appendix",
        revision: state.revision,
      });
      assert(
        canonical(
          state.emitted.slides.find((slide) => slide.id === "appendix"),
        ) === beforeDeletion,
      );
      assert(state.pending.some((change) => change.id === pendingText.id));
      assert(!state.pending.some((change) => change.kind === "delete-slide"));
      assert(
        canonical((await readProject(f.source)).emitted) ===
          canonical(state.emitted),
      );

      state = await applySlideAction(f.source, {
        action: "delete",
        slideId: "appendix",
        revision: state.revision,
      });
      const deletion = state.pending.find((change) =>
        change.kind === "delete-slide"
      )!;
      await refuses(() => previewSync(f.source), "CONFIRM_DELETE_REQUIRED");
      const plan = await previewSync(f.source, undefined, {
        confirmedDeleteIds: [deletion.id],
      });
      assert(
        plan.structure?.steps.some((step) =>
          step.operation.type === "delete-slide" &&
          step.edits[0].expected.includes("## Appendix")
        ),
      );
      await applySync(f.source, plan);
      state = await readProject(f.source);
      await refuses(
        () =>
          applySlideAction(f.source, {
            action: "restore",
            slideId: "appendix",
            revision: state.revision,
          }),
        "SLIDE_SOURCE_REMOVED",
      );
      state = (await renderProject(f.source)).state;
      assert(!state.emitted.slides.some((slide) => slide.id === "appendix"));
      assert(state.pending.length === 0);
      assert(
        !state.overrides.some((overlay) =>
          overlay.target.slideId === "appendix"
        ),
      );
      assert(!state.bentoOnly.some((item) => item.slideId === "appendix"));
      assert(state.docId === f.initial.docId);
    } finally {
      await Deno.remove(f.directory, { recursive: true });
    }
  },
});

Deno.test({
  name:
    "slide actions refuse computed producers, referenced slides and invalid targets without writes",
  ignore: !canRun,
  fn: async () => {
    const f = await fixture(true);
    try {
      const attempt = (slideId: string) =>
        applySlideAction(f.source, {
          action: "delete",
          slideId,
          revision: f.initial.revision,
        });
      await refuses(() => attempt("start"), "unsafe-delete");
      await refuses(() => attempt("missing"), "SLIDE_NOT_FOUND");
      await Deno.writeTextFile(f.source, f.text + "\nSee @body.\n");
      await refuses(() => attempt("appendix"), "shared-reference");
      await Deno.writeTextFile(f.source, f.text);
      assert(canonical(await readProject(f.source)) === canonical(f.initial));
      const linked = structuredClone(f.initial.emitted);
      linked.slides[2].elements[0].link = "appendix";
      const state = await saveProject(f.source, linked, f.initial.revision);
      await refuses(
        () =>
          applySlideAction(f.source, {
            action: "delete",
            slideId: "appendix",
            revision: state.revision,
          }),
        "SLIDE_IN_USE",
      );
      assert(canonical(await readProject(f.source)) === canonical(state));
      assert(await Deno.readTextFile(f.source) === f.text);
      const created = structuredClone(state.emitted);
      created.slides.push({
        ...structuredClone(created.slides[1]),
        id: "fresh",
      });
      const withCreation = await saveProject(f.source, created, state.revision);
      await refuses(() =>
        applySlideAction(f.source, {
          action: "delete",
          slideId: "fresh",
          revision: withCreation.revision,
        }), "SLIDE_NOT_SOURCED");
      const hidden = await applySlideAction(f.source, {
        action: "hide",
        slideId: "fresh",
        revision: withCreation.revision,
      });
      assert(
        hidden.emitted.slides.find((slide) => slide.id === "fresh")?.hidden ===
          true,
      );
      assert(
        hidden.pending.some((change) =>
          change.kind === "create-slide" && change.target.slideId === "fresh"
        ),
      );
    } finally {
      await Deno.remove(f.directory, { recursive: true });
    }
  },
});

Deno.test({
  name:
    "Studio API requires separate source-delete confirmation after a reversible slide action",
  ignore: !canRun || !canServe,
  fn: async () => {
    const f = await fixture();
    const studio = await startStudio(f.source);
    try {
      const page = await (await fetch(studio.url)).text();
      const token = JSON.parse(page.match(/qbentoToken\s*=\s*("[^"]+")/)![1]);
      const post = async (path: string, payload: unknown) => {
        const response = await fetch(studio.url + "/api/" + path, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-qbento-token": token,
          },
          body: JSON.stringify(payload),
        });
        return { status: response.status, body: await response.json() };
      };
      const request = {
        action: "delete",
        slideId: "appendix",
        revision: f.initial.revision,
        expectedDocId: f.initial.docId,
      };
      let response = await post("slides/action", {
        ...request,
        expectedDocId: undefined,
      });
      assert(
        response.status === 409 &&
          response.body.error === "INVALID_SLIDE_ACTION",
      );
      response = await post("slides/action", {
        ...request,
        expectedDocId: "another-document",
      });
      assert(
        response.status === 409 &&
          response.body.error === "UNRELATED_DOCUMENT",
      );
      assert((await readProject(f.source)).revision === f.initial.revision);
      assert(await Deno.readTextFile(f.source) === f.text);
      response = await post("slides/action", request);
      assert(response.status === 200);
      const state = await readProject(f.source);
      const deletion = state.pending.find((change) =>
        change.kind === "delete-slide"
      )!;
      response = await post("sync/preview", {});
      assert(
        response.status === 409 &&
          response.body.error === "CONFIRM_DELETE_REQUIRED",
      );
      assert(await Deno.readTextFile(f.source) === f.text);
      response = await post("sync/preview", {
        confirmedDeleteIds: [deletion.id],
      });
      assert(response.status === 200);
      assert(response.body.confirmedDeleteIds[0] === deletion.id);
      assert(await Deno.readTextFile(f.source) === f.text);
      response = await post("sync/apply", response.body);
      assert(response.status === 200);
      assert(!(await Deno.readTextFile(f.source)).includes("## Appendix"));
      response = await post("render", {});
      assert(response.status === 200);
      assert((await readProject(f.source)).pending.length === 0);
      const current = await readProject(f.source);
      response = await post("slides/action", {
        action: "delete",
        slideId: "end",
        revision: current.revision,
        expectedDocId: current.docId,
      });
      assert(response.status === 200);
      response = await post("slides/action", {
        action: "delete",
        slideId: "start",
        revision: response.body.revision,
        expectedDocId: current.docId,
      });
      assert(
        response.status === 409 &&
          response.body.error === "LAST_SLIDE_REQUIRED",
      );
      assert((await Deno.readTextFile(f.source)).includes("## End"));
    } finally {
      await studio.shutdown();
      await Deno.remove(f.directory, { recursive: true });
    }
  },
});
