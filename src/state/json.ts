import {
  type BentoDoc,
  type Field,
  type Json,
  type JsonObject,
  StateError,
  type Target,
  type Value,
} from "./types.ts";

export function assertJson(value: unknown, depth = 0): asserts value is Json {
  if (depth > 100) {
    throw new StateError("INVALID_JSON", "JSON nesting exceeds 100 levels.");
  }
  if (
    value === null || typeof value === "string" || typeof value === "boolean"
  ) return;
  if (typeof value === "number" && Number.isFinite(value)) return;
  if (Array.isArray(value)) {
    for (const item of value) assertJson(item, depth + 1);
    return;
  }
  if (
    typeof value !== "object" ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  ) throw new StateError("INVALID_JSON", "Expected plain JSON data.");
  for (const [key, item] of Object.entries(value)) {
    if (["__proto__", "prototype", "constructor"].includes(key)) {
      throw new StateError("UNSAFE_KEY", `Unsafe JSON key: ${key}`);
    }
    assertJson(item, depth + 1);
  }
}
export function clone<T>(value: T): T {
  return structuredClone(value);
}
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value && typeof value === "object") {
    return "{" + Object.keys(value).sort().map((k) =>
      JSON.stringify(k) + ":" + canonical((value as Record<string, unknown>)[k])
    ).join(",") + "}";
  }
  return JSON.stringify(value);
}
export function equal(a: unknown, b: unknown): boolean {
  return canonical(a) === canonical(b);
}
export function targetKey(target: Target): string {
  return JSON.stringify([target.slideId ?? null, target.elementId ?? null]);
}
export function validateDoc(doc: unknown): asserts doc is BentoDoc {
  assertJson(doc);
  if (
    !doc || Array.isArray(doc) || typeof doc !== "object" ||
    typeof doc.docId !== "string" || !doc.docId || !Array.isArray(doc.slides)
  ) {
    throw new StateError(
      "INVALID_DOCUMENT",
      "Document requires docId and slides.",
    );
  }
  const slideIds = new Set();
  for (const slide of doc.slides) {
    if (
      !slide || Array.isArray(slide) || typeof slide !== "object" ||
      typeof slide.id !== "string" || !slide.id ||
      !Array.isArray(slide.elements)
    ) {
      throw new StateError(
        "INVALID_ID",
        "Each slide requires a stable nonempty id and elements array.",
      );
    }
    if (slideIds.has(slide.id)) {
      throw new StateError("DUPLICATE_ID", `Duplicate slide ID ${slide.id}`);
    }
    slideIds.add(slide.id);
    const ids = new Set();
    for (const el of slide.elements) {
      if (
        !el || Array.isArray(el) || typeof el !== "object" ||
        typeof el.id !== "string" || !el.id || typeof el.type !== "string" ||
        !el.type
      ) {
        throw new StateError(
          "INVALID_ID",
          "Each element requires a stable nonempty id and type.",
        );
      }
      if (ids.has(el.id)) {
        throw new StateError(
          "DUPLICATE_ID",
          `Duplicate element ID ${el.id} on ${slide.id}`,
        );
      }
      ids.add(el.id);
    }
  }
}
export function entity(doc: BentoDoc, target: Target): JsonObject | undefined {
  if (!target.slideId) return doc;
  const slide = doc.slides.find((s) => s.id === target.slideId);
  return target.elementId
    ? slide?.elements.find((e) => e.id === target.elementId)
    : slide;
}
export function get(object: JsonObject | undefined, path: string[]): Value {
  let value: Json | undefined = object;
  for (const key of path) {
    if (
      !value || typeof value !== "object" || Array.isArray(value) ||
      !Object.hasOwn(value, key)
    ) return { present: false };
    value = value[key];
  }
  return value === undefined
    ? { present: false }
    : { present: true, value: clone(value) };
}
export function set(object: JsonObject, path: string[], value: Value): void {
  if (
    !path.length ||
    path.some((k) => ["__proto__", "constructor", "prototype"].includes(k))
  ) throw new StateError("INVALID_PATH", "Unsafe or empty property path.");
  let cursor = object;
  for (const key of path.slice(0, -1)) {
    if (
      !cursor[key] || typeof cursor[key] !== "object" ||
      Array.isArray(cursor[key])
    ) cursor[key] = {};
    cursor = cursor[key] as JsonObject;
  }
  if (value.present) cursor[path.at(-1)!] = clone(value.value!);
  else delete cursor[path.at(-1)!];
}
export function fields(
  before: JsonObject,
  after: JsonObject,
  skip: string[] = [],
): Field[] {
  const result: Field[] = [];
  function visit(a: JsonObject, b: JsonObject, path: string[]) {
    for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
      if (!path.length && skip.includes(key)) continue;
      const av = a[key], bv = b[key], next = [...path, key];
      if (equal(av, bv)) continue;
      if (
        av && bv && typeof av === "object" && typeof bv === "object" &&
        !Array.isArray(av) && !Array.isArray(bv)
      ) visit(av, bv, next);
      else {result.push({
          path: next,
          value: bv === undefined
            ? { present: false }
            : { present: true, value: clone(bv) },
        });}
    }
  }
  visit(before, after, []);
  return result;
}
