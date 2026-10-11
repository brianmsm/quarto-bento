/** Explicit authored Studio components, saved atomically without source execution. */
import { resolve } from "node:path";
import { componentFrame } from "./component-frames.ts";
import { withProject } from "./project.ts";
import {
  assertOutputUnchanged,
  type BentoDoc,
  type BentoElement,
  canonical,
  captureEdits,
  clone,
  type ComponentCreation,
  componentIdentities,
  componentProblems,
  type ProjectState,
  StateError,
} from "../state/mod.ts";
import { hashSource, scanSource, type SourceDocument } from "../source/mod.ts";
import {
  type ComponentInsertion,
  componentMarkdown,
} from "../source/component-insertion.ts";
import { previewStructure } from "../source/structure.ts";
import { canonicalInlineHtml, inlineHtmlToMarkdown } from "../render/inline.ts";
import { escapeHtml } from "../render/html.ts";
import { projectAst, validateProjectionOrigins } from "../render/project.ts";
import { type Ast } from "../render/types.ts";
import { type DesignDefaults } from "../render/design.ts";
import {
  assertDesignRegistryUnchanged,
  loadDesignRegistry,
} from "../render/registry.ts";
import { assertProjectDocument } from "../render/validate.ts";
export type ComponentRequest = {
  action: "create";
  kind: "card" | "kpi";
  slideId: string;
  fields: { title: string; body: string } | {
    label: string;
    value: string;
    detail?: string;
  };
  revision: number;
  expectedDocId: string;
} | {
  action: "restore" | "discard";
  id: string;
  revision: number;
  expectedDocId: string;
};
function fail(code: string, message: string): never {
  throw new StateError(code, message);
}
function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
function keys(value: object, expected: string[]) {
  return Object.keys(value).length === expected.length &&
    expected.every((key) => Object.hasOwn(value, key));
}
function validateRequest(value: unknown): asserts value is ComponentRequest {
  if (
    !object(value) ||
    !["create", "restore", "discard"].includes(value.action as string) ||
    !Number.isSafeInteger(value.revision) || (value.revision as number) < 0 ||
    typeof value.expectedDocId !== "string" || !value.expectedDocId
  ) {
    fail(
      "INVALID_COMPONENT_ACTION",
      "Use an exact component action with the saved docId and revision.",
    );
  }
  if (value.action !== "create") {
    if (
      !keys(value, ["action", "id", "revision", "expectedDocId"]) ||
      typeof value.id !== "string" || !value.id
    ) {
      fail(
        "INVALID_COMPONENT_ACTION",
        "Restore/discard needs one saved component identity.",
      );
    }
    return;
  }
  if (
    !keys(value, [
      "action",
      "kind",
      "slideId",
      "fields",
      "revision",
      "expectedDocId",
    ]) || !["card", "kpi"].includes(value.kind as string) ||
    typeof value.slideId !== "string" || !value.slideId || !object(value.fields)
  ) {
    fail(
      "INVALID_COMPONENT_ACTION",
      "Choose a card or indicator with explicit authored fields.",
    );
  }
  const roles = value.kind === "card" ? ["title", "body"] : [
    "label",
    "value",
    ...(Object.hasOwn(value.fields, "detail") ? ["detail"] : []),
  ];
  const requestedFields = value.fields as Record<string, unknown>;
  if (
    !keys(value.fields, roles) ||
    roles.some((role) =>
      typeof requestedFields[role] !== "string" ||
      !(requestedFields[role] as string).trim() ||
      (requestedFields[role] as string).length > 6000
    )
  ) {
    fail(
      "INVALID_COMPONENT_ACTION",
      "Fill every named authored field (at most 6000 characters each); omit an empty optional detail.",
    );
  }
  if (value.kind === "card" && /[\r\n]/.test(value.fields.title as string)) {
    fail("INVALID_COMPONENT_ACTION", "Use a single-line card title.");
  }
}
export function assertCurrentComponentSource(
  state: ProjectState,
  source: SourceDocument,
): void {
  const hashes = new Set(
    Object.values(state.provenance).map((proof) => proof.source?.hash).filter((
      hash,
    ) => typeof hash === "string"),
  );
  if (source.diagnostics.length) {
    fail(
      "AMBIGUOUS_IDENTITY",
      "Resolve source identity/structure diagnostics first. Pending components are retained.",
    );
  }
  if (hashes.size !== 1 || !hashes.has(source.hash)) {
    fail(
      "STALE_SOURCE",
      "QMD differs from the executed baseline. Recalculate and review before creating/syncing a component; pending content is retained.",
    );
  }
}
export function componentOperation(
  intent: ComponentCreation,
  document: BentoDoc,
): ComponentInsertion {
  const slide = document.slides.find((slide) => slide.id === intent.slideId);
  if (!slide) {
    fail(
      "COMPONENT_INCOMPLETE",
      "Restore the containing slide before reviewing this component.",
    );
  }
  return {
    type: "insert-component",
    kind: intent.kind,
    slideId: intent.slideId,
    id: intent.id,
    fields: intent.members.map((member) => {
      const element = slide.elements.find((element) =>
        element.id === member.nativeId
      );
      if (element?.type !== "text" || typeof element.html !== "string") {
        fail(
          "COMPONENT_INCOMPLETE",
          "Restore the incomplete component or discard it from Add component before synchronizing.",
        );
      }
      return {
        role: member.role,
        sourceId: member.sourceId,
        markdown: inlineHtmlToMarkdown(element.html),
      };
    }),
  };
}
/** Pandoc is a fragment reader here, not Quarto render or a computation engine. */
export async function projectAuthoredComponent(
  operation: ComponentInsertion,
  docId: string,
  defaults: DesignDefaults = {},
  frames: ReadonlyMap<string, import("../render/design.ts").Frame> = new Map(),
  appearance?: import("../render/kpi.ts").KpiAppearance,
) {
  const source = `## Component {#${operation.slideId}}\n\n${
    componentMarkdown(operation)
  }`;
  const process = new Deno.Command("quarto", {
    args: ["pandoc", "--from", "markdown", "--to", "json"],
    stdin: "piped",
    stdout: "piped",
    stderr: "piped",
  }).spawn();
  const output = process.output(), writer = process.stdin.getWriter();
  await writer.write(new TextEncoder().encode(source));
  await writer.close();
  const result = await output;
  if (!result.success) {
    fail(
      "COMPONENT_FRAGMENT_UNSUPPORTED",
      "Pandoc could not verify this authored component fragment.",
    );
  }
  const projection = validateProjectionOrigins(
    scanSource(source),
    await projectAst(
      JSON.parse(new TextDecoder().decode(result.stdout)) as Ast,
      docId,
      [],
      scanSource(source),
      new Map(),
      defaults,
      new Map(),
      frames,
      appearance ? new Map([[operation.slideId, appearance]]) : new Map(),
    ),
  );
  const ids = [
    `${operation.id}/qb-${operation.kind}-background`,
    ...operation.fields.map((field) =>
      field.role === "title" ? field.sourceId : `${field.sourceId}/paragraph:1`
    ),
  ];
  const elements = projection.document.slides.find((slide) =>
    slide.id === operation.slideId
  )?.elements.filter((element) => ids.includes(element.id));
  if (!elements || elements.length !== ids.length) {
    fail(
      "COMPONENT_FRAGMENT_UNSUPPORTED",
      "The component did not project exactly its declared native member IDs.",
    );
  }
  return elements as BentoElement[];
}
function freshId(
  state: ProjectState,
  source: SourceDocument,
  kind: string,
): string {
  const used = new Set([
    ...source.blocks.map((block) => block.id),
    ...[state.generatedBaseline, state.emitted].flatMap((doc) =>
      doc.slides.flatMap((
        slide,
      ) => [slide.id, ...slide.elements.map((element) => element.id)])
    ),
    ...state.componentCreations?.flatMap((
      intent,
    ) => [
      intent.id,
      intent.backgroundId,
      ...intent.members.flatMap((member) => [member.sourceId, member.nativeId]),
    ]) ?? [],
    ...state.bentoOnly.map((item) => item.element.id),
    ...state.componentProjections?.flatMap((record) =>
      componentIdentities(record.id, record.kind)
    ) ?? [],
    ...[...state.pending, ...state.overrides].flatMap((item) => [
      item.target.slideId ?? "",
      item.target.elementId ?? "",
    ]),
    ...state.elementOrders.flatMap((order) => [order.slideId, ...order.ids]),
  ]);
  for (let attempt = 0; attempt < 10; attempt++) {
    const id = `qb-${kind}-${
      crypto.randomUUID().replaceAll("-", "").slice(0, 20)
    }`;
    const prospective = [
      id,
      `${id}/qb-${kind}-background`,
      ...["title", "body", "label", "value", "detail"].flatMap((
        role,
      ) => [`${id}-${role}`, `${id}-${role}/paragraph:1`]),
    ];
    if (prospective.every((id) => !used.has(id))) return id;
  }
  return fail(
    "COMPONENT_ID_COLLISION",
    "Could not reserve globally fresh source/member identities.",
  );
}
export async function applyComponentAction(
  source: string,
  request: ComponentRequest,
): Promise<ProjectState> {
  validateRequest(request);
  return await withProject(source, async (paths, store) => {
    const state = await store.load();
    if (!state) fail("NO_BASELINE", "Render the project first.");
    if (state.docId !== request.expectedDocId) {
      fail("UNRELATED_DOCUMENT", "Reload this project's saved document.");
    }
    if (state.revision !== request.revision) {
      fail("STALE_REVISION", "Reload before changing components.");
    }
    try {
      await Deno.lstat(resolve(paths.stateDir, "sync-approved.json"));
      fail(
        "APPROVAL_PENDING",
        "Render or recover the approved source synchronization before changing components.",
      );
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) throw error;
    }
    await assertOutputUnchanged(state, paths.output);
    const text = await Deno.readTextFile(paths.source),
      mapping = scanSource(text),
      doc = clone(state.emitted);
    let next: ProjectState;
    if (request.action === "create") {
      assertCurrentComponentSource(state, mapping);
      if (
        (state.componentCreations?.length ?? 0) >= 128 ||
        (state.componentCreations?.length ?? 0) +
              (state.componentProjections?.length ?? 0) >= 5000
      ) {
        fail(
          "COMPONENT_LIMIT",
          "Review pending components before adding more; the saved component collection has reached its supported bound.",
        );
      }
      const slide = doc.slides.find((slide) => slide.id === request.slideId);
      if (
        !slide || !state.generatedBaseline.slides.some((slide) =>
          slide.id === request.slideId
        ) || !mapping.slides.some((sourceSlide) =>
          sourceSlide.id === request.slideId ||
          Object.entries(state.provenance).some(([key, proof]) =>
            JSON.parse(key)[0] === request.slideId &&
            proof.origin === "authored" &&
            proof.source?.blockId === sourceSlide.headingId &&
            proof.source?.kind === "heading" &&
            proof.source?.hash === mapping.hash
          )
        )
      ) {
        fail(
          "COMPONENT_SOURCE_SLIDE_REQUIRED",
          "Choose an existing QMD slide; restore pending slide deletions first.",
        );
      }
      const id = freshId(state, mapping, request.kind);
      const requestedFields = request.fields as Record<string, string>;
      const roleOrder = request.kind === "card" ? ["title", "body"] : [
        "label",
        "value",
        ...(Object.hasOwn(requestedFields, "detail") ? ["detail"] : []),
      ];
      const fields = roleOrder.map((role) => ({
        role: role as ComponentInsertion["fields"][number]["role"],
        sourceId: `${id}-${role}`,
        markdown: inlineHtmlToMarkdown(
          escapeHtml(requestedFields[role]).replace(/\r\n|\r|\n/g, "<br>"),
        ),
      }));
      const operation: ComponentInsertion = {
        type: "insert-component",
        kind: request.kind,
        id,
        slideId: slide.id,
        fields,
      };
      if (
        mapping.slides.some((slide) =>
          slide.id === request.slideId && slide.stable
        )
      ) {
        previewStructure(mapping, [operation]);
      }
      const registry = await loadDesignRegistry(paths.directory);
      const elements = await projectAuthoredComponent(
        operation,
        state.docId,
        registry.defaults,
      );
      for (const field of fields) {
        const current = elements.find((element) =>
          element.id ===
            (field.role === "title"
              ? field.sourceId
              : `${field.sourceId}/paragraph:1`)
        );
        const requestedHtml = canonicalInlineHtml(
          escapeHtml(requestedFields[field.role]).replace(
            /\r\n|\r|\n/g,
            "<br>",
          ),
        );
        if (current?.html !== requestedHtml) {
          fail(
            "COMPONENT_FRAGMENT_UNSUPPORTED",
            "The authored text changes when parsed; edit unsupported text explicitly in QMD.",
          );
        }
      }
      await assertDesignRegistryUnchanged(paths.directory, registry.hash);
      slide.elements.push(...elements);
      assertProjectDocument(doc);
      next = captureEdits(state, doc);
      const backgroundId = `${id}/qb-${request.kind}-background`;
      (next.componentCreations ??= []).push({
        version: 1,
        id,
        kind: request.kind,
        slideId: slide.id,
        backgroundId,
        projectionFrame: componentFrame(
          elements.find((element) =>
            element.id === backgroundId
          )!,
        ),
        restoreOrder: slide.elements.map((element) => element.id),
        backgroundSnapshot: clone(
          elements.find((element) => element.id === backgroundId)!,
        ),
        members: fields.map((field) => {
          const nativeId = field.role === "title"
            ? field.sourceId
            : `${field.sourceId}/paragraph:1`;
          return {
            role: field.role,
            sourceId: field.sourceId,
            nativeId,
            snapshot: clone(
              elements.find((element) => element.id === nativeId)!,
            ),
          };
        }),
      });
    } else {
      const intent = state.componentCreations?.find((intent) =>
        intent.id === request.id
      );
      if (!intent) {
        fail(
          "COMPONENT_NOT_FOUND",
          "The pending component is unavailable; reload the project.",
        );
      }
      const slide = doc.slides.find((slide) => slide.id === intent.slideId);
      const ids = [
        intent.backgroundId,
        ...intent.members.map((member) => member.nativeId),
      ];
      if (request.action === "restore") {
        if (!slide) {
          fail(
            "COMPONENT_PARENT_MISSING",
            "Restore the containing slide from Slides before restoring its component.",
          );
        }
        const missing = [
          intent.backgroundSnapshot,
          ...intent.members.map((member) => member.snapshot),
        ].filter((snapshot) =>
          !slide.elements.some((element) => element.id === snapshot.id)
        );
        if (!missing.length) {
          fail(
            "COMPONENT_NOT_INCOMPLETE",
            "No original member is missing. Resolve changed member types/extra group objects natively or discard the pending component.",
          );
        }
        missing.sort((a, b) =>
          intent.restoreOrder.indexOf(a.id) - intent.restoreOrder.indexOf(b.id)
        );
        for (const snapshot of missing) {
          const position = intent.restoreOrder.indexOf(snapshot.id);
          const successors = intent.restoreOrder.slice(position + 1);
          const predecessors = intent.restoreOrder.slice(0, position);
          const following = slide.elements.findIndex((element) =>
            successors.includes(element.id)
          );
          const preceding = slide.elements.findLastIndex((element) =>
            predecessors.includes(element.id)
          );
          const index = following >= 0
            ? following
            : preceding >= 0
            ? preceding + 1
            : slide.elements.length;
          slide.elements.splice(index, 0, clone(snapshot));
        }
        assertProjectDocument(doc);
        next = captureEdits(state, doc);
      } else {
        // Explicit discard releases only this intent's identities, preserving unrelated objects.
        const discarded = clone(state);
        discarded.componentCreations = discarded.componentCreations!.filter((
          item,
        ) => item.id !== intent.id);
        if (!discarded.componentCreations.length) {
          delete discarded.componentCreations;
        }
        if (slide) {
          slide.elements = slide.elements.filter((element) =>
            !ids.includes(element.id)
          );
        }
        next = captureEdits(discarded, doc);
        next.pending = next.pending.filter((change) =>
          !(change.target.slideId === intent.slideId &&
            ids.includes(change.target.elementId!))
        );
        next.bentoOnly = next.bentoOnly.filter((item) =>
          !(item.slideId === intent.slideId && ids.includes(item.element.id))
        );
        next.overrides = next.overrides.filter((item) =>
          !(item.target.slideId === intent.slideId &&
            ids.includes(item.target.elementId!))
        );
        for (
          const order of next.elementOrders.filter((order) =>
            order.slideId === intent.slideId
          )
        ) order.ids = order.ids.filter((id) => !ids.includes(id));
      }
    }
    if (hashSource(await Deno.readTextFile(paths.source)) !== mapping.hash) {
      fail(
        "STALE_SOURCE",
        "QMD changed during this component action; retry from the current source.",
      );
    }
    if (canonical(await store.load()) !== canonical(state)) {
      fail(
        "STALE_REVISION",
        "Saved state changed during this component action; reload.",
      );
    }
    return await store.save(next, request.revision);
  });
}
export function pendingComponentDiagnostics(state: ProjectState) {
  return (state.componentCreations ?? []).flatMap((intent) => {
    const problems = componentProblems(state, intent);
    return problems.length
      ? [{
        code: "COMPONENT_INCOMPLETE",
        slideId: intent.slideId,
        elementId: intent.id,
        message: problems.join(" ") +
          " Abre Añadir componente para restaurar miembros ausentes o descartar esta creación pendiente.",
      }]
      : [];
  });
}
