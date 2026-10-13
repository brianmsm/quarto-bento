import type { BentoDoc, Diagnostic } from "./types.ts";

/** Axis-aligned box overflow for the actual native page, without estimating ink. */
export function refreshOverflowDiagnostics(
  document: Pick<BentoDoc, "size" | "slides">,
  diagnostics: readonly Diagnostic[],
): Diagnostic[] {
  const result = diagnostics.filter((diagnostic) =>
    diagnostic.code !== "OVERFLOW"
  );
  for (const slide of document.slides) {
    for (const element of slide.elements) {
      const x = Number(element.x);
      const y = Number(element.y);
      const width = Number(element.w);
      const height = Number(element.h);
      if (
        x < 0 ||
        x + width > document.size.width ||
        y < 0 ||
        y + height > document.size.height ||
        height <= 0
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
