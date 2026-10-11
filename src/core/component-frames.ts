/** Approved bootstrap frames are independent from mutable native decoration. */
import { type BentoElement, type ProjectState } from "../state/mod.ts";
import type { Frame } from "../render/design.ts";
import type { SourceDocument } from "../source/mod.ts";
import { kpiSource } from "../source/kpi.ts";
import {
  originalAttributeTokens,
  originalPandocAttributes,
} from "../source/attributes.ts";
export function componentFrame(element: BentoElement): Frame {
  return {
    x: Number(element.x),
    y: Number(element.y),
    w: Number(element.w),
    h: Number(element.h),
  };
}
export function retainedComponentFrames(
  state?: ProjectState | null,
  source?: SourceDocument,
): ReadonlyMap<string, Frame> {
  const frames = new Map<string, Frame>();
  if (!state) return frames;
  const records = [
    ...(state.componentCreations ?? []).map((intent) => ({
      ...intent,
      frame: intent.projectionFrame,
    })),
    ...(state.componentProjections ?? []),
  ];
  for (const record of records) {
    if (source) {
      const blocks = source.blocks.filter((block) => block.id === record.id);
      const block = blocks[0];
      if (
        blocks.length !== 1 || !block.stable || block.kind !== "div" ||
        block.slideId !== record.slideId
      ) continue;
      const declaration = /^ {0,3}:{3,}\s*\{([^{}]*)\}\s*$/.exec(
        block.raw.split(/\r?\n/)[0],
      )?.[1];
      if (
        declaration === undefined ||
        !originalPandocAttributes(
          declaration,
          originalAttributeTokens(declaration),
        )[1].includes(`bento-${record.kind}`)
      ) continue;
      if (block.origin !== "authored") {
        if (record.kind !== "kpi") continue;
        // A literal source KPI wrapper becomes aggregate-computed when its value
        // is authored as inline code. Source role proof remains the authority.
        kpiSource(source, record.id);
      }
    }
    frames.set(record.id, { ...record.frame });
  }
  return frames;
}
