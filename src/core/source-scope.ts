/** Verify a component's native scope against its original authored heading receipt. */
import type { SourceDocument } from "../source/mod.ts";
import { INLINE_CODEC_VERSION } from "../render/inline.ts";
import { type ProjectState, StateError } from "../state/types.ts";

export function verifiedSourceSlide(
  source: SourceDocument,
  state: ProjectState,
  sourceSlideId: string,
  expectedNativeSlideId: string,
): string {
  function fail(): never {
    throw new StateError(
      "UNMAPPED_SOURCE_SLIDE",
      "The component needs its unique exact authored heading receipt in the expected native slide. Recalculate and review the source before reusing its appearance.",
    );
  }
  const slides = source.slides.filter((slide) => slide.id === sourceSlideId);
  if (slides.length !== 1 || !expectedNativeSlideId) fail();
  const slide = slides[0];
  if (slide.stable) {
    if (slide.id !== expectedNativeSlideId) fail();
    return slide.id;
  }
  const heading = source.blocks.find((block) => block.id === slide.headingId);
  if (
    !heading || heading.kind !== "heading" || heading.parentId ||
    heading.origin !== "authored"
  ) fail();
  const titles = Object.entries(state.provenance).filter(([, provenance]) =>
    provenance.source?.blockId === heading.id &&
    provenance.source.kind === "heading"
  );
  if (titles.length !== 1) fail();
  const [key, provenance] = titles[0],
    [nativeSlideId, elementId] = JSON.parse(key) as [string, string];
  const baseline = state.generatedBaseline.slides.find((slide) =>
    slide.id === expectedNativeSlideId
  )?.elements.find((element) => element.id === elementId);
  if (
    nativeSlideId !== expectedNativeSlideId || !elementId ||
    provenance.origin !== "authored" || provenance.semanticId !== heading.id ||
    provenance.source?.hash !== source.hash ||
    provenance.source.content !== heading.content ||
    provenance.source.stable !== false ||
    provenance.source.inlineCodec !== INLINE_CODEC_VERSION ||
    baseline?.type !== "text" || typeof baseline.html !== "string"
  ) fail();
  return expectedNativeSlideId;
}
