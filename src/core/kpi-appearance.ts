/** Previously verified source roles can supply visual typography, never meaning. */
import { clone, type ProjectState, targetKey } from "../state/mod.ts";
import type { SourceDocument } from "../source/mod.ts";
import { verifiedSourceSlide } from "./source-scope.ts";
import { StateError } from "../state/types.ts";
import { kpiSource } from "../source/kpi.ts";
import { sourceComponentClass } from "../render/components.ts";
import type { KpiAppearance } from "../render/kpi.ts";
import type { BentoDoc, Element } from "../render/types.ts";
export type KpiAppearances = ReadonlyMap<string, KpiAppearance>;
/** A globally identified source wrapper must have exactly one native receipt. */
function sourceBackedScope(
  state: ProjectState,
  source: SourceDocument,
  sourceSlideId: string,
  componentId: string,
): string | undefined {
  const backgroundId = `${componentId}/qb-kpi-background`;
  const groupId = kpiSource(source, componentId).groupId;
  const candidates = Object.entries(state.provenance).flatMap(
    ([key, proof]) => {
      let target: unknown;
      try {
        target = JSON.parse(key);
      } catch {
        return [];
      }
      if (
        !Array.isArray(target) || target.length !== 2 ||
        typeof target[0] !== "string" || !target[0] ||
        target[1] !== backgroundId ||
        proof.origin !== "authored" || proof.semanticId !== componentId ||
        proof.source?.kind !== "div" || proof.source.blockId !== componentId ||
        proof.source.stable !== true
      ) return [];
      const baseline = state.generatedBaseline.slides.find((slide) =>
        slide.id === target[0]
      )
        ?.elements.find((element) => element.id === backgroundId);
      return baseline?.type === "shape" && baseline.shape === "rect" &&
          baseline.groupId === groupId
        ? [target[0]]
        : [];
    },
  );
  if (candidates.length !== 1) return;
  try {
    const slideId = verifiedSourceSlide(
      source,
      state,
      sourceSlideId,
      candidates[0],
    );
    // A weak heading's receipt is valid only for this exact execution snapshot.
    const heading = source.slides.find((slide) => slide.id === sourceSlideId)!;
    if (
      !heading.stable &&
      state.provenance[targetKey({ slideId, elementId: backgroundId })].source
          ?.hash !== source.hash
    ) return;
    return slideId;
  } catch (error) {
    if (error instanceof StateError && error.code === "UNMAPPED_SOURCE_SLIDE") {
      return;
    }
    throw error;
  }
}
export function retainedKpiAppearances(
  state: ProjectState | null | undefined,
  source: SourceDocument,
): KpiAppearances {
  const appearances = new Map<string, KpiAppearance>();
  if (!state) return appearances;
  for (
    const block of source.blocks.filter((block) =>
      block.kind === "div" && block.stable &&
      sourceComponentClass(block.raw) === ".bento-kpi"
    )
  ) {
    const binding = kpiSource(source, block.id), sourceSlideId = block.slideId;
    if (!sourceSlideId) continue;
    // Pending roles have explicit membership; source-backed roles require the
    // unique original background receipt before any native slide is considered.
    const intent = state.componentCreations?.find((intent) =>
      intent.kind === "kpi" && intent.id === block.id
    );
    let slideId: string | undefined;
    if (intent) {
      try {
        slideId = verifiedSourceSlide(
          source,
          state,
          sourceSlideId,
          intent.slideId,
        );
      } catch (error) {
        if (
          !(error instanceof StateError) ||
          error.code !== "UNMAPPED_SOURCE_SLIDE"
        ) throw error;
      }
    } else {
      slideId = sourceBackedScope(state, source, sourceSlideId, block.id);
    }
    if (!slideId) continue;
    const elements = new Map<string, Element>();
    const backgroundId = `${block.id}/qb-kpi-background`;
    const backgroundProof =
      state.provenance[targetKey({ slideId, elementId: backgroundId })];
    const baselineBackground = state.generatedBaseline.slides.find((slide) =>
      slide.id === slideId
    )
      ?.elements.find((element) => element.id === backgroundId);
    const sourceBacked = backgroundProof?.origin === "authored" &&
      backgroundProof.semanticId === block.id &&
      backgroundProof.source?.kind === "div" &&
      backgroundProof.source?.blockId === block.id &&
      baselineBackground?.type === "shape" &&
      baselineBackground.shape === "rect" &&
      baselineBackground.groupId === binding.groupId;
    for (const slot of binding.slots) {
      const nativeId = slot.paragraph.id;
      const member = intent?.members.find((member) =>
        member.nativeId === nativeId &&
        member.sourceId === slot.wrapper.id &&
        member.role === slot.role
      );
      if (member) {
        elements.set(nativeId, clone(member.snapshot));
        continue;
      }
      if (!sourceBacked) continue;
      const proof =
        state.provenance[targetKey({ slideId, elementId: nativeId })];
      const current = state.emitted.slides.find((slide) => slide.id === slideId)
        ?.elements.find((element) => element.id === nativeId);
      if (
        current?.type === "text" &&
        !!proof && ["authored", "computed"].includes(proof.origin) &&
        proof.semanticId === nativeId && proof.source?.kind === "paragraph" &&
        proof.source?.blockId === nativeId &&
        proof.source?.parentId === slot.wrapper.id &&
        proof.source?.siblings === 1 &&
        proof.source?.hash === backgroundProof.source?.hash
      ) {
        elements.set(nativeId, clone(current));
      }
    }
    if (elements.size) {
      const previous = appearances.get(slideId);
      const combined = new Map(previous?.elements ?? []);
      for (const [id, element] of elements) combined.set(id, element);
      appearances.set(slideId, {
        elements: combined,
        resources: state.emitted as unknown as BentoDoc,
      });
    }
  }
  return appearances;
}
/** Rescue keeps the actual saved boxes as visual overlays, not source baseline fields. */
export function preserveRescuedKpiGeometry(
  state: ProjectState,
  appearances: KpiAppearances,
  rescues: { slideId: string; elementIds: string[] }[],
  ownership: ProjectState["ownership"],
): void {
  for (const rescue of rescues) {
    for (const elementId of rescue.elementIds) {
      const native = appearances.get(rescue.slideId)?.elements.get(elementId);
      const current = state.emitted.slides.find((slide) =>
        slide.id === rescue.slideId
      )
        ?.elements.find((element) => element.id === elementId);
      if (!native || current?.type !== "text") continue;
      const target = { slideId: rescue.slideId, elementId },
        key = targetKey(target);
      for (const field of ["x", "y", "w", "h"]) {
        if (
          typeof native[field] !== "number" || !Number.isFinite(native[field])
        ) continue;
        if (
          ownership[key]?.some((path) =>
            path === field || field.startsWith(path + "/")
          )
        ) continue;
        let overlay = state.overrides.find((overlay) =>
          targetKey(overlay.target) === key
        );
        if (!overlay) {
          overlay = { target, fields: [] };
          state.overrides.push(overlay);
        }
        overlay.fields = overlay.fields.filter((item) =>
          item.path.length !== 1 || item.path[0] !== field
        );
        overlay.fields.push({
          path: [field],
          value: { present: true, value: native[field] },
        });
      }
    }
  }
}
