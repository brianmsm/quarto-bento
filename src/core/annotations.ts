/** Original-YAML configuration and bounded external-design signals for sync only. */
import { resolve } from "node:path";
import { validateDesignRegistry } from "../render/registry.ts";
import type { ProjectState } from "../state/mod.ts";
import { canonical, sha256, StateError } from "../state/mod.ts";
import { type SourceDocument, SourceError } from "../source/mod.ts";
import type {
  AnnotationDiagnostic,
  AnnotationFeature,
  AnnotationLevel,
  AnnotationRequest,
} from "../source/annotations.ts";
import {
  originalAttributeTokens,
  originalPandocAttributes,
} from "../source/attributes.ts";
const key = "qbento-annotations";
function invalid(message: string): never {
  throw new StateError(
    "INVALID_ANNOTATION_CONFIG",
    `${message} Use one top-level qbento-annotations: none, minimal, or detailed in the original QMD frontmatter.`,
  );
}
/** Pandoc parses metadata only: no source body, execution, filters, or project hooks. */
async function metadataOnly(
  frontmatter: string,
): Promise<Record<string, unknown>> {
  const process = new Deno.Command("quarto", {
    args: ["pandoc", "--from", "markdown", "--to", "json"],
    stdin: "piped",
    stdout: "piped",
    stderr: "piped",
  }).spawn();
  const output = process.output();
  const writer = process.stdin.getWriter();
  await writer.write(new TextEncoder().encode(frontmatter));
  await writer.close();
  const result = await output;
  if (!result.success) {
    invalid("Quarto/Pandoc could not parse the original YAML configuration.");
  }
  try {
    const parsed = JSON.parse(new TextDecoder().decode(result.stdout));
    if (!parsed.meta || typeof parsed.meta !== "object") {
      invalid("Original metadata is malformed.");
    }
    return parsed.meta;
  } catch {
    invalid("Quarto/Pandoc did not return valid original metadata.");
  }
}
/** No execution metadata or caller-provided AST can supply this setting. */
export async function originalAnnotationLevel(
  text: string,
  parse: (frontmatter: string) => Promise<Record<string, unknown>> =
    metadataOnly,
): Promise<AnnotationLevel> {
  if (!/^(?:\uFEFF)?---[ \t]*\r?\n/.test(text)) return "minimal";
  const match =
    /^(?:\uFEFF)?---[ \t]*\r?\n([\s\S]*?)^(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/m
      .exec(text);
  if (!match) {
    if (/^(?:\uFEFF)?---[ \t]*\r?\n/.test(text)) {
      invalid("The YAML frontmatter has no closing delimiter.");
    }
    return "minimal";
  }
  if (new TextEncoder().encode(match[0]).length > 1024 * 1024) {
    invalid("Original frontmatter exceeds the bounded metadata limit.");
  }
  const meta = await parse(match[0] + "\n");
  const declarations: { indent: string; raw: string }[] = [];
  let literalIndent: number | undefined;
  for (const line of match[1].split(/\r?\n/)) {
    const indentation = /^[ \t]*/.exec(line)![0].length;
    if (literalIndent !== undefined) {
      if (!line.trim() || indentation > literalIndent) continue;
      literalIndent = undefined;
    }
    if (/:[ \t]*[|>](?:[+-]?[1-9]?|[1-9][+-]?)[ \t]*(?:#.*)?$/.test(line)) {
      literalIndent = indentation;
    }
    const declaration =
      /^(\s*)("(?:[^"\\]|\\.)*"|'(?:[^']|'')*'|[A-Za-z0-9_.-]+)[ \t]*:[ \t]*(.*)$/
        .exec(line);
    if (!declaration) continue;
    let name = declaration[2];
    if (name.startsWith('"')) {
      try {
        name = JSON.parse(name);
      } catch {
        invalid("A quoted configuration key is malformed.");
      }
    } else if (name.startsWith("'")) {
      name = name.slice(1, -1).replace(/''/g, "'");
    }
    if (name === key) {
      declarations.push({ indent: declaration[1], raw: declaration[3] });
    }
  }
  if (!Object.hasOwn(meta, key)) {
    const nestedSetting = (value: unknown): boolean => {
      if (!value || typeof value !== "object") return false;
      const node = value as { t?: unknown; c?: unknown };
      if (node.t === "MetaMap" && node.c && typeof node.c === "object") {
        return Object.hasOwn(node.c, key) ||
          Object.values(node.c).some(nestedSetting);
      }
      return node.t === "MetaList" && Array.isArray(node.c) &&
        node.c.some(nestedSetting);
    };
    if (Object.values(meta).some(nestedSetting)) {
      invalid(
        "The namespaced setting is nested or does not parse as a top-level scalar.",
      );
    }
    return "minimal";
  }
  if (declarations.length !== 1 || declarations[0].indent !== "") {
    invalid(
      "The setting is duplicated, nested, or expressed through unsupported YAML indirection.",
    );
  }
  const raw = declarations[0].raw;
  let scalar: string;
  if (raw.startsWith('"')) {
    const quoted = /^("(?:[^"\\]|\\.)*")[ \t]*(?:#.*)?$/.exec(raw);
    if (!quoted) {
      invalid("The setting must be one scalar on its declaration line.");
    }
    try {
      scalar = JSON.parse(quoted[1]);
    } catch {
      invalid("The quoted setting is malformed.");
    }
  } else if (raw.startsWith("'")) {
    const quoted = /^'((?:[^']|'')*)'[ \t]*(?:#.*)?$/.exec(raw);
    if (!quoted) {
      invalid("The setting must be one scalar on its declaration line.");
    }
    scalar = quoted[1].replace(/''/g, "'");
  } else scalar = raw.replace(/[ \t]+#.*$/, "").trim();
  if (!["none", "minimal", "detailed"].includes(scalar)) {
    invalid("The annotation level is unsupported or is not a literal scalar.");
  }
  const value = meta[key] as { t?: unknown; c?: unknown };
  const parsed = value?.t === "MetaString"
    ? value.c
    : value?.t === "MetaInlines" && Array.isArray(value.c) &&
        value.c.length === 1 && value.c[0]?.t === "Str"
    ? value.c[0].c
    : undefined;
  if (parsed !== scalar) {
    invalid(
      "The literal declaration differs from Quarto/Pandoc's original metadata.",
    );
  }
  return scalar as AnnotationLevel;
}
export interface AnnotationRegistry {
  hash: string | null;
  activeTheme?: string;
  layouts: string[];
}
/** Registry contents are never emitted into QMD; the exact bytes protect preview/apply. */
export async function annotationRegistry(
  directory: string,
): Promise<AnnotationRegistry> {
  const path = resolve(directory, ".qbento/design.json");
  let text: string;
  let bytes: Uint8Array;
  try {
    const stat = await Deno.lstat(path);
    if (!stat.isFile || stat.isSymlink) {
      throw new StateError(
        "UNSAFE_DESIGN_REGISTRY",
        "Design registry must be a regular local file.",
      );
    }
    if (stat.size > 256 * 1024) {
      throw new StateError(
        "INVALID_DESIGN_REGISTRY",
        "Design registry exceeds 256 KiB.",
      );
    }
    try {
      bytes = await Deno.readFile(path);
      if (bytes.length > 256 * 1024) {
        throw new StateError(
          "INVALID_DESIGN_REGISTRY",
          "Design registry exceeds 256 KiB.",
        );
      }
      text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      throw new StateError(
        "INVALID_DESIGN_REGISTRY",
        "Design registry must contain valid original UTF-8 bytes; repair the file before syncing.",
      );
    }
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      return { hash: null, layouts: [] };
    }
    throw error;
  }
  let data;
  try {
    data = validateDesignRegistry(JSON.parse(text));
  } catch (error) {
    throw new StateError(
      "INVALID_DESIGN_REGISTRY",
      `Repair the original design registry before annotation sync: ${
        String(error)
      }`,
    );
  }
  return {
    hash: await sha256(bytes),
    ...(typeof data.activeTheme === "string"
      ? { activeTheme: data.activeTheme }
      : {}),
    layouts: Object.keys(data.layouts ?? {}).sort(),
  };
}
export function annotationRequests(
  doc: SourceDocument,
  state: ProjectState,
  selected: string[],
  registry: AnnotationRegistry,
  diagnostics: AnnotationDiagnostic[] = [],
): AnnotationRequest[] {
  const requests = new Map<string, AnnotationRequest>();
  function add(
    slideId: string | undefined,
    feature: AnnotationFeature,
    registryRef = false,
  ) {
    const ids = slideId ? [slideId] : doc.slides.map((s) => s.id);
    for (const id of ids) {
      let request = requests.get(id);
      if (!request) {
        requests.set(
          id,
          request = { slideId: id, features: [], references: [] },
        );
      }
      const reference = registryRef
        ? ".qbento/design.json"
        : ".qbento/state.json";
      if (!request.features.includes(feature)) request.features.push(feature);
      if (!request.references.includes(reference)) {
        request.references.push(reference);
      }
    }
  }
  for (const override of state.overrides) {
    if (override.fields.length) add(override.target.slideId, "overrides");
  }
  for (const decoration of state.bentoOnly) {
    add(decoration.slideId, "decorations");
  }
  for (const order of state.elementOrders) add(order.slideId, "stacking");
  for (const change of state.pending) {
    if (
      selected.includes(change.id) &&
      ["create-slide", "create-element"].includes(change.kind)
    ) add(change.target.slideId, "created-design");
  }
  if (registry.activeTheme) add(undefined, "theme", true);
  for (
    const block of registry.layouts.length
      ? doc.blocks.filter((b) =>
        b.kind === "div" && b.slideId &&
        b.raw.split(/\r?\n/)[0].includes(".bento-layout")
      )
      : []
  ) {
    const attrs = /\{([^{}]*)\}[ \t]*$/.exec(block.raw.split(/\r?\n/)[0]);
    if (!attrs) continue;
    let attr: ReturnType<typeof originalPandocAttributes>;
    try {
      attr = originalPandocAttributes(
        attrs[1],
        originalAttributeTokens(attrs[1]),
      );
    } catch (error) {
      if (!(error instanceof SourceError)) throw error;
      diagnostics.push({
        code: "ANNOTATION_UNSUPPORTED_ATTRIBUTES",
        slideId: block.slideId,
        message:
          "Optional registry-layout trace omitted: this original div uses syntax outside the bounded attribute parser. Existing source and pending semantic changes are preserved.",
      });
      continue;
    }
    const name = attr[2].find(([k]) => k === "bento-layout-name")?.[1];
    if (
      attr[1].includes("bento-layout") && name &&
      registry.layouts.includes(name)
    ) add(block.slideId, "layout", true);
  }
  return [...requests.values()].sort((a, b) =>
    a.slideId.localeCompare(b.slideId)
  );
}
/** Optional source edits must not invalidate existing weak provenance on rebuild. */
export function annotationIdentityDiagnostics(
  doc: SourceDocument,
  state: ProjectState,
): AnnotationDiagnostic[] {
  const unsafe = Object.entries(state.provenance).filter(([, p]) => {
    if (p.origin === "computed") return false;
    const source = p.source;
    if (
      source?.stable === true &&
      doc.blocks.some((b) => b.id === source.blockId && b.stable)
    ) return false;
    const parentId = source?.parentId, kind = source?.kind;
    return !(typeof parentId === "string" && source?.siblings === 1 &&
      doc.blocks.some((b) => b.id === parentId && b.stable) &&
      doc.blocks.filter((b) => b.parentId === parentId && b.kind === kind)
          .length === 1);
  }).map(([target]) => target);
  return unsafe.length
    ? [{
      code: "ANNOTATION_UNSAFE_REBUILD",
      message:
        `Optional annotations omitted: existing unpinned source identities (${
          unsafe.slice(0, 8).map((id) => id.slice(0, 120)).join(", ")
        }${
          unsafe.length > 8 ? ", …" : ""
        }) cannot safely survive a source hash change. Keep the original QMD and synchronize compatible semantic changes without optional traces. Enabling traces requires an explicit, verified identity migration; pending edits remain available.`,
    }]
    : [];
}
export function registryEqual(a: AnnotationRegistry, b: AnnotationRegistry) {
  return canonical(a) === canonical(b);
}

