/** Bounded pure-data agent operations over the same saved project as Studio. */
import { normalizeNotesText, notesIdentity } from "../source/notes.ts";
import { projectPaths, readProject, saveProject } from "./project.ts";
import { applySlideAction } from "./slide-actions.ts";
import { assertJson } from "../state/json.ts";
import {
  type BentoDoc,
  type BentoSlide,
  clone,
  type JsonObject,
  type ProjectState,
  StateError,
} from "../state/mod.ts";
import {
  assertProjectDocument,
  BENTO_CONTRACT_REVISION,
} from "../render/validate.ts";
import { authoredText } from "../render/lists.ts";
import { inlineHtmlToMarkdown } from "../render/inline.ts";
import { hashSource, scanSource, type SourceDocument } from "../source/mod.ts";
import {
  previewStructure,
  type StructureOperation,
} from "../source/structure.ts";

export const MAX_AGENT_PATCH_BYTES = 1024 * 1024;
export const MAX_AGENT_CREATE_ELEMENTS = 50;
export const AGENT_ELEMENT_FIELDS = [
  "x",
  "y",
  "w",
  "h",
  "rotation",
  "opacity",
  "fontSize",
  "fontFamily",
  "fontWeight",
  "color",
  "align",
  "valign",
  "lineHeight",
  "letterSpacing",
  "fill",
  "stroke",
  "strokeWidth",
  "strokeStyle",
  "strokeDash",
  "radius",
  "html",
  "content",
  "src",
  "markup",
  "rows",
  "columns",
  "header",
  "option",
] as const;
export const AGENT_SLIDE_FIELDS = [
  "background",
  "name",
  "notes",
  "transition",
  "unnumbered",
] as const;

export type AgentOperation =
  | {
    op: "element.patch";
    slideId: string;
    elementId: string;
    fields: JsonObject;
  }
  | { op: "slide.patch"; slideId: string; fields: JsonObject }
  | { op: "slide.move"; slideId: string; afterId: string | null }
  | {
    op: "slide.create";
    slideId: string;
    afterId: string | null;
    slide: BentoSlide;
  }
  | { op: "slide.hide" | "slide.show"; slideId: string };
