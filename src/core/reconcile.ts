/** Reviewed state reconciliation; source writes remain the separate sync operation. */
import { join } from "node:path";
import {
  assertProjectionIdentity,
  projectProjection,
  withProject,
} from "./project.ts";
import { hashSource } from "../source/mod.ts";
import { entity, equal, get } from "../state/json.ts";
import {
  assertOutputUnchanged,
  type BentoDoc,
  canonical,
  type Change,
  clone,
  compose,
  type OwnershipMap,
  type ProjectState,
  type ProvenanceMap,
  StateError,
  targetKey,
  validateDoc,
} from "../state/mod.ts";
export type ReconcileAction = "keep-source" | "keep-bento" | "detach";
export interface ReconcileChoice {
  changeId: string;
  action: ReconcileAction;
}
export interface ReconcileProjection {
  document: BentoDoc;
  provenance: ProvenanceMap;
  ownership?: OwnershipMap;
  sourceHash: string;
  diagnostics?: unknown[];
}
export type ReconcileProjector = (
  source: string,
  state: ProjectState,
) => Promise<ReconcileProjection>;
export interface ReconcileItem {
  change: Change;
  actions: ReconcileAction[];
}
export interface ReconcilePlan {
  version: 1;
  source: string;
  sourceHash: string;
  stateRevision: number;
  stateHash: string;
  projectionHash: string;
  changes: ReconcileItem[];
  document: BentoDoc;
  planHash: string;
}
export interface ReconcileResult {
  state: ProjectState;
  resolved: ReconcileChoice[];
  remaining: Change[];
  renderNeeded: true;
  sourceUnchanged: true;
}
function fail(code: string, message: string, details?: unknown): never {
  throw new StateError(code, message, details);
}
const defaultProjector: ReconcileProjector = (source, state) =>
  projectProjection(source, state);
