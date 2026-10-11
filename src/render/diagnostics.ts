import type { BentoDoc, Diagnostic } from "./types.ts";

/** Vertical box overflow for the actual native page, without estimating ink. */
export function refreshOverflowDiagnostics(
  document: Pick<BentoDoc, "size" | "slides">,
  diagnostics: readonly Diagnostic[],
): Diagnostic[] {
  const result = diagnostics.filter((diagnostic) =>
    diagnostic.code !== "OVERFLOW"
  );
  for (const slide of document.slides) {
    for (const element of slide.elements) {
      if (
        Number(element.y) + Number(element.h) > document.size.height ||
        Number(element.h) <= 0
      ) {
        result.push({
          code: "OVERFLOW",
          message: `Element exceeds slide ${slide.id}`,
          slideId: slide.id,
          elementId: element.id,
        });
      }
    }
  }
  return result;
}
