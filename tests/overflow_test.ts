import { refreshOverflowDiagnostics } from "../src/render/diagnostics.ts";
import type { Diagnostic, Slide } from "../src/render/types.ts";
function assert(value: unknown, message = "assertion failed"): asserts value {
  if (!value) throw new Error(message);
}
Deno.test("overflow refresh targets both slide and element, replaces stale warnings and preserves other diagnostics", () => {
  const retained: Diagnostic = {
    code: "MISSING_DESIGN",
    message: "Restore design",
    slideId: "a",
    reference: ".qbento/",
  };
  const slides: Slide[] = [
    { id: "a", elements: [{ id: "shared", type: "text", y: 700, h: 21 }] },
    { id: "b", elements: [{ id: "shared", type: "shape", y: 50, h: 0 }] },
  ];
  const old: Diagnostic[] = [retained, {
    code: "OVERFLOW",
    message: "stale",
    elementId: "removed",
  }];
  const diagnostics = refreshOverflowDiagnostics({
    size: { width: 1280, height: 720 },
    slides,
  }, old);
  assert(diagnostics.length === 3);
  assert(diagnostics[0] === retained);
  assert(diagnostics[1].slideId === "a" && diagnostics[2].slideId === "b");
  assert(diagnostics.slice(1).every((d) => d.elementId === "shared"));
  assert(old.length === 2 && old[1].elementId === "removed");
});
Deno.test("overflow follows supported native page height and exact vertical box boundary", () => {
  const slides: Slide[] = [{
    id: "slide",
    elements: [
      { id: "at-edge", type: "shape", y: 500, h: 40 },
      { id: "past-edge", type: "text", y: 500, h: 41 },
    ],
  }];
  const smaller = refreshOverflowDiagnostics({
    size: { width: 960, height: 540 },
    slides,
  }, []);
  assert(smaller.length === 1 && smaller[0].elementId === "past-edge");
  const larger = refreshOverflowDiagnostics({
    size: { width: 1280, height: 900 },
    slides,
  }, smaller);
  assert(larger.length === 0);
});
