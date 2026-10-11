import { withProject } from "./project.ts";
import {
  assertOutputUnchanged,
  captureEdits,
  clone,
  compose,
  equal,
  StateError,
} from "../state/mod.ts";
import { scanSource } from "../source/mod.ts";
import { previewStructure } from "../source/structure.ts";
import { assertProjectDocument } from "../render/validate.ts";

export interface SlideActionRequest {
  action: "hide" | "show" | "delete" | "restore";
  slideId: string;
  revision: number;
}

/** Save reversible slide actions; source deletion belongs only to reviewed sync. */
export async function applySlideAction(
  source: string,
  request: SlideActionRequest,
) {
  if (
    !request ||
    !["hide", "show", "delete", "restore"].includes(request.action) ||
    typeof request.slideId !== "string" || !request.slideId ||
    !Number.isSafeInteger(request.revision)
  ) throw new StateError("INVALID_SLIDE_ACTION", "Invalid slide action.");
  return await withProject(source, async (paths, store) => {
    const state = await store.load();
    if (!state) {
      throw new StateError("NO_BASELINE", "Render the project first.");
    }
    if (state.revision !== request.revision) {
      throw new StateError("STALE_REVISION", "Reload before changing slides.");
    }
    await assertOutputUnchanged(state, paths.output);
    const doc = clone(state.emitted);
    const slide = doc.slides.find((item) => item.id === request.slideId);
    if (request.action === "restore") {
      const deletion = state.pending.find((change) =>
        change.kind === "delete-slide" &&
        change.target.slideId === request.slideId
      );
      if (slide || !deletion) {
        throw new StateError(
          "SLIDE_NOT_DELETED",
          "No pending deletion to restore.",
        );
      }
      if (
        !scanSource(await Deno.readTextFile(paths.source)).slides.some((item) =>
          item.id === request.slideId
        )
      ) {
        throw new StateError(
          "SLIDE_SOURCE_REMOVED",
          "This slide is already absent from QMD. Recalculate or recover its source from history before restoring it.",
        );
      }
      // Compose the retained design and semantic journal; restoring the raw
      // baseline alone would lose edits made before the slide was removed.
      const recoverable = clone(state);
      recoverable.pending = recoverable.pending.filter((change) =>
        change.id !== deletion.id
      );
      const restored = compose(
        recoverable,
        state.generatedBaseline,
        undefined,
        undefined,
        { strict: false },
      ).document.slides.find((item) => item.id === request.slideId);
      if (!restored) {
        throw new StateError(
          "SLIDE_NOT_RECOVERABLE",
          "Retained slide is unavailable.",
        );
      }
      const originalOrder = deletion.restoreOrder ??
        state.generatedBaseline.slides.map((item) => item.id);
      const position = originalOrder.indexOf(restored.id);
      // Prefer the closest surviving successor, then predecessor. Retain the
      // current relative order of survivors if they were reordered meanwhile.
      const following = originalOrder.slice(position + 1).find((id) =>
        doc.slides.some((item) => item.id === id)
      );
      const preceding = originalOrder.slice(0, position).reverse().find((id) =>
        doc.slides.some((item) => item.id === id)
      );
      const index = following
        ? doc.slides.findIndex((item) => item.id === following)
        : preceding
        ? doc.slides.findIndex((item) => item.id === preceding) + 1
        : doc.slides.length;
      doc.slides.splice(index, 0, restored);
    } else {
      if (!slide) {
        throw new StateError("SLIDE_NOT_FOUND", "Slide is unavailable.");
      }
      if (request.action === "delete") {
        if (doc.slides.length === 1) {
          throw new StateError(
            "LAST_SLIDE_REQUIRED",
            "Keep one slide in the editable deck; hide this slide instead.",
          );
        }
        if (
          !state.generatedBaseline.slides.some((item) => item.id === slide.id)
        ) {
          throw new StateError(
            "SLIDE_NOT_SOURCED",
            "Sync this new slide before marking a QMD deletion; you can hide it now.",
          );
        }
        if (
          doc.slides.some((item) =>
            item.id !== slide.id && (item.stateOf === slide.id ||
              item.elements.some((element) => element.link === slide.id))
          )
        ) {
          throw new StateError(
            "SLIDE_IN_USE",
            "Another slide links to this slide. Resolve the links or hide it.",
          );
        }
        // Check safety without writing source or granting sync approval.
        // The subsequent source preview/apply repeats these checks independently.
        previewStructure(scanSource(await Deno.readTextFile(paths.source)), [{
          type: "delete-slide",
          id: slide.id,
          confirmed: true,
        }]);
        doc.slides = doc.slides.filter((item) => item.id !== slide.id);
      } else {
        if (request.action === "hide") slide.hidden = true;
        else delete slide.hidden;
      }
    }
    assertProjectDocument(doc);
    if (equal(doc, state.emitted)) return state;
    return await store.save(captureEdits(state, doc));
  });
}
