import { clone, targetKey, validateDoc } from "./json.ts";
import {
  type BentoDoc,
  type ComponentCreation,
  type ComponentFrame,
  type ComponentProjection,
  type ProjectState,
  StateError,
  type Target,
} from "./types.ts";

const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
function exact(value: Record<string, unknown>, keys: string[]) {
  return Object.keys(value).length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key));
}
const sourceId = (value: unknown): value is string =>
  typeof value === "string" && /^[A-Za-z][\w:.-]{0,119}$/.test(value);
function validFrame(value: unknown): value is ComponentFrame {
  return object(value) && exact(value, ["x", "y", "w", "h"]) &&
    Object.values(value).every((number) =>
      typeof number === "number" && Number.isFinite(number)
    ) &&
    Number(value.w) > 0 && Number(value.h) > 0;
}
/** Reserve source and generated identities, including hidden durable metadata. */
export function componentIdentities(
  id: string,
  kind: "card" | "kpi",
): string[] {
  const roles = kind === "card"
    ? ["title", "body"]
    : ["label", "value", "detail"];
  return [
    id,
    `${id}/qb-${kind}-background`,
    ...roles.flatMap((role) => [
      `${id}-${role}`,
      ...(role === "title" ? [] : [`${id}-${role}/paragraph:1`]),
    ]),
  ];
}
export function validateComponentProjections(
  value: unknown,
  intents: ComponentCreation[] = [],
): asserts value is ComponentProjection[] | undefined {
  if (value === undefined) return;
  const fail = (): never => {
    throw new StateError(
      "INVALID_COMPONENT_PROJECTION",
      "Invalid, overlapping or unknown component projection metadata.",
    );
  };
  if (!Array.isArray(value) || value.length + intents.length > 5000) fail();
  const reserved = new Set(
    intents.flatMap((intent) => componentIdentities(intent.id, intent.kind)),
  );
  for (const entry of value as ComponentProjection[]) {
    if (
      !object(entry) ||
      !exact(entry, ["version", "id", "kind", "slideId", "frame"]) ||
      entry.version !== 1 || !sourceId(entry.id) ||
      !["card", "kpi"].includes(entry.kind) ||
      typeof entry.slideId !== "string" || !entry.slideId ||
      !validFrame(entry.frame)
    ) fail();
    const ids = componentIdentities(entry.id, entry.kind);
    if (ids.some((id) => reserved.has(id))) fail();
    ids.forEach((id) => reserved.add(id));
  }
}
export function componentOwns(state: ProjectState, target: Target): boolean {
  return !!state.componentCreations?.some((intent) =>
    intent.slideId === target.slideId &&
    (intent.backgroundId === target.elementId ||
      intent.members.some((member) => member.nativeId === target.elementId))
  );
}
/** Exact versioned ownership, never inferred from positions or native groupId. */
export function validateComponentCreations(
  value: unknown,
  docId: string,
): asserts value is ComponentCreation[] | undefined {
  if (value === undefined) return;
  const fail = (): never => {
    throw new StateError(
      "INVALID_COMPONENT_INTENT",
      "Invalid, overlapping or unknown component creation metadata.",
    );
  };
  if (!Array.isArray(value) || value.length > 128) fail();
  const sources = new Set<string>(), native = new Set<string>();
  for (const entry of value as ComponentCreation[]) {
    if (
      !object(entry) ||
      !exact(entry, [
        "version",
        "id",
        "kind",
        "slideId",
        "backgroundId",
        "backgroundSnapshot",
        "projectionFrame",
        "restoreOrder",
        "members",
      ]) || entry.version !== 1 || !sourceId(entry.id) ||
      !["card", "kpi"].includes(entry.kind) ||
      typeof entry.slideId !== "string" || !entry.slideId ||
      entry.backgroundId !== `${entry.id}/qb-${entry.kind}-background` ||
      !Array.isArray(entry.members) || !validFrame(entry.projectionFrame)
    ) fail();
    const roles = entry.kind === "card"
      ? ["title", "body"]
      : ["label", "value", ...(entry.members.length === 3 ? ["detail"] : [])];
    if (entry.members.length !== roles.length) fail();
    if (sources.has(entry.id)) fail();
    sources.add(entry.id);
    for (const [index, member] of entry.members.entries()) {
      if (
        !object(member) ||
        !exact(member, ["role", "sourceId", "nativeId", "snapshot"]) ||
        member.role !== roles[index] ||
        member.sourceId !== `${entry.id}-${member.role}` ||
        member.nativeId !==
          (member.role === "title"
            ? member.sourceId
            : `${member.sourceId}/paragraph:1`) ||
        !object(member.snapshot) || member.snapshot.id !== member.nativeId ||
        member.snapshot.type !== "text" ||
        typeof member.snapshot.html !== "string" || sources.has(member.sourceId)
      ) fail();
      sources.add(member.sourceId);
      // Implicit paragraph IDs are source identities too.
      if (member.nativeId !== member.sourceId) {
        if (sources.has(member.nativeId)) fail();
        sources.add(member.nativeId);
      }
    }
    if (
      !object(entry.backgroundSnapshot) ||
      entry.backgroundSnapshot.id !== entry.backgroundId ||
      entry.backgroundSnapshot.type !== "shape" ||
      entry.backgroundSnapshot.shape !== "rect"
    ) fail();
    const memberIds = [
      entry.backgroundId,
      ...entry.members.map((member) => member.nativeId),
    ];
    if (
      !Array.isArray(entry.restoreOrder) || entry.restoreOrder.length > 5000 ||
      entry.restoreOrder.some((id) => typeof id !== "string" || !id) ||
      new Set(entry.restoreOrder).size !== entry.restoreOrder.length ||
      memberIds.some((id) => !entry.restoreOrder.includes(id))
    ) fail();
    const snapshots = [
      entry.backgroundSnapshot,
      ...entry.members.map((member) => member.snapshot),
    ];
    for (const snapshot of snapshots) {
      const key = targetKey({ slideId: entry.slideId, elementId: snapshot.id });
      if (native.has(key)) fail();
      native.add(key);
    }
    validateDoc({
      docId,
      slides: [{ id: entry.slideId, elements: snapshots }],
    });
  }
}
/** Last-present snapshots survive missing fields and the containing slide's deletion. */
export function captureComponentSnapshots(
  state: ProjectState,
  edited: BentoDoc,
): void {
  state.componentCreations = state.componentCreations?.filter((intent) => {
    const slide = edited.slides.find((slide) => slide.id === intent.slideId);
    if (!slide) return true;
    const ids = [
      intent.backgroundId,
      ...intent.members.map((member) => member.nativeId),
    ];
    const known = slide.elements.filter((element) => ids.includes(element.id));
    const extra = slide.elements.some((element) =>
      element.groupId === intent.id && !ids.includes(element.id)
    );
    if (!known.length && !extra) return false;
    if (ids.every((id) => known.some((element) => element.id === id))) {
      intent.restoreOrder = slide.elements.map((element) => element.id);
    }
    for (const member of intent.members) {
      const current = known.find((element) => element.id === member.nativeId);
      if (current?.type === "text" && typeof current.html === "string") {
        member.snapshot = clone(current);
      }
    }
    const background = known.find((element) =>
      element.id === intent.backgroundId
    );
    if (background?.type === "shape" && background.shape === "rect") {
      intent.backgroundSnapshot = clone(background);
    }
    return true;
  });
  if (!state.componentCreations?.length) delete state.componentCreations;
}
export function componentProblems(
  state: ProjectState,
  intent: ComponentCreation,
): string[] {
  const slide = state.emitted.slides.find((slide) =>
    slide.id === intent.slideId
  );
  if (!slide) {
    return [
      "La diapositiva está pendiente de eliminación: restáurala primero o revisa su eliminación.",
    ];
  }
  const ids = [
    intent.backgroundId,
    ...intent.members.map((member) => member.nativeId),
  ];
  const problems: string[] = [];
  const background = slide.elements.find((element) =>
    element.id === intent.backgroundId
  );
  if (
    !background || background.type !== "shape" || background.shape !== "rect"
  ) problems.push("Falta el fondo rectangular original o cambió su tipo.");
  for (const member of intent.members) {
    const element = slide.elements.find((element) =>
      element.id === member.nativeId
    );
    if (
      !element || element.type !== "text" || typeof element.html !== "string"
    ) {
      problems.push(
        `Falta el campo ${
          {
            title: "título",
            body: "cuerpo",
            label: "etiqueta",
            value: "valor",
            detail: "detalle",
          }[member.role]
        } original o cambió su tipo.`,
      );
    }
    const pending = state.pending.find((change) =>
      change.kind === "create-element" &&
      change.target.slideId === intent.slideId &&
      change.target.elementId === member.nativeId
    );
    if (
      element &&
      (!pending || pending.origin !== "authored" || pending.before.present)
    ) {
      problems.push(
        `El campo ${
          {
            title: "título",
            body: "cuerpo",
            label: "etiqueta",
            value: "valor",
            detail: "detalle",
          }[member.role]
        } no conserva una creación pendiente verificable.`,
      );
    }
  }
  if (
    slide.elements.some((element) =>
      element.groupId === intent.id && !ids.includes(element.id)
    )
  ) {
    problems.push(
      "Hay objetos adicionales en el grupo. Sepáralos o descarta el componente pendiente.",
    );
  }
  return problems;
}
