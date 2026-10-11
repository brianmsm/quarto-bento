/** Exact component approvals supplement ordinary pending-text promotion. */
import {
  type BentoDoc,
  canonical,
  clone,
  type ComponentCreation,
  componentProblems,
  type ComponentProjection,
  type ProjectState,
  type ProvenanceMap,
  StateError,
  targetKey,
  validateComponentCreations,
  validateComponentProjections,
} from "../state/mod.ts";
import { componentFrame } from "./component-frames.ts";
import { fields } from "../state/json.ts";
import {
  type ComponentInsertion,
  componentMarkdown,
} from "../source/component-insertion.ts";
export interface ComponentApproval {
  version: 1;
  intent: ComponentCreation;
  operation: ComponentInsertion;
}
function fail(code: string, message: string): never {
  throw new StateError(code, message);
}
export function validateComponentApprovals(
  value: unknown,
  retirements: unknown,
  docId: string,
  projectionRetirements?: ComponentProjection[],
) {
  if (value !== undefined) {
    if (!Array.isArray(value) || !value.length) {
      fail(
        "INVALID_APPROVAL",
        "Component approvals must be a nonempty exact collection.",
      );
    }
    validateComponentCreations(
      value.map((approval) => approval?.intent),
      docId,
    );
    for (const approval of value as ComponentApproval[]) {
      if (
        !approval ||
        Object.keys(approval).sort().join(",") !== "intent,operation,version" ||
        approval.version !== 1 ||
        approval.operation?.id !== approval.intent.id ||
        approval.operation?.kind !== approval.intent.kind ||
        approval.operation?.slideId !== approval.intent.slideId ||
        canonical(
            approval.operation.fields.map((
              field,
            ) => [field.role, field.sourceId]),
          ) !==
          canonical(
            approval.intent.members.map((
              member,
            ) => [member.role, member.sourceId]),
          )
      ) {
        fail(
          "INVALID_APPROVAL",
          "Component approval does not identify its exact authored roles.",
        );
      }
      componentMarkdown(approval.operation);
    }
  }
  if (retirements !== undefined) {
    validateComponentCreations(retirements, docId);
    if (
      !(retirements as ComponentCreation[]).length ||
      (retirements as ComponentCreation[]).some((retired) =>
        (value as ComponentApproval[] | undefined)?.some((approval) =>
          approval.intent.id === retired.id
        )
      )
    ) {
      fail(
        "INVALID_APPROVAL",
        "Component retirement overlaps its source acquisition.",
      );
    }
  }
  if (projectionRetirements !== undefined) {
    validateComponentProjections(projectionRetirements, [
      ...(value as ComponentApproval[] | undefined)?.map((approval) =>
        approval.intent
      ) ?? [],
      ...(retirements as ComponentCreation[] | undefined) ?? [],
    ]);
    if (!projectionRetirements.length) {
      fail(
        "INVALID_APPROVAL",
        "Projection retirement must be a nonempty exact collection.",
      );
    }
  }
}
/** Compare approved metadata before consuming any text/background. No ID-only promotion. */
export function prepareComponentApprovals(
  state: ProjectState,
  generated: BentoDoc,
  sourceHash: string,
  approvals: ComponentApproval[] = [],
  retirements: ComponentCreation[] = [],
  freshProvenance?: ProvenanceMap,
  projectionRetirements: ComponentProjection[] = [],
): ProjectState {
  const prepared = clone(state);
  for (
    const expected of [
      ...approvals.map((approval) => approval.intent),
      ...retirements,
    ]
  ) {
    if (
      canonical(
        state.componentCreations?.find((intent) => intent.id === expected.id),
      ) !== canonical(expected)
    ) {
      fail(
        "STALE_APPROVAL",
        "A component's saved membership or member snapshots changed after source synchronization; preserve and review it.",
      );
    }
  }
  for (const record of projectionRetirements) {
    if (
      canonical(
          state.componentProjections?.find((item) => item.id === record.id),
        ) !== canonical(record) ||
      generated.slides.some((slide) => slide.id === record.slideId)
    ) {
      fail(
        "STALE_APPROVAL",
        "Retained projection retires only with its exact approved record and fresh parent deletion proof.",
      );
    }
    prepared.componentProjections = prepared.componentProjections?.filter((
      item,
    ) => item.id !== record.id);
  }
  for (const intent of retirements) {
    if (generated.slides.some((slide) => slide.id === intent.slideId)) {
      fail(
        "STALE_APPROVAL",
        "Fresh execution must omit the exact approved parent slide before retiring its pending component.",
      );
    }
    prepared.componentCreations = prepared.componentCreations?.filter((item) =>
      item.id !== intent.id
    );
  }
  for (const { intent, operation } of approvals) {
    if (componentProblems(state, intent).length) {
      fail(
        "STALE_APPROVAL",
        "Approved component no longer has its exact saved members and background.",
      );
    }
    const slide = generated.slides.find((slide) => slide.id === intent.slideId);
    const wrapper = componentMarkdown(operation);
    // Both source hash and fresh source role proof are mandatory; input provenance is insufficient.
    const background = slide?.elements.find((element) =>
      element.id === intent.backgroundId
    );
    const proof = freshProvenance
      ?.[
        targetKey({ slideId: intent.slideId, elementId: intent.backgroundId })
      ];
    if (
      !background ||
      canonical(componentFrame(background)) !==
        canonical(intent.projectionFrame) ||
      background.type !== "shape" ||
      background.shape !== "rect" || background.groupId !== intent.id ||
      proof?.origin !== "authored" || proof.semanticId !== intent.id ||
      proof.source?.hash !== sourceHash || proof.source?.kind !== "div" ||
      proof.source?.blockId !== intent.id || proof.source?.stable !== true ||
      String(proof.source?.content).replace(/\r\n/g, "\n") !==
        wrapper.slice(wrapper.indexOf("\n") + 1, wrapper.lastIndexOf("::::"))
    ) {
      fail(
        "COMPONENT_PROMOTION_PROOF",
        "Fresh execution must prove the exact identified component and generated design-only background before consuming its pending design.",
      );
    }
    for (const member of intent.members) {
      const roleProof = freshProvenance
        ?.[targetKey({ slideId: intent.slideId, elementId: member.nativeId })];
      const element = slide?.elements.find((element) =>
        element.id === member.nativeId
      );
      if (
        !element || element.type !== "text" ||
        roleProof?.origin !== "authored" ||
        roleProof.semanticId !== member.nativeId ||
        roleProof.source?.hash !== sourceHash ||
        roleProof.source?.blockId !== member.nativeId ||
        roleProof.source?.kind !==
          (member.role === "title" ? "heading" : "paragraph") ||
        (member.role !== "title" &&
          (roleProof.source?.parentId !== member.sourceId ||
            roleProof.source?.siblings !== 1))
      ) {
        fail(
          "COMPONENT_PROMOTION_PROOF",
          "Fresh execution must prove every authored role, source binding and native ID; computed substitutions cannot acquire an authored component.",
        );
      }
    }
    const saved = state.bentoOnly.find((item) =>
      item.slideId === intent.slideId && item.element.id === intent.backgroundId
    );
    if (
      !saved ||
      canonical(saved.element) !== canonical(intent.backgroundSnapshot)
    ) {
      fail(
        "STALE_APPROVAL",
        "The approved pending background snapshot is no longer the saved decoration.",
      );
    }
    const target = { slideId: intent.slideId, elementId: intent.backgroundId };
    for (const field of fields(background, saved.element, ["id"])) {
      let overlay = prepared.overrides.find((item) =>
        canonical(item.target) === canonical(target)
      );
      if (!overlay) {
        overlay = { target, fields: [] };
        prepared.overrides.push(overlay);
      }
      overlay.fields = overlay.fields.filter((item) =>
        canonical(item.path) !== canonical(field.path)
      );
      overlay.fields.push(clone(field));
    }
    // Persist the approved measurement bootstrap, never the saved decorative frame.
    (prepared.componentProjections ??= []).push({
      version: 1,
      id: intent.id,
      kind: intent.kind,
      slideId: intent.slideId,
      frame: clone(intent.projectionFrame),
    });
    // The native background placement is a visual override applied only by compose.
    for (
      const native of [
        saved.element,
        ...intent.members.map((member) => member.snapshot),
      ]
    ) {
      const memberTarget = { slideId: intent.slideId, elementId: native.id };
      let frameOverlay = prepared.overrides.find((item) =>
        canonical(item.target) === canonical(memberTarget)
      );
      if (!frameOverlay) {
        frameOverlay = { target: memberTarget, fields: [] };
        prepared.overrides.push(frameOverlay);
      }
      for (const path of ["x", "y", "w", "h"]) {
        frameOverlay.fields = frameOverlay.fields.filter((field) =>
          canonical(field.path) !== canonical([path])
        );
        frameOverlay.fields.push({
          path: [path],
          value: { present: true, value: native[path] },
        });
      }
    }
    prepared.bentoOnly = prepared.bentoOnly.filter((item) =>
      !(item.slideId === intent.slideId &&
        item.element.id === intent.backgroundId)
    );
    prepared.componentCreations = prepared.componentCreations?.filter((item) =>
      item.id !== intent.id
    );
  }
  if (!prepared.componentCreations?.length) delete prepared.componentCreations;
  if (!prepared.componentProjections?.length) {
    delete prepared.componentProjections;
  }
  return prepared;
}
