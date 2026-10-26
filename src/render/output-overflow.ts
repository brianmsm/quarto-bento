import type { SourceDocument } from "../source/mod.ts";
import type { ProvenanceMap } from "../state/types.ts";
import { targetKey } from "../state/mod.ts";
import type { BentoDoc, Diagnostic } from "./types.ts";

export interface OutputOverflowTarget {
  slideId: string;
  elementId: string;
}

/** Read only literal options from the original producer, never executed output. */
export function outputOverflowOption(
  source: SourceDocument | undefined,
  producerId: string | undefined,
): { height: number } | undefined {
  const block = source?.blocks.find((item) =>
    item.id === producerId && item.kind === "chunk"
  );
  if (!block) return;
  const options = new Map<string, string>();
  for (const line of block.content.split(/\r?\n/)) {
    if (line.trim() && !/^\s*#\|/.test(line)) break;
    const match = /^\s*#\|\s*(bento-overflow(?:-height)?)\s*:\s*(.*?)\s*$/.exec(
      line,
    );
    if (!match) {
      if (/^\s*#\|\s*bento-overflow\b/.test(line)) {
        throw new Error("INVALID_OUTPUT_OVERFLOW: expected a literal option");
      }
      continue;
    }
    if (options.has(match[1])) {
      throw new Error("INVALID_OUTPUT_OVERFLOW: duplicate producer option");
    }
    options.set(match[1], match[2]);
  }
  if (!options.size) return;
  if (
    !/^(?:scroll|'scroll'|"scroll")$/.test(options.get("bento-overflow") ?? "")
  ) {
    throw new Error("INVALID_OUTPUT_OVERFLOW: choose bento-overflow: scroll");
  }
  const raw = options.get("bento-overflow-height") ?? "240";
  if (!/^\d+$/.test(raw) || Number(raw) < 80 || Number(raw) > 600) {
    throw new Error(
      "INVALID_OUTPUT_OVERFLOW: viewport height must be 80–600 px",
    );
  }
  return { height: Number(raw) };
}

export function outputViewportHeight(
  source: SourceDocument | undefined,
  producerId: string | undefined,
  naturalHeight: number,
): number {
  const option = outputOverflowOption(source, producerId);
  return option ? Math.min(naturalHeight, option.height) : naturalHeight;
}

export function outputOverflowTargets(
  source: SourceDocument,
  provenance: ProvenanceMap,
  document: Pick<BentoDoc, "slides">,
): OutputOverflowTarget[] {
  return document.slides.flatMap((slide) =>
    slide.elements.filter((element) => {
      if (!["code", "table", "text"].includes(element.type)) return false;
      const origin = provenance[
        targetKey({
          slideId: slide.id,
          elementId: element.id,
        })
      ];
      return origin?.origin === "computed" &&
        outputOverflowOption(source, origin.producer) !== undefined;
    }).map((element) => ({ slideId: slide.id, elementId: element.id }))
  );
}

/** Explicit viewports replace clipping warnings; unrelated warnings remain. */
export function outputOverflowDiagnostics(
  diagnostics: readonly Diagnostic[],
  targets: readonly OutputOverflowTarget[],
): Diagnostic[] {
  const keys = new Set(targets.map((target) => targetKey(target)));
  return diagnostics.filter((diagnostic) =>
    !["TEXT_OVERFLOW", "NATIVE_CONTENT_OVERFLOW"].includes(diagnostic.code) ||
    !keys.has(targetKey({
      slideId: diagnostic.slideId,
      elementId: diagnostic.elementId,
    }))
  );
}