export interface AnnotationSummary {
  level: AnnotationLevel;
  patchCount: number;
  diagnostics: AnnotationDiagnostic[];
}
/** Backward-compatible journal/receipt summary; no invented source declarations. */
export function validateAnnotationSummary(
  value: unknown,
): asserts value is AnnotationSummary {
  const summary = value as AnnotationSummary;
  const codes = new Set([
    "ANNOTATION_UNPINNED_SLIDE",
    "ANNOTATION_UNMAPPED_SLIDE",
    "ANNOTATION_UNSAFE_REBUILD",
    "ANNOTATION_UNSUPPORTED_ATTRIBUTES",
  ]);
  if (
    !summary ||
    Object.keys(summary).sort().join(",") !== "diagnostics,level,patchCount" ||
    !["none", "minimal", "detailed"].includes(summary.level) ||
    !Number.isSafeInteger(summary.patchCount) || summary.patchCount < 0 ||
    summary.patchCount > 1000000 ||
    !Array.isArray(summary.diagnostics) || summary.diagnostics.some((d) =>
      !d ||
      Object.keys(d).some((k) => !["code", "message", "slideId"].includes(k)) ||
      !codes.has(d.code) || typeof d.message !== "string" || !d.message ||
      d.message.length > 65536 ||
      (d.slideId !== undefined &&
        (typeof d.slideId !== "string" ||
          !/^[A-Za-z][\w:@.-]*$/.test(d.slideId)))
    )
  ) {
    throw new StateError(
      "INVALID_ANNOTATION_SUMMARY",
      "Annotation journal/receipt summary is malformed; preserve it for explicit recovery.",
    );
  }
}
