import { resolve } from "node:path";
import {
  applyPlotlyCamera,
  parsePlotlyCamera,
  type PlotlyCamera,
} from "../widgets/plotly.ts";
import { plotlyFallbackData, verifyStaticPng } from "../widgets/presenter.ts";
import { snapshotPlotly } from "../widgets/snapshot.ts";
import { pngCameraMetadata } from "../widgets/camera-png.ts";
import { hashSource } from "../source/mod.ts";
import {
  assertOutputUnchanged,
  type BentoDoc,
  canonical,
  type JsonObject,
  type ProjectState,
  sha256,
  StateError,
  targetKey,
  validateState,
} from "../state/mod.ts";
import { withProject } from "./project.ts";
import {
  loadProjectWidgets,
  preparedInlineWidgets,
  stageWidgets,
} from "./widgets.ts";
import { preparePublication, recordPublication } from "./capture.ts";
import { loadBentoShell } from "../render/shell.ts";
import { spliceDocument } from "../render/html.ts";
import { ISOLATION_BOOTSTRAP, OFFLINE_CSP } from "../bridge/isolation.ts";
import { INLINE_WIDGET_CSP, inlineWidgetBootstrap } from "../widgets/inline.ts";
import { outputOverflowTargets } from "../render/output-overflow.ts";
import { attachOutputOverflow } from "../render/output-overflow-html.ts";
import type { BentoDoc as RenderDoc } from "../render/types.ts";
import { syncDirectory, writeDurable } from "./io.ts";