function owned(projection: ReconcileProjection, change: Change): boolean {
  const path = change.path.join("/");
  return projection.ownership?.[targetKey(change.target)]?.some((p) =>
    p === path || path.startsWith(p + "/")
  ) ?? false;
}
function actionsFor(
  change: Change,
  projection: ReconcileProjection,
): ReconcileAction[] {
  const choices: ReconcileAction[] = ["keep-source"];
  const source = entity(projection.document, change.target);
  if (change.kind === "field" && source) {
    if (change.origin === "computed" && !owned(projection, change)) {
      choices.push("detach");
    } else if (change.origin === "authored" || owned(projection, change)) {
      choices.push("keep-bento");
    }
  } else if (
    change.origin === "authored" &&
    ["delete-slide", "delete-element", "slide-order"].includes(change.kind)
  ) choices.push("keep-bento");
  return choices;
}
async function noPendingApproval(stateDir: string) {
  try {
    await Deno.lstat(join(stateDir, "sync-approved.json"));
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) return;
    throw e;
  }
  fail(
    "SYNC_APPROVAL_PENDING",
    "Finish rendering the approved source synchronization before resolving unrelated state changes.",
  );
}
async function projectionFor(
  source: string,
  state: ProjectState,
  projector: ReconcileProjector,
): Promise<ReconcileProjection> {
  const before = hashSource(await Deno.readTextFile(source)),
    projection = await projector(source, clone(state));
  validateDoc(projection.document);
  if (projection.document.docId !== state.docId) {
    fail(
      "DOC_ID_CHANGED",
      "Conflict inspection must preserve project identity.",
    );
  }
  if (
    projection.sourceHash !== before ||
    hashSource(await Deno.readTextFile(source)) !== before
  ) {
    fail(
      "SOURCE_CHANGED",
      "QMD changed during conflict inspection; execute a fresh preview.",
    );
  }
  assertProjectionIdentity(state, projection.provenance, projection.sourceHash);
  return { ...projection, ownership: projection.ownership ?? state.ownership };
}
function buildPlan(
  source: string,
  state: ProjectState,
  projection: ReconcileProjection,
): { plan: ReconcilePlan; candidate: ProjectState } {
  const composed = compose(
    state,
    projection.document,
    projection.provenance,
    projection.ownership,
    { strict: false },
  );
  const content = {
    version: 1 as const,
    source,
    sourceHash: projection.sourceHash,
    stateRevision: state.revision,
    stateHash: hashSource(canonical(state)),
    projectionHash: hashSource(
      canonical({
        document: projection.document,
        provenance: projection.provenance,
        ownership: projection.ownership ?? {},
        sourceHash: projection.sourceHash,
      }),
    ),
    changes: composed.changes.map((change) => ({
      change,
      actions: actionsFor(change, projection),
    })),
    document: composed.document,
  };
  return {
    plan: { ...content, planHash: hashSource(canonical(content)) },
    candidate: composed.state,
  };
}
/** Executes a fresh projection but never saves project state or writes QMD/HTML. */
export async function previewReconcile(
  source: string,
  projector: ReconcileProjector = defaultProjector,
): Promise<ReconcilePlan> {
  return await withProject(source, async (paths, store) => {
    const state = await store.load();
    if (!state) {
      fail("NO_BASELINE", "Render the project before inspecting divergence.");
    }
    await noPendingApproval(paths.stateDir);
    return buildPlan(
      paths.source,
      state,
      await projectionFor(paths.source, state, projector),
    ).plan;
  });
}
function resolveCandidate(
  candidate: ProjectState,
  projection: ReconcileProjection,
  choices: ReconcileChoice[],
  plan: ReconcilePlan,
): ProjectState {
  const state = clone(candidate);
  if (
    !choices.length ||
    new Set(choices.map((c) => c.changeId)).size !== choices.length
  ) {
    fail(
      "INVALID_RECONCILE_CHOICES",
      "Choose at least one distinct reviewed change.",
    );
  }
  for (const choice of choices) {
    const item = plan.changes.find((i) => i.change.id === choice.changeId);
    if (!item || !item.actions.includes(choice.action)) {
      fail(
        "INVALID_RECONCILE_CHOICE",
        "This resolution is not allowed for the reviewed change.",
        choice,
      );
    }
    const pending = state.pending.find((p) => p.id === choice.changeId);
    if (!pending) {
      fail(
        "OVERLAPPING_RECONCILE_CHOICES",
        "An earlier choice already discarded this dependent change; review a new plan.",
        choice,
      );
    }
    // Source-owned visual properties may be represented by both a conflicting
    // overlay and a pending field; leaving the overlay would recreate the conflict.
    if (pending.kind === "field") {
      state.overrides = state.overrides.map((o) =>
        equal(o.target, pending.target)
          ? {
            ...o,
            fields: o.fields.filter((f) => !equal(f.path, pending.path)),
          }
          : o
      ).filter((o) => o.fields.length);
    }
    if (choice.action === "keep-source") {
      state.pending = state.pending.filter((p) => p.id !== pending.id);
      if (
        pending.kind === "delete-element" && pending.target.elementId &&
        entity(projection.document, pending.target)
      ) {
        // Removing only the deletion lets compose restore pending text and
        // visual overrides; never restore a bare generated-baseline snapshot.
        const slideId = pending.target.slideId!,
          elementId = pending.target.elementId;
        const order = state.elementOrders.find((item) =>
          item.slideId === slideId
        );
        const ids = (order?.ids ?? state.emitted.slides.find((slide) =>
          slide.id === slideId
        )?.elements.map((element) =>
          element.id
        ) ?? [])
          .filter((id) => id !== elementId);
        const original = pending.restoreOrder ??
          projection.document.slides.find((slide) => slide.id === slideId)!
            .elements.map((element) => element.id);
        const position = original.indexOf(elementId);
        const following = original.slice(position + 1).find((id) =>
          ids.includes(id)
        );
        const preceding = original.slice(0, position).reverse().find((id) =>
          ids.includes(id)
        );
        const index = following
          ? ids.indexOf(following)
          : preceding
          ? ids.indexOf(preceding) + 1
          : ids.length;
        ids.splice(index, 0, elementId);
        state.elementOrders = state.elementOrders.filter((item) =>
          item.slideId !== slideId
        );
        state.elementOrders.push({ slideId, ids });
      }
      if (
        pending.kind === "orphan" || pending.kind === "create-slide" ||
        pending.kind === "create-element"
      ) {
        const covers = (target: Change["target"]) =>
          target.slideId === pending.target.slideId &&
          (!pending.target.elementId ||
            target.elementId === pending.target.elementId);
        state.overrides = state.overrides.filter((o) => !covers(o.target));
        state.bentoOnly = state.bentoOnly.filter((o) =>
          !covers({ slideId: o.slideId, elementId: o.element.id })
        );
        state.pending = state.pending.filter((p) => !covers(p.target));
        if (!pending.target.elementId) {
          state.elementOrders = state.elementOrders.filter((o) =>
            o.slideId !== pending.target.slideId
          );
        }
        // Discarding a newly created slide also removes it from a pending order.
        if (
          pending.kind === "create-slide" &&
          !entity(projection.document, pending.target)
        ) {
          for (const p of state.pending) {
            if (p.kind === "slide-order" && p.after.present) {
              p.after.value = (p.after.value as string[]).filter((id) =>
                id !== pending.target.slideId
              );
            }
          }
        }
      }
    } else {
      const current = entity(projection.document, pending.target);
      pending.before = pending.kind === "field"
        ? get(current, pending.path)
        : pending.kind === "slide-order"
        ? { present: true, value: projection.document.slides.map((s) => s.id) }
        : current
        ? { present: true, value: clone(current) }
        : { present: false };
      pending.source = clone(pending.before);
      pending.status = "bento-ahead";
      delete pending.reason;
      pending.origin = choice.action === "detach" ? "detached" : "authored";
    }
  }
  return compose(
    state,
    projection.document,
    projection.provenance,
    projection.ownership,
    { strict: false },
  ).state;
}
/** Re-executes authoritative inputs, verifies the complete reviewed plan, and saves only state. */
export async function applyReconcile(
  source: string,
  plan: ReconcilePlan,
  choices: ReconcileChoice[],
  projector: ReconcileProjector = defaultProjector,
): Promise<ReconcileResult> {
  return await withProject(source, async (paths, store) => {
    const current = await store.load();
    if (!current) {
      fail("NO_BASELINE", "Render the project before resolving divergence.");
    }
    await noPendingApproval(paths.stateDir);
    if (
      !plan || plan.version !== 1 || plan.source !== paths.source ||
      plan.stateRevision !== current.revision ||
      plan.stateHash !== hashSource(canonical(current))
    ) {
      fail(
        "STALE_RECONCILE_STATE",
        "Project state changed after preview; inspect a new plan.",
      );
    }
    if (plan.sourceHash !== hashSource(await Deno.readTextFile(paths.source))) {
      fail(
        "STALE_RECONCILE_SOURCE",
        "QMD changed after preview; inspect a new plan.",
      );
    }
    await assertOutputUnchanged(current, paths.output);
    const projection = await projectionFor(paths.source, current, projector),
      fresh = buildPlan(paths.source, current, projection);
    if (!equal(plan, fresh.plan)) {
      fail(
        "STALE_RECONCILE_PLAN",
        "Execution results or the reviewed plan changed. Inspect a new plan before choosing values.",
      );
    }
    const resolved = resolveCandidate(
      fresh.candidate,
      projection,
      choices,
      plan,
    );
    if (hashSource(await Deno.readTextFile(paths.source)) !== plan.sourceHash) {
      fail(
        "STALE_RECONCILE_SOURCE",
        "QMD changed before state save; no reconciliation was applied.",
      );
    }
    await assertOutputUnchanged(current, paths.output);
    const state = await store.save(resolved, current.revision);
    return {
      state,
      resolved: clone(choices),
      remaining: clone(state.pending),
      renderNeeded: true,
      sourceUnchanged: true,
    };
  });
}
