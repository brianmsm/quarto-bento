import {
  type BentoDoc,
  type BentoElement,
  type BentoSlide,
  type Change,
  type JsonObject,
  type OwnershipMap,
  type ProjectState,
  type ProvenanceMap,
  StateError,
  type Target,
  type Value,
} from "./types.ts";
import {
  assertJson,
  clone,
  entity,
  equal,
  fields,
  get,
  set,
  targetKey,
  validateDoc,
} from "./json.ts";
import { assertGraphDocument, graphRelationshipPath } from "./graphs.ts";

const semanticFields = new Set([
  "html",
  "text",
  "content",
  "src",
  "svg",
  "data",
  "option",
  "preset",
  "source",
  "rows",
  "header",
  "columns",
  "cells",
  "code",
  "language",
  "grammarName",
  "latex",
  "notes",
  "title",
  "type",
  "url",
]);
function id(target: Target, path: string[], kind: string): string {
  return JSON.stringify([targetKey(target), kind, path]);
}
function origin(state: ProjectState, target: Target) {
  return state.provenance[targetKey(target)]?.origin ?? "authored";
}
function semantic(
  state: ProjectState,
  target: Target,
  path: string[],
): boolean {
  if (graphRelationshipPath(state.provenance[targetKey(target)], path)) {
    return true;
  }
  if (
    state.ownership[targetKey(target)]?.some((p) =>
      p === path.join("/") || p === path[0] ||
      path.join("/").startsWith(p + "/")
    )
  ) return true;
  return semanticFields.has(path[0]);
}
function upsert(state: ProjectState, change: Change): void {
  const old = state.pending.find((p) => p.id === change.id);
  if (old) {
    change.before = old.before;
    if (old.restoreOrder) change.restoreOrder = clone(old.restoreOrder);
  }
  state.pending = state.pending.filter((p) => p.id !== change.id);
  if (!equal(change.before, change.after)) state.pending.push(change);
}
function change(
  state: ProjectState,
  target: Target,
  path: string[],
  before: Value,
  after: Value,
  kind: Change["kind"] = "field",
): void {
  const previous = state.pending.find((p) => p.id === id(target, path, kind));
  const from = previous?.origin === "detached"
    ? "detached"
    : kind === "field" && !semanticFields.has(path[0])
    ? "authored"
    : origin(state, target);
  upsert(state, {
    id: id(target, path, kind),
    target: clone(target),
    path,
    kind,
    origin: from,
    status: from === "computed" ? "conflict" : "bento-ahead",
    before,
    after,
    ...(from === "computed"
      ? {
        reason:
          "Computed content must be restored, edited at its producer, or explicitly detached.",
      }
      : {}),
  });
}
export function createState(
  generated: BentoDoc,
  provenance: ProvenanceMap = {},
  ownership: OwnershipMap = {},
): ProjectState {
  validateDoc(generated);
  assertJson(provenance);
  assertJson(ownership);
  return {
    schemaVersion: 1,
    revision: 0,
    docId: generated.docId,
    generatedBaseline: clone(generated),
    emitted: clone(generated),
    provenance: clone(provenance),
    ownership: clone(ownership),
    overrides: [],
    elementOrders: [],
    bentoOnly: [],
    pending: [],
  };
}
/** Persist edits relative to the actual last emitted/saved document, never relative to stale source. */
export function captureEdits(
  input: ProjectState,
  edited: BentoDoc,
): ProjectState {
  validateState(input);
  validateDoc(edited);
  assertGraphDocument(edited, input.provenance, {
    capture: true,
    baseline: input.emitted,
  });
  if (input.docId !== edited.docId) {
    throw new StateError(
      "UNRELATED_DOCUMENT",
      "The edited HTML belongs to a different docId.",
    );
  }
  const state = clone(input);
  function capture(
    target: Target,
    before: JsonObject,
    after: JsonObject,
    skip: string[],
    restored = false,
  ) {
    if (
      state.pending.some((p) =>
        (p.kind === "create-slide" && p.target.slideId === target.slideId) ||
        (p.kind === "create-element" && equal(p.target, target))
      )
    ) return;
    if (restored) {
      // Restoring an absent object is a complete snapshot, so a value restored to
      // the source baseline explicitly cancels older hidden pending/visual edits.
      state.pending = state.pending.filter((p) =>
        !(p.kind === "field" && equal(p.target, target) &&
          equal(get(before, p.path), get(after, p.path)))
      );
      state.overrides = state.overrides.filter((o) => !equal(o.target, target));
    }
    for (const field of fields(before, after, skip)) {
      if (semantic(state, target, field.path)) {
        change(
          state,
          target,
          field.path,
          get(entity(state.generatedBaseline, target), field.path),
          field.value,
        );
      } else {
        let overlay = state.overrides.find((o) => equal(o.target, target));
        if (!overlay) {
          overlay = { target: clone(target), fields: [] };
          state.overrides.push(overlay);
        }
        overlay.fields = overlay.fields.filter((f) =>
          !equal(f.path, field.path)
        );
        if (
          !equal(
            get(entity(state.generatedBaseline, target), field.path),
            field.value,
          )
        ) overlay.fields.push(clone(field));
      }
    }
  }
  capture({}, state.emitted, edited, ["docId", "slides", "format", "version"]);
  for (const oldSlide of state.emitted.slides) {
    const slide = edited.slides.find((s) => s.id === oldSlide.id);
    if (!slide) {
      change(
        state,
        { slideId: oldSlide.id },
        [],
        get(entity(state.generatedBaseline, { slideId: oldSlide.id }), []),
        { present: false },
        "delete-slide",
      );
      const deletion = state.pending.find((p) =>
        p.kind === "delete-slide" && p.target.slideId === oldSlide.id
      );
      if (deletion) {
        deletion.restoreOrder ??= state.emitted.slides.map((s) => s.id);
      }
      continue;
    }
    if (
      state.pending.some((p) =>
        p.kind === "create-slide" && p.target.slideId === slide.id
      )
    ) continue;
    capture({ slideId: slide.id }, oldSlide, slide, ["id", "elements"]);
    if (
      !equal(
        oldSlide.elements.map((e) => e.id),
        slide.elements.map((e) => e.id),
      )
    ) {
      state.elementOrders = state.elementOrders.filter((o) =>
        o.slideId !== slide.id
      );
      state.elementOrders.push({
        slideId: slide.id,
        ids: slide.elements.map((e) => e.id),
      });
    }
    for (const oldEl of oldSlide.elements) {
      const el = slide.elements.find((e) => e.id === oldEl.id),
        target = { slideId: slide.id, elementId: oldEl.id };
      const decorative = state.bentoOnly.find((e) =>
        e.slideId === slide.id && e.element.id === oldEl.id
      );
      if (decorative) {
        if (el) decorative.element = clone(el);
        else state.bentoOnly = state.bentoOnly.filter((e) => e !== decorative);
      } else if (!el) {
        change(
          state,
          target,
          [],
          get(entity(state.generatedBaseline, target), []),
          {
            present: false,
          },
          "delete-element",
        );
        const deletion = state.pending.find((p) =>
          p.kind === "delete-element" && equal(p.target, target)
        );
        if (deletion) {
          deletion.restoreOrder ??= oldSlide.elements.map((item) => item.id);
        }
      } else capture(target, oldEl, el, ["id"]);
    }
    for (
      const el of slide.elements.filter((e) =>
        !oldSlide.elements.some((o) => o.id === e.id)
      )
    ) {
      const target = { slideId: slide.id, elementId: el.id };
      const existingSource = entity(state.generatedBaseline, target);
      if (existingSource) {
        capture(target, existingSource, el, ["id"], true);
        continue;
      }
      if (["shape", "line", "arrow", "path"].includes(el.type)) {
        state.bentoOnly.push({ slideId: slide.id, element: clone(el) });
      } else {change(state, target, [], { present: false }, {
          present: true,
          value: el,
        }, "create-element");}
    }
  }
  for (
    const slide of edited.slides.filter((s) =>
      !state.emitted.slides.some((o) => o.id === s.id)
    )
  ) {
    const original = state.generatedBaseline.slides.find((s) =>
      s.id === slide.id
    );
    if (original) {
      capture({ slideId: slide.id }, original, slide, ["id", "elements"], true);
      state.elementOrders = state.elementOrders.filter((o) =>
        o.slideId !== slide.id
      );
      state.elementOrders.push({
        slideId: slide.id,
        ids: slide.elements.map((e) => e.id),
      });
      for (const el of slide.elements) {
        const target = { slideId: slide.id, elementId: el.id };
        const old = original.elements.find((e) => e.id === el.id);
        if (old) capture(target, old, el, ["id"], true);
        else if (["shape", "line", "arrow", "path"].includes(el.type)) {
          state.bentoOnly = state.bentoOnly.filter((o) =>
            !(o.slideId === slide.id && o.element.id === el.id)
          );
          state.bentoOnly.push({ slideId: slide.id, element: clone(el) });
        } else {change(state, target, [], { present: false }, {
            present: true,
            value: el,
          }, "create-element");}
      }
      for (
        const old of original.elements.filter((e) =>
          !slide.elements.some((el) => el.id === e.id)
        )
      ) {
        change(
          state,
          { slideId: slide.id, elementId: old.id },
          [],
          { present: true, value: old },
          { present: false },
          "delete-element",
        );
      }
      state.bentoOnly = state.bentoOnly.filter((o) =>
        o.slideId !== slide.id ||
        slide.elements.some((el) => el.id === o.element.id)
      );
    } else {change(state, { slideId: slide.id }, [], { present: false }, {
        present: true,
        value: slide,
      }, "create-slide");}
  }
  // Refresh pending creations with their latest complete content; a new object has no source entity yet.
  for (const pending of state.pending) {
    if (pending.kind === "create-slide" || pending.kind === "create-element") {
      const current = entity(edited, pending.target);
      if (current) pending.after = { present: true, value: clone(current) };
    }
  }
  state.pending = state.pending.filter((p) =>
    !(p.kind.startsWith("create-") && !entity(edited, p.target)) &&
    !(p.kind.startsWith("delete-") && entity(edited, p.target))
  );
  const beforeOrder = state.emitted.slides.map((s) => s.id),
    afterOrder = edited.slides.map((s) => s.id);
  if (!equal(beforeOrder, afterOrder)) {
    change(
      state,
      {},
      ["slides"],
      { present: true, value: state.generatedBaseline.slides.map((s) => s.id) },
      { present: true, value: afterOrder },
      "slide-order",
    );
  }
  state.overrides = state.overrides.filter((o) => o.fields.length);
  state.emitted = clone(edited);
  return state;
}
/**
 * After an approved source sync and fresh execution, adopt explicitly listed
 * creations as source-backed objects without losing native visual design.
 * IDs and semantic fields must agree; this function never writes or approves QMD.
 * Call compose() with the returned state and the same generated document next.
 */