export interface PlotlyCameraSaveRequest {
  docId: string;
  revision: number;
  sourceHash: string;
  slideId: string;
  elementId: string;
  staticSrc: string;
  camera: unknown;
}
function fail(message: string): never {
  throw new StateError("WIDGET_CAMERA_SAVE_REFUSED", message);
}
export function savedPlotlyCamera(
  state: ProjectState | undefined | null,
  slideId: string,
  elementId?: string,
): PlotlyCamera | undefined {
  const entry = state?.widgetCameras?.find((entry) =>
    entry.elementId === (elementId ?? slideId)
  );
  return entry && parsePlotlyCamera(entry.camera);
}
/** Remove obsolete source views, but keep explicit detached/pending recovery state. */
export function pruneWidgetCameras(
  state: ProjectState,
  currentIds: ReadonlySet<string>,
): void {
  if (!state.widgetCameras) return;
  state.widgetCameras = state.widgetCameras.filter((entry) =>
    currentIds.has(entry.elementId) ||
    state.provenance[targetKey(entry)]?.origin === "detached" ||
    state.pending.some((change) =>
      change.target.elementId
        ? change.target.elementId === entry.elementId
        : change.target.slideId === entry.slideId
    )
  ).map((entry) => {
    const slide = currentIds.has(entry.elementId)
      ? state.emitted.slides.find((slide) =>
        slide.elements.some((element) => element.id === entry.elementId)
      )
      : undefined;
    return slide && slide.id !== entry.slideId
      ? { ...entry, slideId: slide.id }
      : entry;
  });
  if (!state.widgetCameras.length) delete state.widgetCameras;
}
function recordCamera(
  state: ProjectState,
  slideId: string,
  elementId: string,
  camera: PlotlyCamera,
) {
  state.widgetCameras = (state.widgetCameras ?? []).filter((entry) =>
    entry.elementId !== elementId
  );
  state.widgetCameras.push({
    slideId,
    elementId,
    camera: camera as JsonObject,
  });
}
function image(doc: BentoDoc, slideId: string, elementId: string) {
  const element = doc.slides.find((slide) => slide.id === slideId)?.elements
    .find((element) => element.id === elementId);
  if (!element || element.type !== "image") {
    fail("Widget image no longer exists in its saved slide.");
  }
  return element;
}
function assertTarget(state: ProjectState, slideId: string, elementId: string) {
  const key = targetKey({ slideId, elementId });
  if (
    !state.widgets?.entries.some((entry) =>
      entry.slideId === slideId && entry.elementId === elementId
    ) ||
    state.provenance[key]?.origin === "detached" ||
    state.pending.some((change) =>
      change.target.slideId === slideId &&
      change.target.elementId === elementId &&
      (change.origin === "detached" || change.kind !== "field" ||
        change.path[0] === "src")
    )
  ) {
    fail("Resolve or restore the widget before saving its camera.");
  }
}
/** Native metadata is an explicit camera request, never a trusted snapshot receipt. */
export function capturedPlotlyCameras(
  document: BentoDoc,
  widgetIds?: ReadonlySet<string>,
): (NonNullable<ProjectState["widgetCameras"]>[number] & {
  originalStaticHash: string;
  staticSrc: string;
})[] {
  const entries: (NonNullable<ProjectState["widgetCameras"]>[number] & {
    originalStaticHash: string;
    staticSrc: string;
  })[] = [];
  const seen = new Set<string>();
  for (const slide of document.slides) {
    for (const element of slide.elements) {
      if (
        widgetIds && !widgetIds.has(element.id) || element.type !== "image" ||
        typeof element.src !== "string" ||
        !element.src.startsWith("data:image/png;base64,")
      ) continue;
      const data = pngCameraMetadata(element.src).metadata as
        | Record<string, unknown>
        | undefined;
      if (data === undefined) continue;
      if (
        !data || data.version !== 1 || data.docId !== document.docId ||
        data.slideId !== slide.id || data.elementId !== element.id ||
        typeof data.originalStaticHash !== "string" ||
        !/^[a-f0-9]{64}$/.test(data.originalStaticHash) ||
        Object.keys(data).some((key) =>
          ![
            "version",
            "docId",
            "slideId",
            "elementId",
            "originalStaticHash",
            "camera",
          ].includes(key)
        ) ||
        seen.has(element.id) || entries.length >= 8
      ) fail("Unrelated or invalid native PNG camera metadata.");
      seen.add(element.id);
      entries.push({
        slideId: slide.id,
        elementId: element.id,
        camera: parsePlotlyCamera(data.camera) as JsonObject,
        originalStaticHash: data.originalStaticHash,
        staticSrc: element.src,
      });
    }
  }
  return entries;
}
/** Call before captureEdits; returned state/doc replace both inputs. Browser pixels are recaptured locally. */
export async function reconcileCapturedPlotlyCameras(
  sourcePath: string,
  stateDir: string,
  input: ProjectState,
  document: BentoDoc,
): Promise<{ state: ProjectState; document: BentoDoc }> {
  if (document.docId !== input.docId) {
    fail("Camera capture belongs to a different document.");
  }
  const entries = capturedPlotlyCameras(
    document,
    new Set(input.widgets?.entries.map((entry) => entry.elementId) ?? []),
  );
  const changed = entries.filter((entry) =>
    canonical(entry.camera) !==
      canonical(savedPlotlyCamera(input, entry.elementId) ?? null) ||
    image(input.emitted, entry.slideId, entry.elementId).src !== entry.staticSrc
  );
  if (!changed.length) return { state: input, document };
  const prepared = await loadProjectWidgets(sourcePath, stateDir, input);
  const state = structuredClone(input), doc = structuredClone(document);
  for (const entry of changed) {
    assertTarget(input, entry.slideId, entry.elementId);
    const bundle = prepared.bundles.find((bundle) =>
      bundle.candidate.source.sourceId === entry.elementId
    );
    if (!bundle || !prepared.runtime) {
      fail("No verified widget generation for saved camera.");
    }
    if (
      image(input.emitted, entry.slideId, entry.elementId).src !==
        plotlyFallbackData(bundle) ||
      entry.originalStaticHash !== hashSource(plotlyFallbackData(bundle))
    ) fail("Published widget image changed before camera capture.");
    const element = image(doc, entry.slideId, entry.elementId);
    if (
      element.src !== entry.staticSrc || typeof element.src !== "string" ||
      !element.src.startsWith("data:image/png;base64,")
    ) fail("Saved camera requires its exact approved PNG fallback.");
    verifyStaticPng(element.src.slice("data:image/png;base64,".length));
    const captured = await snapshotPlotly(
      applyPlotlyCamera(bundle.candidate, entry.camera),
      prepared.runtime,
    );
    const src = plotlyFallbackData(captured);
    // Update the comparison baseline, not a semantic src override or an execution receipt.
    image(state.generatedBaseline, entry.slideId, entry.elementId).src = src;
    image(state.emitted, entry.slideId, entry.elementId).src = src;
    element.src = src;
    recordCamera(
      state,
      entry.slideId,
      entry.elementId,
      parsePlotlyCamera(entry.camera),
    );
  }
  return { state, document: doc };
}

