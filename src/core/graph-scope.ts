/** Weak source heading scope is an executed receipt, never a slug/position guess. */
import type { SourceDocument } from "../source/mod.ts";
import type { SourceGraph } from "../source/graphs.ts";
import { graphReceipt } from "../state/graphs.ts";
import { type ProjectState, StateError } from "../state/types.ts";
import { verifiedSourceSlide } from "./source-scope.ts";

function fail(): never {
  throw new StateError(
    "UNMAPPED_GRAPH_SOURCE",
    "A graph under an unpinned heading needs its unique exact executed heading and native scope receipts. Recalculate and review the original source before editing relationships.",
  );
}
export function nativeGraphSlide(
  source: SourceDocument,
  state: ProjectState,
  graph: SourceGraph,
): string {
  const slides = source.slides.filter((slide) =>
    slide.id === graph.wrapper.slideId
  );
  if (slides.length !== 1) fail();
  const slide = slides[0];
  const members = Object.entries(state.provenance).filter(([, provenance]) => {
    const proof = graphReceipt(provenance);
    return proof?.componentId === graph.wrapper.id;
  });
  if (!members.length) fail();
  if (slide.stable) {
    // Older explicit-ID receipts have no alias fields; any fields retained by
    // current projections must still agree with their exact native scope.
    for (const [key, provenance] of members) {
      const [nativeSlideId] = JSON.parse(key) as [string],
        proof = graphReceipt(provenance)!;
      if (
        nativeSlideId !== slide.id ||
        proof.nativeSlideId !== undefined && proof.nativeSlideId !== slide.id ||
        proof.sourceSlideId !== undefined && proof.sourceSlideId !== slide.id
      ) fail();
    }
    return slide.id;
  }
  const scope = graphReceipt(members[0][1])!.nativeSlideId;
  if (typeof scope !== "string" || !scope) fail();
  for (const [key, provenance] of members) {
    const [nativeSlideId] = JSON.parse(key) as [string],
      proof = graphReceipt(provenance)!;
    if (
      nativeSlideId !== scope || proof.nativeSlideId !== scope ||
      proof.sourceSlideId !== slide.id ||
      proof.kind !== graph.kind || provenance.origin !== "authored" ||
      provenance.source?.hash !== source.hash
    ) fail();
  }
  try {
    return verifiedSourceSlide(source, state, slide.id, scope);
  } catch (error) {
    if (error instanceof StateError && error.code === "UNMAPPED_SOURCE_SLIDE") {
      fail();
    }
    throw error;
  }
}