export interface AgentPatch {
  version: 1;
  docId: string;
  expectedRevision: number;
  operations: AgentOperation[];
}
function fail(code: string, message: string): never {
  throw new StateError(code, message);
}
function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
function keys(value: Record<string, unknown>, expected: string[]) {
  if (
    Object.keys(value).length !== expected.length ||
    expected.some((key) => !Object.hasOwn(value, key))
  ) fail("AGENT_INVALID_REQUEST", "Missing or unknown request properties.");
}
function identity(value: unknown): asserts value is string {
  if (typeof value !== "string" || !value || value.length > 200) {
    fail(
      "AGENT_INVALID_TARGET",
      "Use an exact nonempty stable ID, at most 200 characters.",
    );
  }
}
function validatePatch(value: unknown): asserts value is AgentPatch {
  assertJson(value);
  if (!object(value)) fail("AGENT_INVALID_REQUEST", "Expected a patch object.");
  keys(value, ["version", "docId", "expectedRevision", "operations"]);
  if (
    value.version !== 1 || typeof value.docId !== "string" || !value.docId ||
    !Number.isSafeInteger(value.expectedRevision) ||
    (value.expectedRevision as number) < 0 ||
    !Array.isArray(value.operations) || !value.operations.length ||
    value.operations.length > 100
  ) {
    fail(
      "AGENT_INVALID_REQUEST",
      "Expected version 1, docId, a nonnegative revision and 1..100 operations.",
    );
  }
  if (
    new TextEncoder().encode(JSON.stringify(value)).length >
      MAX_AGENT_PATCH_BYTES
  ) fail("AGENT_INPUT_TOO_LARGE", "Patch exceeds the 1 MiB limit.");
  for (const operation of value.operations) {
    if (!object(operation)) {
      fail("AGENT_INVALID_REQUEST", "Expected operation objects.");
    }
    identity(operation.slideId);
    switch (operation.op) {
      case "element.patch":
      case "slide.patch": {
        keys(
          operation,
          operation.op === "element.patch"
            ? ["op", "slideId", "elementId", "fields"]
            : ["op", "slideId", "fields"],
        );
        if (operation.op === "element.patch") identity(operation.elementId);
        const allowed: readonly string[] = operation.op === "element.patch"
          ? AGENT_ELEMENT_FIELDS
          : AGENT_SLIDE_FIELDS;
        if (
          !object(operation.fields) || !Object.keys(operation.fields).length
        ) {
          fail(
            "AGENT_INVALID_REQUEST",
            "Patch fields must be a nonempty object.",
          );
        }
        for (const field of Object.keys(operation.fields)) {
          if (!allowed.includes(field)) {
            fail(
              "AGENT_UNKNOWN_FIELD",
              `Unsupported ${operation.op} field: ${field}.`,
            );
          }
        }
        break;
      }
      case "slide.move":
        keys(operation, ["op", "slideId", "afterId"]);
        if (operation.afterId !== null) identity(operation.afterId);
        if (operation.afterId === operation.slideId) {
          fail("AGENT_INVALID_TARGET", "A slide cannot move after itself.");
        }
        break;
      case "slide.create": {
        keys(operation, ["op", "slideId", "afterId", "slide"]);
        if (operation.afterId !== null) identity(operation.afterId);
        if (
          !object(operation.slide) || operation.slide.id !== operation.slideId
        ) {
          fail(
            "AGENT_INVALID_TARGET",
            "Created slide.id must match slideId exactly.",
          );
        }
        const slide = operation.slide;
        if (
          !Array.isArray(slide.elements) || !slide.elements.length ||
          slide.elements.length > MAX_AGENT_CREATE_ELEMENTS
        ) {
          fail(
            "AGENT_INVALID_REQUEST",
            "Create requires 1..50 native elements.",
          );
        }
        if (slide.title !== undefined && slide.title !== "") {
          fail(
            "AGENT_UNSUPPORTED_CREATION",
            "Separate title metadata requires explicit QMD authoring.",
          );
        }
        for (const entity of [slide, ...slide.elements]) {
          if (!object(entity)) {
            fail("AGENT_INVALID_REQUEST", "Expected native element objects.");
          }
          identity(entity.id);
          if (!/^[A-Za-z][\w:.-]*$/.test(entity.id)) {
            fail(
              "AGENT_INVALID_TARGET",
              "Created identities must be source-safe: a letter followed by letters, digits, _, :, . or -.",
            );
          }
          if (
            ["origin", "producer", "provenance", "source"].some((key) =>
              Object.hasOwn(entity, key)
            )
          ) {
            fail(
              "AGENT_UNSUPPORTED_CREATION",
              "Creation cannot declare computation provenance.",
            );
          }
        }
        if (
          slide.elements.some((e) =>
            !object(e) || typeof e.type !== "string" ||
            !["text", "shape"].includes(e.type)
          )
        ) {
          fail(
            "AGENT_UNSUPPORTED_CREATION",
            "Create supports authored text and pure visual decorations only.",
          );
        }
        if (!slide.elements.some((e) => object(e) && e.type === "text")) {
          fail("AGENT_UNSUPPORTED_CREATION", "Create requires a text title.");
        }
        break;
      }
      case "slide.hide":
      case "slide.show":
        keys(operation, ["op", "slideId"]);
        if (value.operations.length !== 1) {
          fail(
            "AGENT_INVALID_REQUEST",
            "Visibility operations must be submitted alone.",
          );
        }
        break;
      default:
        fail(
          "AGENT_UNKNOWN_OPERATION",
          `Unsupported agent operation: ${operation.op}.`,
        );
    }
  }
}

/** Validate agent data after the shared read-only source binding check. */
async function readBoundProject(source: string) {
  const state = await readProject(source);
  assertProjectDocument(state.emitted);
  return state;
}
function snapshot(state: ProjectState) {
  return {
    version: 1,
    contractRevision: BENTO_CONTRACT_REVISION,
    docId: state.docId,
    revision: state.revision,
    deck: state.emitted,
    provenance: state.provenance,
    ownership: state.ownership,
    pending: state.pending,
  };
}
/** Does not execute Quarto or capture uncommitted native HTML changes. */
export async function getAgentDeck(source: string) {
  return snapshot(await readBoundProject(source));
}

