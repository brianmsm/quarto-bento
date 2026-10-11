/** Previously verified source roles can supply visual typography, never meaning. */
import { clone, type ProjectState, targetKey } from "../state/mod.ts";
import type { SourceDocument } from "../source/mod.ts";
import { kpiSource } from "../source/kpi.ts";
import { sourceComponentClass } from "../render/components.ts";
import type { KpiAppearance } from "../render/kpi.ts";
import type { BentoDoc, Element } from "../render/types.ts";
export type KpiAppearances = ReadonlyMap<string, KpiAppearance>;
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
    const binding = kpiSource(source, block.id), slideId = block.slideId;
    if (!slideId) continue;
    const elements = new Map<string, Element>();
    const intent = state.componentCreations?.find((intent) =>
      intent.kind === "kpi" && intent.id === block.id &&
      intent.slideId === slideId
    );
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
      baselineBackground.groupId === block.id;
    for (const slot of binding.slots) {
      const nativeId = slot.paragraph.id;
      const member = intent?.members.find((member) =>
        member.nativeId === nativeId &&
        member.sourceId === slot.wrapper.id &&
        member.role === slot.attr[2].find(([key]) => key === "bento-role")?.[1]
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