export async function savePlotlyCamera(
  sourcePath: string,
  request: PlotlyCameraSaveRequest,
): Promise<ProjectState> {
  const camera = parsePlotlyCamera(request.camera);
  return await withProject(sourcePath, async (paths, store) => {
    const current = await store.load();
    if (!current || current.docId !== request.docId) {
      fail("Reload the original widget project.");
    }
    if (current.revision !== request.revision) {
      throw new StateError(
        "STALE_REVISION",
        "Reload before saving the camera.",
      );
    }
    await assertOutputUnchanged(current, paths.output);
    if (
      hashSource(await Deno.readTextFile(paths.source)) !== request.sourceHash
    ) {
      throw new StateError(
        "STALE_SOURCE",
        "Render changed QMD before saving a camera.",
      );
    }
    assertTarget(current, request.slideId, request.elementId);
    const prepared = await loadProjectWidgets(
      paths.source,
      paths.stateDir,
      current,
    );
    const index = prepared.bundles.findIndex((bundle) =>
      bundle.candidate.source.sourceId === request.elementId
    );
    if (index < 0 || !prepared.runtime) fail("No verified widget generation.");
    const previous = plotlyFallbackData(prepared.bundles[index]);
    if (
      request.staticSrc !== previous ||
      image(current.emitted, request.slideId, request.elementId).src !==
        previous
    ) fail("Widget static identity changed; reload before saving.");
    prepared.bundles[index] = await snapshotPlotly(
      applyPlotlyCamera(prepared.bundles[index].candidate, camera),
      prepared.runtime,
    );
    let state = structuredClone(current);
    pruneWidgetCameras(
      state,
      new Set(
        prepared.bundles.map((bundle) => bundle.candidate.source.sourceId),
      ),
    );
    const src = plotlyFallbackData(prepared.bundles[index]);
    image(state.generatedBaseline, request.slideId, request.elementId).src =
      src;
    image(state.emitted, request.slideId, request.elementId).src = src;
    recordCamera(state, request.slideId, request.elementId, camera);
    validateState(state);
    const detached = new Set(
      Object.entries(state.provenance).filter(([, value]) =>
        value.origin === "detached"
      ).map(([key]) => key),
    );
    const views = await preparedInlineWidgets(
      prepared,
      prepared.source,
      state.emitted,
      detached,
    );
    const overflow = outputOverflowTargets(
      prepared.source,
      state.provenance,
      state.emitted as unknown as RenderDoc,
    );
    const shell = await loadBentoShell();
    const assembled = attachOutputOverflow(
      spliceDocument(
        shell,
        state.emitted as unknown as RenderDoc,
        ISOLATION_BOOTSTRAP + inlineWidgetBootstrap(state.emitted, views),
        views.length ? INLINE_WIDGET_CSP : OFFLINE_CSP,
      ),
      overflow,
    );
    const { html, receipt } = await preparePublication(
      state.emitted,
      assembled,
    );
    const publication = await stageWidgets(
      paths.stateDir,
      receipt.generation,
      state.docId,
      prepared.source,
      prepared,
      state.emitted,
      detached,
      overflow,
    );
    state = await recordPublication(
      state,
      state.emitted,
      paths.output,
      html,
      receipt,
    );
    if (publication) state.widgets = publication;
    validateState(state);
    await assertOutputUnchanged(current, paths.output);
    if (
      hashSource(await Deno.readTextFile(paths.source)) !== request.sourceHash
    ) fail("Source changed during camera capture.");
    const staging = paths.output + ".pending-" + crypto.randomUUID();
    const history = resolve(paths.stateDir, "history");
    await Deno.mkdir(history, { recursive: true });
    const info = await Deno.lstat(history);
    if (!info.isDirectory || info.isSymlink) {
      fail("History must be a real directory.");
    }
    const backup = resolve(history, `output-${crypto.randomUUID()}.html`);
    const journal = resolve(paths.stateDir, "render-transaction.json");
    await writeDurable(staging, html);
    await syncDirectory(paths.directory);
    await writeDurable(
      journal,
      JSON.stringify(
        {
          version: 1,
          staging,
          backup,
          output: paths.output,
          oldRevision: current.revision,
          nextRevision: current.revision + 1,
          sha256: await sha256(html),
          previousOutput: current.output ?? null,
        },
        null,
        2,
      ),
    );
    await syncDirectory(paths.stateDir);
    await Deno.rename(paths.output, backup);
    await syncDirectory(paths.directory);
    await syncDirectory(history);
    if (await sha256(await Deno.readFile(backup)) !== current.output?.sha256) {
      try {
        await Deno.link(backup, paths.output);
      } catch (error) {
        if (!(error instanceof Deno.errors.AlreadyExists)) throw error;
      }
      fail(
        "Concurrent native save preserved in history; recover before continuing.",
      );
    }
    if (
      hashSource(await Deno.readTextFile(paths.source)) !== request.sourceHash
    ) fail("Source changed during publication; recover retained transaction.");
    state = await store.save(state);
    await Deno.link(staging, paths.output);
    await syncDirectory(paths.directory);
    await Deno.remove(staging);
    await Deno.remove(journal);
    await syncDirectory(paths.stateDir);
    return state;
  });
}