function slide(doc: BentoDoc, id: string) {
  const target = doc.slides.find((item) => item.id === id);
  if (!target) {
    fail(
      "AGENT_TARGET_NOT_FOUND",
      `Slide ${id} is absent from the saved deck.`,
    );
  }
  return target;
}
/** Creation needs a source-backed baseline matching the entire live QMD. */
function assertCurrentCreationSource(
  state: ProjectState,
  source: SourceDocument,
) {
  const hashes = new Set(
    Object.values(state.provenance).map((proof) => proof.source?.hash).filter(
      (hash): hash is string => typeof hash === "string",
    ),
  );
  if (!hashes.size) {
    fail(
      "AGENT_UNSUPPORTED_CREATION",
      "Creation needs a source-backed baseline; author an identified slide in QMD and render first.",
    );
  }
  if (hashes.size !== 1 || !hashes.has(source.hash)) {
    fail(
      "STALE_SOURCE",
      "QMD differs from the executed baseline; recalculate before creating slides. Existing pending edits are preserved.",
    );
  }
}
/** Reserve live source IDs, retained baseline IDs and pending creation identities. */
function assertFreshCreation(
  state: ProjectState,
  doc: BentoDoc,
  source: SourceDocument,
  created: BentoSlide,
) {
  const reserved = new Set(source.blocks.map((block) => block.id));
  function retain(item: BentoSlide) {
    reserved.add(item.id);
    item.elements.forEach((element) => reserved.add(element.id));
  }
  state.generatedBaseline.slides.forEach(retain);
  doc.slides.forEach(retain);
  for (const proof of Object.values(state.provenance)) {
    if (typeof proof.source?.blockId === "string") {
      reserved.add(proof.source.blockId);
    }
  }
  for (const pending of state.pending) {
    if (pending.kind === "create-slide" && pending.after.present) {
      const item = pending.after.value as BentoSlide;
      retain(item);
      item.elements.filter((e) => e.type === "text").slice(1).forEach(
        (_element, i) => {
          reserved.add(`${item.id}-text-${i + 1}`);
          reserved.add(`${item.id}-text-${i + 1}/paragraph:1`);
          reserved.add(`${item.id}-text-${i + 1}/list:1`);
        },
      );
    }
  }
  const sourceIds = created.elements.filter((e) => e.type === "text").slice(1)
    .flatMap((
      _element,
      i,
    ) => [
      `${created.id}-text-${i + 1}`,
      `${created.id}-text-${i + 1}/paragraph:1`,
      `${created.id}-text-${i + 1}/list:1`,
    ]);
  for (
    const id of [
      created.id,
      ...created.elements.map((e) => e.id),
      ...sourceIds,
    ]
  ) {
    if (reserved.has(id)) {
      fail(
        "AGENT_ID_COLLISION",
        `Created identity ${id} is already retained by source or native state.`,
      );
    }
  }
}
/** Use the same inline codec and structural authoring grammar as reviewed sync. */
function previewCreationSource(source: SourceDocument, created: BentoSlide) {
  if (created.title !== undefined && created.title !== "") {
    fail(
      "AGENT_UNSUPPORTED_CREATION",
      "Separate title metadata requires explicit QMD authoring.",
    );
  }
  const texts = created.elements.filter((e) => e.type === "text");
  for (const element of texts) {
    if (/\$\$|\\\[/.test(String(element.html))) {
      fail(
        "AGENT_UNSUPPORTED_CREATION",
        "Create display equations explicitly in QMD, not as new native text.",
      );
    }
  }
  const title = inlineHtmlToMarkdown(texts[0].html as string);
  const body = texts.slice(1).map((e) =>
    authoredText(e.html as string).markdown
  );
  const operations: StructureOperation[] = [{
    type: "insert-slide",
    id: created.id,
    title,
    body: body.join("\n\n"),
    bodyFragments: body,
    titleElementId: texts[0].id,
    bodyElementIds: texts.slice(1).map((e) => e.id),
  }];
  if (created.notes) {
    operations.push({
      type: "insert-notes",
      slideId: created.id,
      id: notesIdentity(created.id),
      text: normalizeNotesText(created.notes as string),
    });
  }
  return scanSource(previewStructure(source, operations).result);
}
/** Validate the whole batch, then one existing CAS save; never writes QMD. */
export async function patchAgentDeck(source: string, input: unknown) {
  validatePatch(input);
  const request = clone(input);
  const state = await readBoundProject(source);
  if (state.docId !== request.docId) {
    fail("UNRELATED_DOCUMENT", "Patch docId differs from the saved project.");
  }
  if (state.revision !== request.expectedRevision) {
    fail("STALE_REVISION", "Get the current deck before patching.");
  }
  let saved: ProjectState;
  const first = request.operations[0];
  if (first.op === "slide.hide" || first.op === "slide.show") {
    saved = await applySlideAction(source, {
      action: first.op === "slide.hide" ? "hide" : "show",
      slideId: first.slideId,
      revision: request.expectedRevision,
      expectedDocId: request.docId,
    });
  } else {
    const doc = clone(state.emitted);
    const sourceText = request.operations.some((op) => op.op === "slide.create")
      ? await Deno.readTextFile(projectPaths(source).source)
      : undefined;
    let creationSource = sourceText === undefined
      ? undefined
      : scanSource(sourceText);
    if (creationSource) assertCurrentCreationSource(state, creationSource);
    for (const operation of request.operations) {
      if (operation.op === "slide.create") {
        if (operation.afterId !== null) slide(doc, operation.afterId);
        assertFreshCreation(state, doc, creationSource!, operation.slide);
        const after = operation.afterId === null
          ? -1
          : doc.slides.findIndex((item) => item.id === operation.afterId);
        doc.slides.splice(after + 1, 0, clone(operation.slide));
      } else if (operation.op === "slide.move") {
        const target = slide(doc, operation.slideId);
        if (operation.afterId !== null) slide(doc, operation.afterId);
        doc.slides = doc.slides.filter((item) => item.id !== target.id);
        const after = operation.afterId === null
          ? -1
          : doc.slides.findIndex((item) => item.id === operation.afterId);
        doc.slides.splice(after + 1, 0, target);
      } else if (
        operation.op === "element.patch" || operation.op === "slide.patch"
      ) {
        const target = slide(doc, operation.slideId);
        const entity = operation.op === "slide.patch"
          ? target
          : target.elements.find((item) => item.id === operation.elementId);
        if (!entity) {
          fail(
            "AGENT_TARGET_NOT_FOUND",
            `Requested element is absent from ${target.id}.`,
          );
        }
        for (const [field, value] of Object.entries(operation.fields)) {
          entity[field] = clone(value);
        }
      }
      assertProjectDocument(doc);
      if (operation.op === "slide.create") {
        creationSource = previewCreationSource(
          creationSource!,
          operation.slide,
        );
      }
    }
    // A later field patch can change a new slide's authored text or notes.
    // Check the final creations as well before the single save is allowed.
    if (sourceText !== undefined) {
      let finalSource = scanSource(sourceText);
      for (const operation of request.operations) {
        if (operation.op === "slide.create") {
          finalSource = previewCreationSource(
            finalSource,
            slide(doc, operation.slideId),
          );
        }
      }
    }
    saved = await saveProject(
      source,
      doc,
      request.expectedRevision,
      sourceText === undefined ? undefined : hashSource(sourceText),
    );
  }
  return { ...snapshot(saved), sourceUnchanged: true, renderNeeded: true };
}

/** Incremental file input refuses oversized/growing files before unbounded allocation. */
export async function readAgentPatchFile(path: string): Promise<unknown> {
  const info = await Deno.lstat(path);
  if (!info.isFile || info.isSymlink) {
    fail(
      "AGENT_INPUT_FILE",
      "Patch input must be a regular JSON file, not a symlink.",
    );
  }
  const file = await Deno.open(path, { read: true });
  try {
    const opened = await file.stat();
    if (!opened.isFile) {
      fail("AGENT_INPUT_FILE", "Patch input must be a regular JSON file.");
    }
    if (opened.size > MAX_AGENT_PATCH_BYTES) {
      fail("AGENT_INPUT_TOO_LARGE", "Patch exceeds the 1 MiB limit.");
    }
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const chunk = new Uint8Array(16 * 1024);
      const read = await file.read(chunk);
      if (read === null) break;
      size += read;
      if (size > MAX_AGENT_PATCH_BYTES) {
        fail("AGENT_INPUT_TOO_LARGE", "Patch exceeds the 1 MiB limit.");
      }
      chunks.push(chunk.subarray(0, read));
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    try {
      return JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(bytes),
      );
    } catch {
      fail("AGENT_INVALID_JSON", "Patch input must contain valid UTF-8 JSON.");
    }
  } finally {
    file.close();
  }
}
