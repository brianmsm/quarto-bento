import {
  applyPlotlyCamera,
  parsePlotlyCamera,
  parsePlotlyPayload,
  type PlotlyCandidate,
} from "../src/widgets/plotly.ts";
import {
  capturedPlotlyCameras,
  pruneWidgetCameras,
  reconcileCapturedPlotlyCameras,
  savedPlotlyCamera,
  savePlotlyCamera,
} from "../src/core/widget-camera.ts";
import {
  canonical,
  compose,
  createState,
  validateState,
} from "../src/state/mod.ts";
import { hashSource } from "../src/source/mod.ts";
import { pngCameraMetadata } from "../src/widgets/camera-png.ts";

function ok(value: unknown, message = "assertion failed"): asserts value {
  if (!value) throw new Error(message);
}
function refuses(action: () => unknown) {
  try {
    action();
  } catch {
    return;
  }
  throw new Error("Expected refusal");
}
const camera = {
  eye: { x: 1.8, y: -1.2, z: 0.8 },
  center: { x: 0, y: 0, z: 0 },
  up: { x: 0, y: 0, z: 1 },
  projection: { type: "perspective" as const },
};
const candidate = (): PlotlyCandidate => {
  const spec = parsePlotlyPayload(
    JSON.stringify({
      x: {
        data: [{ type: "scatter3d", x: [1, 2], y: [3, 4], z: [5, 6] }],
        layout: {},
        config: { showSendToCloud: false },
      },
      evals: [],
      jsHooks: [],
    }),
  );
  return {
    version: 1,
    kind: "plotly",
    source: {
      sourceHash: "source",
      sourceId: "plot",
      producerId: "producer",
      slideId: "slide",
      chunkHash: "chunk",
      outputHash: "output",
    },
    spec,
    specHash: hashSource(canonical(spec)),
    width: 600,
    height: 400,
  };
};
Deno.test("camera parser accepts bounded camera only and copies nested coordinates", () => {
  const result = parsePlotlyCamera(camera);
  result.eye!.x = 5;
  ok(camera.eye.x === 1.8);
  for (
    const value of [
      null,
      [],
      {},
      { eye: {} },
      { eye: { x: Infinity } },
      { eye: { x: NaN } },
      { eye: { x: 10001 } },
      { eye: { x: "2" } },
      { eye: { x: 1, script: "bad" } },
      { projection: { type: "other" } },
      { projection: { type: "perspective", extra: true } },
      { "scene.camera": camera },
      { ...camera, xaxis: { range: [0, 2] } },
      JSON.parse('{"eye":{"__proto__":{}}}'),
    ]
  ) refuses(() => parsePlotlyCamera(value));
});
Deno.test("explicit camera changes only spec camera/hash, never source data geometry or original candidate", () => {
  const original = candidate(), before = canonical(original);
  const changed = applyPlotlyCamera(original, camera);
  ok(canonical(original) === before);
  ok(canonical(changed.source) === canonical(original.source));
  ok(canonical(changed.spec.data) === canonical(original.spec.data));
  ok(changed.width === original.width && changed.height === original.height);
  ok(
    changed.specHash === hashSource(canonical(changed.spec)) &&
      changed.specHash !== original.specHash,
  );
  const twoD = candidate();
  twoD.spec.data[0].type = "scatter";
  refuses(() => applyPlotlyCamera(twoD, camera));
});
Deno.test("typed camera visual state survives state-only composition and changed data without semantic overrides", () => {
  const doc = {
    docId: "deck",
    slides: [{
      id: "slide",
      elements: [{ id: "plot", type: "image", src: "old", x: 20 }],
    }],
  };
  const state = createState(doc);
  state.widgetCameras = [{ slideId: "slide", elementId: "plot", camera }];
  validateState(state);
  const reloaded = JSON.parse(JSON.stringify(state));
  const generated = structuredClone(doc);
  generated.slides[0].elements[0].src = "fresh-output";
  const composed = compose(reloaded, generated);
  ok(
    canonical(
      savedPlotlyCamera(composed.state, "different-producer-slide", "plot"),
    ) === canonical(camera),
  );
  ok(
    composed.state.pending.length === 0 &&
      composed.state.overrides.length === 0,
  );
  ok(composed.document.slides[0].elements[0].src === "fresh-output");
  const invalid = structuredClone(state);
  invalid.widgetCameras![0].camera = { eye: { x: 1e9 } };
  refuses(() => validateState(invalid));
  const duplicate = structuredClone(state);
  duplicate.widgetCameras!.push(duplicate.widgetCameras![0]);
  refuses(() => validateState(duplicate));
});
Deno.test("camera replacement prunes obsolete identities without losing recovery views", () => {
  const ids = Array.from({ length: 8 }, (_, i) => `plot-${i}`);
  const state = createState({
    docId: "deck",
    slides: [{
      id: "slide",
      elements: ids.map((id) => ({ id, type: "image", src: "fallback" })),
    }],
  });
  state.widgetCameras = ids.map((elementId) => ({
    slideId: "slide",
    elementId,
    camera,
  }));
  pruneWidgetCameras(state, new Set(ids.slice(1)));
  const remainingCount = state.widgetCameras!.length;
  ok(remainingCount === 7 && !savedPlotlyCamera(state, ids[0]));
  state.emitted.slides[0].elements.push({
    id: "replacement",
    type: "image",
    src: "new-fallback",
  });
  state.widgetCameras!.push({
    slideId: "slide",
    elementId: "replacement",
    camera,
  });
  validateState(state);
  const replacementCount = state.widgetCameras!.length;
  ok(replacementCount === 8);
  state.widgetCameras!.push({
    slideId: "slide",
    elementId: "detached",
    camera,
  });
  state.provenance[JSON.stringify(["slide", "detached"])] = {
    origin: "detached",
  };
  state.widgetCameras!.push({ slideId: "slide", elementId: "pending", camera });
  state.pending.push({
    id: "pending-view",
    kind: "delete-element",
    target: { slideId: "slide", elementId: "pending" },
    path: [],
    before: { present: true, value: { id: "pending", type: "image" } },
    after: { present: false },
    origin: "computed",
    status: "bento-ahead",
  });
  const active = new Set([...ids.slice(1), "replacement"]);
  pruneWidgetCameras(state, active);
  validateState(state);
  const recoveryCount = state.widgetCameras!.length;
  ok(
    recoveryCount === 10 &&
      !!savedPlotlyCamera(state, "detached") &&
      !!savedPlotlyCamera(state, "pending"),
  );
  state.pending = [];
  delete state.provenance[JSON.stringify(["slide", "detached"])];
  pruneWidgetCameras(state, active);
  validateState(state);
  const cleanedCount = state.widgetCameras!.length;
  ok(cleanedCount === 8);
  state.emitted.slides = [{
    id: "new-display",
    elements: state.emitted.slides[0].elements,
  }];
  pruneWidgetCameras(state, active);
  ok(state.widgetCameras!.every((entry) => entry.slideId === "new-display"));
});
const pixel =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==";
Deno.test("native PNG camera metadata is document-bound and never accepts arbitrary relayout", () => {
  const metadata = {
    version: 1,
    docId: "deck",
    slideId: "slide",
    elementId: "plot",
    camera,
    originalStaticHash: hashSource(pixel),
  };
  const document = (value: unknown) => ({
    docId: "deck",
    slides: [{
      id: "slide",
      elements: [{
        id: "plot",
        type: "image",
        src: pngCameraMetadata(pixel, value).png,
      }],
    }],
  });
  ok(capturedPlotlyCameras({ docId: "deck", slides: [] }).length === 0);
  ok(
    canonical(capturedPlotlyCameras(document(metadata))[0].camera) ===
      canonical(camera),
  );
  refuses(() =>
    capturedPlotlyCameras(document({ ...metadata, docId: "unrelated" }))
  );
  refuses(() =>
    capturedPlotlyCameras(
      document({ ...metadata, slideId: "producer-not-display" }),
    )
  );
  refuses(() =>
    capturedPlotlyCameras(
      document({ ...metadata, originalStaticHash: "not-a-hash" }),
    )
  );
  refuses(() =>
    capturedPlotlyCameras(
      document({ ...metadata, camera: { dragmode: "orbit" } }),
    )
  );
  refuses(() =>
    capturedPlotlyCameras(document({ ...metadata, script: "bad" }))
  );
});
Deno.test("PNG camera carrier validates CRC and payload caps and replaces its single ancillary chunk", () => {
  ok(pngCameraMetadata(pixel).metadata === undefined);
  const first = pngCameraMetadata(pixel, { camera });
  ok(
    canonical(pngCameraMetadata(first.png).metadata) === canonical({ camera }),
  );
  const second = pngCameraMetadata(first.png, { changed: true });
  ok(
    canonical(pngCameraMetadata(second.png).metadata) ===
      canonical({ changed: true }),
  );
  ok(pngCameraMetadata(first.png, { camera }).png === first.png);
  refuses(() => pngCameraMetadata(pixel, { huge: "x".repeat(4097) }));
  const bytes = Uint8Array.from(
    atob(first.png.slice("data:image/png;base64,".length)),
    (c) => c.charCodeAt(0),
  );
  const original = Uint8Array.from(
    atob(pixel.slice("data:image/png;base64,".length)),
    (c) => c.charCodeAt(0),
  );
  const chunkStart = original.length - 12;
  ok(
    bytes.subarray(0, chunkStart).join() ===
      original.subarray(0, chunkStart).join(),
    "pixel chunks must remain byte-identical",
  );
  ok(bytes.subarray(-12).join() === original.subarray(-12).join());
  const chunk = bytes.subarray(chunkStart, bytes.length - 12);
  const duplicate = new Uint8Array(bytes.length + chunk.length);
  duplicate.set(bytes.subarray(0, bytes.length - 12));
  duplicate.set(chunk, bytes.length - 12);
  duplicate.set(bytes.subarray(-12), duplicate.length - 12);
  refuses(() =>
    pngCameraMetadata(
      "data:image/png;base64," + btoa(String.fromCharCode(...duplicate)),
    )
  );
  const unicode = pngCameraMetadata(pixel, { slideId: "á-漢字" });
  const restored = pngCameraMetadata(unicode.png).metadata;
  ok(
    restored && typeof restored === "object" && "slideId" in restored &&
      restored.slideId === "á-漢字",
  );
  bytes[20] ^= 1;
  refuses(() =>
    pngCameraMetadata(
      "data:image/png;base64," + btoa(String.fromCharCode(...bytes)),
    )
  );
  refuses(() => pngCameraMetadata(first.png.slice(0, -8)));
});
Deno.test("camera save validates before opening or creating a project", async () => {
  try {
    await savePlotlyCamera("/unreachable-camera-test/deck.qmd", {
      docId: "deck",
      revision: 0,
      sourceHash: "source",
      slideId: "slide",
      elementId: "plot",
      staticSrc: "image",
      camera: { eye: { x: Infinity } },
    });
  } catch (error) {
    ok(
      error instanceof Error && error.message.startsWith("UNSUPPORTED_WIDGET:"),
    );
    return;
  }
  throw new Error("Expected camera refusal");
});
Deno.test("temporary exploration without native metadata never changes capture state or source", async () => {
  const doc = { docId: "deck", slides: [] };
  const state = createState(doc), before = canonical(state);
  const result = await reconcileCapturedPlotlyCameras(
    "/unreachable-source.qmd",
    "/unreachable-state",
    state,
    doc,
  );
  ok(
    result.state === state && result.document === doc &&
      canonical(state) === before,
  );
});
Deno.test("widget receipt display slide may only be its proven deterministic output continuation", () => {
  const producerId = "producer",
    slideId = `qb-output-${hashSource(producerId).slice(0, 24)}`;
  const state = createState({
    docId: "deck",
    slides: [{
      id: slideId,
      elements: [{ id: "plot", type: "image", src: "fallback" }],
    }],
  });
  const digest = "a".repeat(64),
    generation = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
  state.output = { path: "/deck.bento.html", sha256: digest, generation };
  state.widgets = {
    version: 1,
    docId: "deck",
    generation,
    sourceHash: digest,
    runtimeSha256: digest,
    licenseSha256: digest,
    presenterSha256: digest,
    entries: [{
      slideId,
      elementId: "plot",
      file: "widget-0.json",
      presenter: "widget-0.html",
      presenterSha256: digest,
      receipt: {
        version: 1,
        bundleHash: digest,
        specHash: digest,
        runtimeSha256: digest,
        source: {
          sourceHash: digest,
          sourceId: "plot",
          producerId,
          slideId: "producer-slide",
          chunkHash: digest,
          outputHash: digest,
        },
      },
    }],
  };
  validateState(state);
  const wrongSlide = structuredClone(state);
  wrongSlide.widgets!.entries[0].slideId = "unrelated-slide";
  refuses(() => validateState(wrongSlide));
  const missingImage = structuredClone(state);
  missingImage.generatedBaseline.slides[0].elements = [];
  refuses(() => validateState(missingImage));
});
