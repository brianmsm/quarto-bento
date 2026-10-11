/** Bounded pure-data agent operations over the same saved project as Studio. */
import { basename, join } from "node:path";
import { projectPaths, readProject, saveProject } from "./project.ts";
import { applySlideAction } from "./slide-actions.ts";
import { assertJson } from "../state/json.ts";
import {
  type BentoDoc,
  clone,
  type JsonObject,
  type ProjectState,
  StateError,
} from "../state/mod.ts";
import {
  assertProjectDocument,
  BENTO_CONTRACT_REVISION,
} from "../render/validate.ts";

export const MAX_AGENT_PATCH_BYTES = 1024 * 1024;
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

/** Refuse reading another QMD's deck from a shared directory. */
async function readBoundProject(source: string) {
  const paths = projectPaths(source);
  let binding;
  try {
    binding = JSON.parse(
      await Deno.readTextFile(join(paths.stateDir, "project.json")),
    );
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      fail("NO_BASELINE", "Render this QMD before using the agent API.");
    }
    throw error;
  }
  if (binding?.version !== 1 || binding.source !== basename(paths.source)) {
    fail(
      "PROJECT_SOURCE_MISMATCH",
      ".qbento belongs to a different QMD source.",
    );
  }
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
/** Validate the whole batch, then one existing CAS save; never writes QMD. */
export async function patchAgentDeck(source: string, input: unknown) {
  validatePatch(input);
  const state = await readBoundProject(source);
  if (state.docId !== input.docId) {
    fail("UNRELATED_DOCUMENT", "Patch docId differs from the saved project.");
  }
  if (state.revision !== input.expectedRevision) {
    fail("STALE_REVISION", "Get the current deck before patching.");
  }
  let saved: ProjectState;
  const first = input.operations[0];
  if (first.op === "slide.hide" || first.op === "slide.show") {
    saved = await applySlideAction(source, {
      action: first.op === "slide.hide" ? "hide" : "show",
      slideId: first.slideId,
      revision: input.expectedRevision,
      expectedDocId: input.docId,
    });
  } else {
    const doc = clone(state.emitted);
    for (const operation of input.operations) {
      const target = slide(doc, operation.slideId);
      if (operation.op === "slide.move") {
        if (operation.afterId !== null) slide(doc, operation.afterId);
        doc.slides = doc.slides.filter((item) => item.id !== target.id);
        const after = operation.afterId === null
          ? -1
          : doc.slides.findIndex((item) => item.id === operation.afterId);
        doc.slides.splice(after + 1, 0, target);
      } else if (
        operation.op === "element.patch" || operation.op === "slide.patch"
      ) {
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
    }
    saved = await saveProject(source, doc, input.expectedRevision);
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
