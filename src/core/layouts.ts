/** Explicit, design-only application of reusable layout definitions to saved objects. */
import { withProject } from "./project.ts";
import { hashSource, scanSource } from "../source/mod.ts";
import { builtinLayouts, type Frame } from "../render/design.ts";
import {
  assertDesignRegistryUnchanged,
  readDesignRegistry,
} from "../render/registry.ts";
import { nativeLayoutFrame } from "../render/native-layout.ts";
import { assertProjectDocument } from "../render/validate.ts";
import {
  assertOutputUnchanged,
  captureEdits,
  equal,
  type ProjectState,
  StateError,
  targetKey,
} from "../state/mod.ts";
export interface LayoutRequest {
  expectedDocId: string;
  expectedRevision: number;
  expectedSourceHash: string;
  expectedRegistryHash: string | null;
  slideId: string;
  layout: string;
  /** Ordered explicit native IDs per column; no automatic membership matching. */
  columns: string[][];
}
function fail(code: string, message: string): never {
  throw new StateError(code, message);
}
function requestShape(request: LayoutRequest) {
  if (
    !request || typeof request !== "object" || Array.isArray(request) ||
    Object.keys(request).sort().join(",") !==
      "columns,expectedDocId,expectedRegistryHash,expectedRevision,expectedSourceHash,layout,slideId" ||
    typeof request.expectedDocId !== "string" || !request.expectedDocId ||
    !Number.isSafeInteger(request.expectedRevision) ||
    request.expectedRevision < 0 ||
    typeof request.expectedSourceHash !== "string" ||
    !/^[a-f0-9]{64}$/.test(request.expectedSourceHash) ||
    !(request.expectedRegistryHash === null ||
      typeof request.expectedRegistryHash === "string" &&
        /^[a-f0-9]{64}$/.test(request.expectedRegistryHash)) ||
    typeof request.slideId !== "string" || !request.slideId ||
    typeof request.layout !== "string" ||
    !Array.isArray(request.columns) || request.columns.length < 1 ||
    request.columns.length > 6 ||
    request.columns.some((ids) =>
      !Array.isArray(ids) || !ids.length || ids.length > 200 ||
      ids.some((id) => typeof id !== "string" || !id)
    )
  ) {
    fail(
      "INVALID_LAYOUT_REQUEST",
      "Select a saved slide, layout and explicit objects for every column.",
    );
  }
}
function catalog(
  state: ProjectState,
  text: string,
  registry: Awaited<ReturnType<typeof readDesignRegistry>>,
) {
  const source = scanSource(text),
    headings = new Set(source.slides.map((slide) => slide.headingId));
  // Weak source IDs include offsets. A newer source cannot safely classify the
  // saved objects (especially slide titles) before a fresh projection.
  if (
    Object.values(state.provenance).some((proof) =>
      typeof proof.source?.hash === "string" &&
      proof.source.hash !== source.hash
    )
  ) {
    fail(
      "STALE_SOURCE",
      "QMD changed since the saved projection. Recalculate before applying a layout; saved and pending edits remain recoverable.",
    );
  }
  const size = state.emitted.size as { width: number; height: number };
  // Existing projected title region is reserved. Explicitly moved source titles
  // can increase it, but are never moved or selected by this action.
  const slides = state.emitted.slides.map((slide) => {
    const titles = slide.elements.filter((element) =>
      element.role === "title" ||
      headings.has(
        String(
          state
            .provenance[targetKey({ slideId: slide.id, elementId: element.id })]
            ?.semanticId,
        ),
      )
    );
    const top = Math.max(
      size.height * 166 / 720,
      ...titles.map((e) => Number(e.y) + Number(e.h) + 24),
    );
    const frame: Frame = {
      x: size.width / 16,
      y: top,
      w: size.width * 7 / 8,
      h: size.height - top - size.height * 84 / 720,
    };
    return {
      id: slide.id,
      label: String(slide.title ?? slide.id),
      frame,
      elements: slide.elements.filter((e) =>
        !titles.includes(e) &&
        ["text", "code", "image", "table", "chart"].includes(e.type)
      ).map((element) => ({
        id: element.id,
        type: element.type,
        label: String(
          element.html ?? element.content ?? element.alt ?? element.id,
        ).replace(/<[^>]*>/g, "").slice(0, 120),
      })),
    };
  });
  return {
    docId: state.docId,
    revision: state.revision,
    sourceHash: source.hash,
    registryHash: registry.hash,
    layouts: { ...builtinLayouts, ...registry.registry.layouts },
    slides,
  };
}
export async function readLayouts(source: string) {
  return await withProject(source, async (paths, store) => {
    const state = await store.load();
    if (!state) fail("NO_BASELINE", "Render the project first.");
    return catalog(
      state,
      await Deno.readTextFile(paths.source),
      await readDesignRegistry(paths.directory),
    );
  });
}
async function operation(
  source: string,
  request: LayoutRequest,
  save: boolean,
) {
  requestShape(request);
  return await withProject(source, async (paths, store) => {
    const state = await store.load();
    if (!state) fail("NO_BASELINE", "Render the project first.");
    if (state.docId !== request.expectedDocId) {
      fail("DOC_ID_CHANGED", "Reload the project before applying a layout.");
    }
    if (state.revision !== request.expectedRevision) {
      fail("STALE_REVISION", "Saved objects changed; reopen Apply layout.");
    }
    const text = await Deno.readTextFile(paths.source);
    if (hashSource(text) !== request.expectedSourceHash) {
      fail("STALE_SOURCE", "QMD changed; reopen Apply layout.");
    }
    const registry = await readDesignRegistry(paths.directory);
    if (registry.hash !== request.expectedRegistryHash) {
      fail(
        "DESIGN_REGISTRY_CHANGED",
        "Layout definitions changed; reopen Apply layout.",
      );
    }
    const choices = catalog(state, text, registry),
      slide = choices.slides.find((s) => s.id === request.slideId);
    if (!slide) fail("LAYOUT_SLIDE_SCOPE", "Choose an existing saved slide.");
    if (!Object.hasOwn(choices.layouts, request.layout)) {
      fail("UNKNOWN_LAYOUT", "Choose a declared layout.");
    }
    const layout = choices.layouts[request.layout];
    if (request.columns.length !== layout.columns) {
      fail(
        "LAYOUT_COLUMN_COUNT",
        "Assign objects explicitly to every column of this layout.",
      );
    }
    const ids = request.columns.flat();
    if (
      new Set(ids).size !== ids.length ||
      ids.some((id) => !slide.elements.some((e) => e.id === id))
    ) {
      fail(
        "LAYOUT_ELEMENT_SCOPE",
        "Every selected object must occur once on this slide; titles stay outside the content layout.",
      );
    }
    const width =
      (slide.frame.w - 2 * layout.padding - (layout.columns - 1) * layout.gap) /
      layout.columns;
    const height = slide.frame.h - 2 * layout.padding;
    const doc = structuredClone(state.emitted),
      native = doc.slides.find((s) => s.id === slide.id)!;
    const placements = request.columns.flatMap((members, column) => {
      const h = (height - (members.length - 1) * layout.gap) / members.length;
      if (width <= 0 || h <= 0) {
        fail(
          "LAYOUT_CONTENT_OVERFLOW",
          "The selected layout has no usable content area.",
        );
      }
      return members.map((id, row) => {
        const element = native.elements.find((e) => e.id === id)!;
        const frame = nativeLayoutFrame(element, {
          x: slide.frame.x + layout.padding + column * (width + layout.gap),
          y: slide.frame.y + layout.padding + row * (h + layout.gap),
          w: width,
          h,
        });
        Object.assign(element, frame);
        return { id, ...frame };
      });
    });
    assertProjectDocument(doc);
    const next = equal(doc, state.emitted) ? state : captureEdits(state, doc);
    const preview = {
      ...choices,
      slideId: slide.id,
      layout: request.layout,
      placements,
      pending: next.pending.length,
    };
    // Recheck all external authorities after adaptation and before the single
    // state write. Generated HTML is never replaced by this action.
    await assertOutputUnchanged(state, paths.output);
    if (
      hashSource(await Deno.readTextFile(paths.source)) !==
        request.expectedSourceHash
    ) fail("STALE_SOURCE", "QMD changed while preparing layout.");
    await assertDesignRegistryUnchanged(
      paths.directory,
      request.expectedRegistryHash,
    );
    if (!save) return preview;
    const saved = next === state ? state : await store.save(next);
    return { ...preview, revision: saved.revision };
  });
}
export async function previewLayout(source: string, request: LayoutRequest) {
  return await operation(source, request, false);
}
export async function applyLayout(source: string, request: LayoutRequest) {
  return await operation(source, request, true);
}