export function promoteCreated(
  input: ProjectState,
  generated: BentoDoc,
  approvedChangeIds: string[],
): ProjectState {
  validateState(input);
  validateDoc(generated);
  if (generated.docId !== input.docId) {
    throw new StateError(
      "DOC_ID_CHANGED",
      "Promotion must preserve project identity.",
    );
  }
  if (new Set(approvedChangeIds).size !== approvedChangeIds.length) {
    throw new StateError(
      "INVALID_PROMOTION",
      "Creation approval IDs must be unique.",
    );
  }
  const state = clone(input);
  function retainVisual(
    target: Target,
    source: JsonObject,
    edited: JsonObject,
    skip: string[],
  ) {
    for (const field of fields(source, edited, skip)) {
      if (semantic(state, target, field.path)) {
        // Native optional empty notes/title are semantically equivalent to absence.
        const previous = get(source, field.path);
        const empty = (v: Value) => !v.present || v.value === "";
        if (
          ["notes", "title"].includes(field.path[0]) && empty(previous) &&
          empty(field.value)
        ) continue;
        throw new StateError(
          "PROMOTION_SEMANTIC_MISMATCH",
          "Approved creation differs from its executed source; do not consume its pending content.",
          { target, path: field.path, source: previous, edited: field.value },
        );
      }
      let overlay = state.overrides.find((o) => equal(o.target, target));
      if (!overlay) {
        overlay = { target: clone(target), fields: [] };
        state.overrides.push(overlay);
      }
      overlay.fields = overlay.fields.filter((f) => !equal(f.path, field.path));
      overlay.fields.push(clone(field));
    }
  }
  for (const changeId of approvedChangeIds) {
    const pending = state.pending.find((p) => p.id === changeId);
    if (
      !pending || !["create-slide", "create-element"].includes(pending.kind)
    ) {
      throw new StateError(
        "INVALID_PROMOTION",
        "Only explicitly approved pending creations can be promoted.",
      );
    }
    const source = entity(generated, pending.target);
    if (!source) {
      throw new StateError(
        "PROMOTION_SOURCE_MISSING",
        "Fresh execution must contain the approved creation's stable ID.",
        pending.target,
      );
    }
    const edited = pending.after.value as JsonObject;
    if (pending.kind === "create-element") {
      retainVisual(pending.target, source, edited, ["id"]);
    } else {
      const sourceSlide = source as BentoSlide,
        editedSlide = edited as BentoSlide;
      retainVisual(pending.target, sourceSlide, editedSlide, [
        "id",
        "elements",
      ]);
      for (const el of editedSlide.elements) {
        const target = { slideId: editedSlide.id, elementId: el.id };
        const sourceEl = sourceSlide.elements.find((e) => e.id === el.id);
        if (sourceEl) retainVisual(target, sourceEl, el, ["id"]);
        else if (["shape", "line", "arrow", "path"].includes(el.type)) {
          state.bentoOnly = state.bentoOnly.filter((o) =>
            !(o.slideId === editedSlide.id && o.element.id === el.id)
          );
          state.bentoOnly.push({ slideId: editedSlide.id, element: clone(el) });
        } else {throw new StateError(
            "PROMOTION_SOURCE_MISSING",
            "An authored element on the approved slide has no stable source identity.",
            target,
          );}
      }
      state.elementOrders = state.elementOrders.filter((o) =>
        o.slideId !== editedSlide.id
      );
      state.elementOrders.push({
        slideId: editedSlide.id,
        ids: editedSlide.elements.map((e) => e.id),
      });
    }
    state.pending = state.pending.filter((p) => p.id !== changeId);
  }
  validateState(state);
  return state;
}
export function compose(
  input: ProjectState,
  generated: BentoDoc,
  provenance = input.provenance,
  ownership = input.ownership,
  options: { strict?: boolean } = {},
): { state: ProjectState; document: BentoDoc; changes: Change[] } {
  validateState(input);
  validateDoc(generated);
  assertJson(provenance);
  assertJson(ownership);
  if (generated.docId !== input.docId) {
    throw new StateError(
      "DOC_ID_CHANGED",
      "Regeneration must reuse the saved docId.",
    );
  }
  const state = clone(input), doc = clone(generated);
  state.provenance = clone(provenance);
  state.ownership = clone(ownership);
  const retained: Change[] = [];
  // Slide deletion keeps its original confirmation behavior. Element retirement
  // is approved explicitly by prepareApprovedSync after fresh execution; an
  // independent source removal cannot authorize discarding its retained edits.
  const deleted = state.pending.filter((p) =>
    p.kind === "delete-slide" && !entity(generated, p.target)
  );
  const underDeleted = (target: Target) =>
    deleted.some((p) =>
      p.target.slideId === target.slideId &&
      (!p.target.elementId || p.target.elementId === target.elementId)
    );
  state.overrides = state.overrides.filter((o) => !underDeleted(o.target));
  state.bentoOnly = state.bentoOnly.filter((o) =>
    !underDeleted({ slideId: o.slideId, elementId: o.element.id })
  );
  state.elementOrders = state.elementOrders.filter((o) =>
    !deleted.some((p) =>
      p.kind === "delete-slide" && p.target.slideId === o.slideId
    )
  );
  state.pending = state.pending.filter((p) => !underDeleted(p.target));
  for (const overlay of state.overrides) {
    const obj = entity(doc, overlay.target);
    if (!obj) {
      const previousOrphan = input.pending.find((p) =>
        p.kind === "orphan" && equal(p.target, overlay.target)
      );
      const old = previousOrphan?.after.value ??
        entity(input.emitted, overlay.target) ??
        entity(input.generatedBaseline, overlay.target);
      retained.push({
        id: id(overlay.target, [], "orphan"),
        target: overlay.target,
        path: [],
        kind: "orphan",
        origin: origin(state, overlay.target),
        status: "conflict",
        before: { present: true, value: old ?? null },
        after: { present: true, value: old ?? null },
        source: { present: false },
        reason:
          "Source removed an object with saved visual design. Restore or explicitly discard its design.",
      });
      continue;
    }
    for (const field of overlay.fields) {
      if (semantic(state, overlay.target, field.path)) {
        retained.push({
          id: id(overlay.target, field.path, "field"),
          target: overlay.target,
          path: field.path,
          kind: "field",
          origin: origin(state, overlay.target),
          status: "conflict",
          before: get(
            entity(input.generatedBaseline, overlay.target),
            field.path,
          ),
          after: field.value,
          source: get(obj, field.path),
          reason:
            "A saved visual property is now explicitly owned by QMD. Resolve this ownership change.",
        });
      } else set(obj, field.path, field.value);
    }
  }
  for (const item of state.bentoOnly) {
    const slide = doc.slides.find((s) => s.id === item.slideId);
    if (!slide || slide.elements.some((e) => e.id === item.element.id)) {
      retained.push({
        id: id(
          { slideId: item.slideId, elementId: item.element.id },
          [],
          "orphan",
        ),
        target: { slideId: item.slideId, elementId: item.element.id },
        path: [],
        kind: "orphan",
        origin: "bento-only",
        status: "conflict",
        before: { present: false },
        after: { present: true, value: item.element },
        reason:
          "Decoration has no source slide or its ID now collides with generated content.",
      });
    } else slide.elements.push(clone(item.element));
  }
  for (const pending of state.pending.filter((p) => p.kind !== "orphan")) {
    const p = clone(pending), obj = entity(generated, p.target);
    let source: Value;
    if (p.kind === "slide-order") {
      source = {
        present: true,
        value: generated.slides.map((s) => s.id),
      };
    } else {source = p.kind === "field"
        ? get(obj, p.path)
        : obj
        ? { present: true, value: obj }
        : { present: false };}
    // A matching source independently confirms that particular edit; other pending fields survive.
    const creation = p.kind === "create-slide" || p.kind === "create-element";
    if (
      !creation && p.origin !== "detached" && equal(source, p.after) &&
      p.kind !== "delete-element"
    ) {
      continue;
    }
    p.source = source;
    p.status = p.origin === "detached"
      ? "bento-ahead"
      : p.origin === "computed" || !equal(source, p.before)
      ? "conflict"
      : "bento-ahead";
    if (creation && obj) {
      p.status = "conflict";
      p.reason =
        "A source object now occupies this pending creation ID. Explicitly promote the approved synchronized creation to preserve its design; coincident IDs are not proof of approval.";
    }
    if (p.kind === "delete-element" && !obj) {
      p.status = "conflict";
      p.reason =
        "The source element is absent without verified deletion approval. Retained content and design remain recoverable; review or recover the source before retiring them.";
    }
    if (p.kind === "field" && !obj) {
      p.status = "conflict";
      p.reason = "The source object for this pending edit no longer exists.";
    }
    if (p.status === "conflict" && !p.reason) {
      p.reason =
        "QMD and Bento changed the same field differently since their shared baseline.";
    }
    retained.push(p);
    // Non-strict preview keeps pending values visible. Strict rendering refuses all conflicts below.
    if (p.kind === "field") {
      const target = entity(doc, p.target);
      if (target) set(target, p.path, p.after);
    } else if (p.kind === "create-slide" && !obj) {
      doc.slides.push(clone(p.after.value as BentoSlide));
    } else if (p.kind === "create-element" && !obj) {
      doc.slides.find((s) => s.id === p.target.slideId)?.elements.push(
        clone(p.after.value as BentoElement),
      );
    } else if (p.kind === "delete-slide") {
      doc.slides = doc.slides.filter((s) => s.id !== p.target.slideId);
    } else if (p.kind === "delete-element") {
      const s = doc.slides.find((s) => s.id === p.target.slideId);
      if (s) s.elements = s.elements.filter((e) => e.id !== p.target.elementId);
    }
  }
  for (const order of state.elementOrders) {
    const slide = doc.slides.find((s) => s.id === order.slideId);
    if (slide) {
      const rank = (el: BentoElement) => {
        const i = order.ids.indexOf(el.id);
        return i < 0 ? order.ids.length : i;
      };
      slide.elements.sort((a, b) => rank(a) - rank(b));
    }
  }
  const order = retained.find((p) => p.kind === "slide-order");
  if (order) {
    const ids = order.after.value as string[],
      rank = (s: BentoSlide) => {
        const i = ids.indexOf(s.id);
        return i < 0 ? ids.length : i;
      };
    doc.slides.sort((a, b) => rank(a) - rank(b));
  }
  state.pending = retained.filter((p, i, all) =>
    all.findIndex((q) => q.id === p.id) === i
  );
  const conflicts = state.pending.filter((p) => p.status === "conflict");
  if (options.strict !== false && conflicts.length) {
    throw new StateError(
      "MERGE_CONFLICT",
      `${conflicts.length} unresolved change(s); inspect status/diff and explicitly resolve before rendering.`,
      conflicts,
    );
  }
  validateDoc(doc);
  assertGraphDocument(doc, state.provenance, {
    strict: options.strict,
    baseline: input.emitted,
    pending: state.pending,
  });
  state.generatedBaseline = clone(generated);
  state.emitted = clone(doc);
  return { state, document: doc, changes: clone(state.pending) };
}
/** Explicit field resolution. keep-source removes that pending value; detach records the exception. */
export function resolveChange(
  input: ProjectState,
  changeId: string,
  action: "keep-source" | "detach",
): ProjectState {
  validateState(input);
  const state = clone(input), p = state.pending.find((p) => p.id === changeId);
  if (!p) {
    throw new StateError("UNKNOWN_CHANGE", "Pending change was not found.");
  }
  if (action === "detach") {
    if (p.kind !== "field" || p.origin !== "computed") {
      throw new StateError(
        "INVALID_DETACH",
        "Only a computed field can be detached.",
      );
    }
    p.origin = "detached";
    p.status = "bento-ahead";
    p.before = p.source ?? p.before;
    delete p.reason;
  } else {
    state.pending = state.pending.filter((q) => q.id !== changeId);
    if (p.kind === "field") {
      const target = entity(state.emitted, p.target);
      if (target) {
        set(
          target,
          p.path,
          get(entity(state.generatedBaseline, p.target), p.path),
        );
      }
    }
    if (p.kind === "orphan") {
      state.overrides = state.overrides.filter((o) =>
        !equal(o.target, p.target)
      );
      state.bentoOnly = state.bentoOnly.filter((b) =>
        !(b.slideId === p.target.slideId && b.element.id === p.target.elementId)
      );
    }
  }
  return state;
}
export function validateState(value: unknown): asserts value is ProjectState {
  assertJson(value);
  const s = value as unknown as ProjectState;
  if (!s || s.schemaVersion !== 1) {
    throw new StateError(
      "UNSUPPORTED_STATE_VERSION",
      "Unsupported project-state version; do not overwrite it.",
    );
  }
  if (!Number.isSafeInteger(s.revision) || s.revision < 0) {
    throw new StateError(
      "INVALID_STATE",
      "State revision must be a nonnegative integer.",
    );
  }
  validateDoc(s.generatedBaseline);
  validateDoc(s.emitted);
  if (s.docId !== s.generatedBaseline.docId || s.docId !== s.emitted.docId) {
    throw new StateError(
      "INVALID_STATE",
      "State docId does not match its document snapshots.",
    );
  }
  if (
    !Array.isArray(s.overrides) || !Array.isArray(s.elementOrders) ||
    !Array.isArray(s.bentoOnly) || !Array.isArray(s.pending) || !s.provenance ||
    !s.ownership
  ) throw new StateError("INVALID_STATE", "State collections are missing.");
  const object = (v: unknown): v is Record<string, unknown> =>
    !!v && typeof v === "object" && !Array.isArray(v);
  const target = (v: unknown) =>
    object(v) &&
    (v.slideId === undefined || typeof v.slideId === "string" && !!v.slideId) &&
    (v.elementId === undefined ||
      typeof v.elementId === "string" && !!v.elementId &&
        typeof v.slideId === "string");
  const path = (v: unknown): v is string[] =>
    Array.isArray(v) &&
    v.every((k) =>
      typeof k === "string" &&
      !["__proto__", "constructor", "prototype"].includes(k)
    );
  const fieldValue = (v: unknown) =>
    object(v) && typeof v.present === "boolean" &&
    (!v.present || Object.hasOwn(v, "value"));
  const fail = (message: string): never => {
    throw new StateError("INVALID_STATE", message);
  };
  if (!object(s.provenance) || !object(s.ownership)) {
    fail("Malformed provenance or ownership map.");
  }
  for (const provenance of Object.values(s.provenance)) {
    if (
      !object(provenance) ||
      !["authored", "computed", "bento-only", "detached"].includes(
        provenance.origin,
      )
    ) fail("Invalid provenance origin.");
  }
  for (const owned of Object.values(s.ownership)) {
    if (!Array.isArray(owned) || !owned.every((v) => typeof v === "string")) {
      fail("Invalid ownership paths.");
    }
  }
  for (const o of s.overrides) {
    if (!object(o) || !target(o.target) || !Array.isArray(o.fields)) {
      fail("Malformed visual override.");
    }
    for (const f of o.fields) {
      if (
        !object(f) || !path(f.path) || !f.path.length || !fieldValue(f.value)
      ) fail("Malformed visual field.");
    }
  }
  for (const order of s.elementOrders) {
    if (
      !object(order) || typeof order.slideId !== "string" ||
      !Array.isArray(order.ids) || !order.ids.every((id) =>
        typeof id === "string"
      ) || new Set(order.ids).size !== order.ids.length
    ) fail("Invalid element order.");
  }
  for (const item of s.bentoOnly) {
    if (!object(item) || typeof item.slideId !== "string" || !item.slideId) {
      fail("Malformed decorative object.");
    }
    validateDoc({
      docId: s.docId,
      slides: [{ id: item.slideId, elements: [item.element] }],
    });
  }
  const changeIds = new Set();
  for (const p of s.pending) {
    if (
      !object(p) || typeof p.id !== "string" || !target(p.target) ||
      !path(p.path) || !fieldValue(p.before) || !fieldValue(p.after) ||
      (p.source !== undefined && !fieldValue(p.source)) ||
      (p.restoreOrder !== undefined &&
        (!["delete-slide", "delete-element"].includes(p.kind) ||
          !Array.isArray(p.restoreOrder) ||
          !p.restoreOrder.every((id) => typeof id === "string" && id) ||
          new Set(p.restoreOrder).size !== p.restoreOrder.length ||
          !p.target.slideId ||
          !p.restoreOrder.includes(
            p.kind === "delete-element"
              ? p.target.elementId!
              : p.target.slideId,
          ))) ||
      ![
        "field",
        "create-slide",
        "create-element",
        "delete-slide",
        "delete-element",
        "slide-order",
        "orphan",
      ].includes(p.kind) ||
      !["authored", "computed", "bento-only", "detached"].includes(p.origin) ||
      !["bento-ahead", "conflict", "bento-only"].includes(p.status) ||
      changeIds.has(p.id)
    ) fail("Malformed or duplicate pending edit.");
    changeIds.add(p.id);
  }
  if (s.widgets) {
    const w = s.widgets,
      digest = (v: unknown) =>
        typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
    if (
      w.version !== 1 || w.docId !== s.docId ||
      !/^[a-f0-9-]{36}$/.test(w.generation) ||
      w.generation !== s.output?.generation || !digest(w.sourceHash) ||
      !digest(w.runtimeSha256) || !digest(w.licenseSha256) ||
      !digest(w.presenterSha256) || !Array.isArray(w.entries) ||
      !w.entries.length || w.entries.length > 8
    ) fail("Invalid widget generation receipt.");
    const ids = new Set<string>();
    for (const [i, entry] of w.entries.entries()) {
      if (
        !object(entry) || typeof entry.slideId !== "string" ||
        typeof entry.elementId !== "string" || ids.has(targetKey(entry)) ||
        entry.file !== `widget-${i}.json` ||
        entry.presenter !== `widget-${i}.html` ||
        !digest(entry.presenterSha256) || !object(entry.receipt) ||
        entry.receipt.version !== 1 || !digest(entry.receipt.bundleHash) ||
        !digest(entry.receipt.specHash) ||
        entry.receipt.runtimeSha256 !== w.runtimeSha256 ||
        !object(entry.receipt.source) ||
        entry.receipt.source.sourceHash !== w.sourceHash ||
        entry.receipt.source.sourceId !== entry.elementId ||
        entry.receipt.source.slideId !== entry.slideId ||
        typeof entry.receipt.source.producerId !== "string" ||
        !digest(entry.receipt.source.chunkHash) ||
        !digest(entry.receipt.source.outputHash)
      ) fail("Invalid widget entry receipt.");
      ids.add(targetKey(entry));
    }
  }
  if (
    s.output &&
    (!object(s.output) || typeof s.output.path !== "string" ||
      !/^[a-f0-9]{64}$/.test(s.output.sha256))
  ) fail("Invalid emitted output receipt.");
}
