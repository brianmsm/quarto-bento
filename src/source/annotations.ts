/** Optional descriptive QMD traces; never visual ownership or technical IDs. */
import {
  hashSource,
  scanSource,
  sliceBytes,
  type SourceDocument,
  SourceError,
  type SourcePatch,
} from "./mod.ts";
import {
  originalAttributeTokens,
  originalPandocAttributes,
} from "./attributes.ts";
import { canonical } from "../state/json.ts";
export type AnnotationLevel = "none" | "minimal" | "detailed";
export type AnnotationFeature =
  | "overrides"
  | "decorations"
  | "stacking"
  | "created-design"
  | "theme"
  | "layout";
export type AnnotationReference = ".qbento/state.json" | ".qbento/design.json";
export interface AnnotationRequest {
  slideId: string;
  features: AnnotationFeature[];
  references: AnnotationReference[];
}
export interface AnnotationDiagnostic {
  code: string;
  message: string;
  slideId?: string;
}
export interface AnnotationPreview {
  version: 1;
  kind: "visual-annotations";
  sourceHash: string;
  level: AnnotationLevel;
  requests: AnnotationRequest[];
  blocked: AnnotationDiagnostic[];
  diagnostics: AnnotationDiagnostic[];
  patches: SourcePatch[];
  resultHash: string;
  result: string;
}
const featureNames = new Set([
  "overrides",
  "decorations",
  "stacking",
  "created-design",
  "theme",
  "layout",
]);
const references = new Set([".qbento/state.json", ".qbento/design.json"]);
const encoder = new TextEncoder(),
  decoder = new TextDecoder("utf-8", { fatal: true });
const namespace = "qbento-design";
function fail(message: string): never {
  throw new SourceError("invalid-annotation", message);
}
function normalizedRequests(
  requests: AnnotationRequest[],
): AnnotationRequest[] {
  const ids = new Set<string>();
  return requests.map((r) => {
    if (
      !r || !/^[A-Za-z][\w:@.-]*$/.test(r.slideId) || ids.has(r.slideId) ||
      !Array.isArray(r.features) || !Array.isArray(r.references) ||
      r.features.some((f) => !featureNames.has(f)) ||
      r.references.some((f) => !references.has(f)) ||
      new Set(r.features).size !== r.features.length ||
      new Set(r.references).size !== r.references.length ||
      !r.features.length || !r.references.length
    ) {
      fail(
        "Each trace must identify one stable slide and controlled design references/features.",
      );
    }
    ids.add(r.slideId);
    return {
      slideId: r.slideId,
      features: [...r.features].sort(),
      references: [...r.references].sort(),
    };
  }).sort((a, b) => a.slideId.localeCompare(b.slideId));
}
function splice(text: string, patches: SourcePatch[]): string {
  let bytes = encoder.encode(text);
  for (const p of [...patches].sort((a, b) => b.span.start - a.span.start)) {
    if (sliceBytes(text, p.span) !== p.expected) {
      throw new SourceError(
        "stale-fragment",
        "Annotation source fragment changed.",
      );
    }
    const inserted = encoder.encode(p.replacement),
      next = new Uint8Array(
        bytes.length - (p.span.end - p.span.start) + inserted.length,
      );
    next.set(bytes.subarray(0, p.span.start));
    next.set(inserted, p.span.start);
    next.set(bytes.subarray(p.span.end), p.span.start + inserted.length);
    bytes = next;
  }
  return decoder.decode(bytes);
}
/** Standalone comments at 0–3 spaces; indented code/tabs and fenced literals are not traces. */
function comments(doc: SourceDocument) {
  const found: {
    start: number;
    end: number;
    raw: string;
    data: AnnotationRequest;
  }[] = [];
  const yaml = /^(?:\uFEFF)?---[ \t]*\r?\n/.test(doc.text)
    ? /^(?:\uFEFF)?---[ \t]*\r?\n[\s\S]*?^(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/m
      .exec(doc.text)?.[0]
    : undefined;
  const yamlEnd = yaml ? encoder.encode(yaml).length : 0;
  for (
    const match of doc.text.matchAll(
      /^ {0,3}<!--[ \t]*qbento-design\b[^\r\n]*(?:\r\n|\n|$)/gm,
    )
  ) {
    const start = encoder.encode(doc.text.slice(0, match.index)).length;
    if (start < yamlEnd) continue;
    if (
      doc.blocks.some((b) =>
        ["code", "chunk", "math"].includes(b.kind) && start >= b.span.start &&
        start < b.span.end
      )
    ) continue;
    const raw = match[0],
      body =
        /^ {0,3}<!--[ \t]*qbento-design:[ \t]*(\{.*\})[ \t]*-->[ \t]*(?:\r\n|\n|$)$/
          .exec(raw)?.[1];
    let value: {
      version?: unknown;
      slideId?: unknown;
      references?: unknown;
      features?: unknown;
    };
    try {
      if (!body) {
        fail(
          "A reserved qbento-design comment is malformed; preserve and repair it before syncing.",
        );
      }
      const keys = [...body.matchAll(/("(?:[^"\\]|\\.)*")[ \t]*:/g)].map((m) =>
        JSON.parse(m[1]) as string
      );
      if (new Set(keys).size !== keys.length) {
        fail(
          "Duplicate keys in a reserved design reference; repair the original comment before sync.",
        );
      }
      value = JSON.parse(body);
    } catch {
      fail(
        "A reserved qbento-design comment is malformed; preserve and repair it before syncing.",
      );
    }
    if (
      !value ||
      Object.keys(value).sort().join(",") !==
        "features,references,slideId,version" ||
      value.version !== 1
    ) {
      fail(
        "A reserved design reference has an unsupported schema; preserve it rather than guessing its meaning.",
      );
    }
    const data = normalizedRequests([value as unknown as AnnotationRequest])[0];
    found.push({ start, end: start + encoder.encode(raw).length, raw, data });
  }
  return found;
}
export interface SourceDesignAnnotation {
  slideId: string;
  /** Minimal classes deliberately do not identify one specific sidecar. */
  features?: AnnotationFeature[];
  references?: AnnotationReference[];
}
/** Read original managed traces only; no patches, technical IDs or ownership. */
export function readDesignAnnotations(
  doc: SourceDocument,
): SourceDesignAnnotation[] {
  if (hashSource(doc.text) !== doc.hash) {
    throw new SourceError("stale-document", "Source snapshot changed.");
  }
  const existing = comments(doc), consumed = new Set<number>();
  const result: SourceDesignAnnotation[] = [];
  for (const slide of doc.slides) {
    const heading = doc.blocks.find((b) => b.id === slide.headingId)!;
    const associated = existing.filter((c) =>
      c.start >= heading.span.end &&
      /^[\r\n \t]*$/.test(
        sliceBytes(doc.text, { start: heading.span.end, end: c.start }),
      )
    );
    if (associated.length > 1) {
      fail("More than one descriptive reference follows a slide heading.");
    }
    const current = associated[0];
    if (current) {
      consumed.add(current.start);
      if (current.data.slideId !== slide.id) {
        fail(
          "A descriptive reference points to a different source slide; preserve and reconcile it before sync.",
        );
      }
    }
    const line = heading.raw.replace(/(?:\r\n|\n|\r)$/, "");
    const attrs = /\{([^{}]*)\}[ \t]*$/.exec(line);
    let annotated = false;
    if (
      attrs?.[1].replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, "")
        .match(/(?:^|\s)\.qbento-design(?:\s|$)/)
    ) {
      const tokens = originalAttributeTokens(attrs[1]);
      originalPandocAttributes(attrs[1], tokens);
      const marks = tokens.filter((t) =>
        attrs[1].slice(t.start, t.end) === `.${namespace}`
      );
      if (marks.length > 1) {
        fail(
          "Duplicate .qbento-design class; preserve and repair it before sync.",
        );
      }
      annotated = marks.length === 1;
    }
    if (annotated || current) {
      result.push({
        slideId: slide.id,
        ...(current
          ? {
            features: current.data.features,
            references: current.data.references,
          }
          : {}),
      });
    }
  }
  if (existing.some((c) => !consumed.has(c.start))) {
    fail(
      "A reserved design reference does not directly follow its source slide heading.",
    );
  }
  return result;
}
/** Patches exactly optional class tokens/reference comments, preserving all other bytes. */
export function previewAnnotations(
  document: SourceDocument,
  level: AnnotationLevel,
  requests: AnnotationRequest[],
  blocked: AnnotationDiagnostic[] = [],
): AnnotationPreview {
  if (!["none", "minimal", "detailed"].includes(level)) {
    fail("Unknown annotation level.");
  }
  if (hashSource(document.text) !== document.hash) {
    throw new SourceError("stale-document", "Source snapshot changed.");
  }
  const doc = scanSource(document.text), desired = normalizedRequests(requests);
  if (doc.diagnostics.length) {
    throw new SourceError(
      "invalid-source-structure",
      "Repair QMD source diagnostics before annotation sync.",
    );
  }
  const existing = comments(doc), consumed = new Set<number>();
  const patches: SourcePatch[] = [], diagnostics: AnnotationDiagnostic[] = [];
  for (const slide of doc.slides) {
    const heading = doc.blocks.find((b) => b.id === slide.headingId)!;
    const request = desired.find((r) => r.slideId === slide.id);
    const line = heading.raw.replace(/(?:\r\n|\n|\r)$/, "");
    const attrs = /\{([^{}]*)\}[ \t]*$/.exec(line);
    const associated = existing.filter((c) =>
      c.start >= heading.span.end &&
      /^[\r\n \t]*$/.test(
        sliceBytes(doc.text, { start: heading.span.end, end: c.start }),
      )
    );
    if (associated.length > 1) {
      fail("More than one descriptive reference follows a slide heading.");
    }
    const current = associated[0];
    if (current) {
      consumed.add(current.start);
      if (current.data.slideId !== slide.id) {
        fail(
          "A descriptive reference points to a different source slide; preserve and reconcile it before sync.",
        );
      }
    }
    if (
      !current &&
      !attrs?.[1].replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, "").match(
        /(?:^|\s)\.qbento-design(?:\s|$)/,
      ) &&
      (level === "none" || !request)
    ) continue;
    let parsedId: string | undefined;
    let annotated = false;
    const local: {
      start: number;
      end: number;
      expected: string;
      replacement: string;
    }[] = [];
    if (attrs) {
      let tokens: ReturnType<typeof originalAttributeTokens>;
      try {
        tokens = originalAttributeTokens(attrs[1]);
        parsedId = originalPandocAttributes(attrs[1], tokens)[0];
      } catch (error) {
        if (!(error instanceof SourceError)) throw error;
        diagnostics.push({
          code: "ANNOTATION_UNSUPPORTED_ATTRIBUTES",
          slideId: slide.id,
          message:
            "Optional annotation update omitted: this heading uses attribute syntax outside the bounded original-source parser. Existing attributes, technical IDs and pending semantic edits are preserved.",
        });
        continue;
      }
      const marks = tokens.filter((t) =>
        attrs[1].slice(t.start, t.end) === `.${namespace}`
      );
      if (marks.length > 1) {
        fail(
          "Duplicate .qbento-design class; preserve and repair it before sync.",
        );
      }
      annotated = marks.length === 1;
      const wanted = level !== "none" && !!request;
      if (annotated && !wanted) {
        const mark = marks[0];
        const start = mark.start && attrs[1][mark.start - 1] === " "
          ? mark.start - 1
          : mark.start;
        local.push({
          start: attrs.index + 1 + start,
          end: attrs.index + 1 + mark.end,
          expected: attrs[1].slice(start, mark.end),
          replacement: "",
        });
      } else if (!annotated && wanted) {
        local.push({
          start: attrs.index + 1 + attrs[1].length,
          end: attrs.index + 1 + attrs[1].length,
          expected: "",
          replacement: ` .${namespace}`,
        });
      }
    } else if (level !== "none" && request) {
      diagnostics.push({
        code: "ANNOTATION_UNPINNED_SLIDE",
        slideId: slide.id,
        message:
          "Optional design signal omitted: use an existing explicit heading attribute ID; annotation sync never pins technical identity implicitly.",
      });
    }
    const pinned = slide.stable && !!attrs && parsedId === slide.id;
    if ((local.length || current || request) && !pinned) {
      if (local.length || current) {
        diagnostics.push({
          code: "ANNOTATION_UNPINNED_SLIDE",
          slideId: slide.id,
          message:
            "Optional annotation update omitted: the slide needs an existing explicit heading ID; technical markers and IDs are retained.",
        });
      }
      continue;
    }
    for (const p of local) {
      patches.push({
        blockId: slide.id,
        span: {
          start: heading.span.start +
            encoder.encode(line.slice(0, p.start)).length,
          end: heading.span.start + encoder.encode(line.slice(0, p.end)).length,
        },
        expected: p.expected,
        replacement: p.replacement,
      });
    }
    const wantedComment = level === "detailed" && request
      ? `<!-- ${namespace}: ${
        canonical({ version: 1, ...request })
      } -->${doc.newline}`
      : undefined;
    if (current) {
      const replacement = wantedComment ?? "";
      if (current.raw !== replacement) {
        patches.push({
          blockId: slide.id,
          span: { start: current.start, end: current.end },
          expected: current.raw,
          replacement,
        });
      }
    } else if (wantedComment) {
      const separator = /[\r\n]$/.test(heading.raw) ? "" : doc.newline;
      patches.push({
        blockId: slide.id,
        span: { start: heading.span.end, end: heading.span.end },
        expected: "",
        replacement: separator + wantedComment,
      });
    }
  }
  if (existing.some((c) => !consumed.has(c.start))) {
    fail(
      "Reserved design reference is not directly associated with one original slide heading.",
    );
  }
  for (const r of desired) {
    if (level !== "none" && !doc.slides.some((s) => s.id === r.slideId)) {
      diagnostics.push({
        code: "ANNOTATION_UNMAPPED_SLIDE",
        slideId: r.slideId,
        message:
          "Optional trace omitted: no matching original source slide exists. Add an explicit original heading ID, recalculate, and review; annotation sync never pins identity automatically.",
      });
    }
  }
  patches.sort((a, b) => a.span.start - b.span.start);
  for (let i = 1; i < patches.length; i++) {
    if (patches[i].span.start < patches[i - 1].span.end) {
      fail("Annotation patches overlap.");
    }
  }
  const applied = blocked.length ? [] : patches;
  const result = splice(doc.text, applied), rescanned = scanSource(result);
  const shape = (d: SourceDocument) =>
    d.blocks.map((
      b,
    ) => [
      b.kind,
      b.explicitId,
      b.level,
      b.origin,
      ...(b.kind === "div" ? [] : [b.content]),
    ]);
  if (
    canonical(shape(doc)) !== canonical(shape(rescanned)) ||
    rescanned.diagnostics.length
  ) {
    fail(
      "Optional annotation changed semantic content, identity or source structure.",
    );
  }
  return {
    version: 1,
    kind: "visual-annotations",
    sourceHash: doc.hash,
    level,
    requests: desired,
    blocked,
    diagnostics: [...diagnostics, ...blocked],
    patches: applied,
    resultHash: hashSource(result),
    result,
  };
}
export function applyAnnotations(
  text: string,
  plan: AnnotationPreview,
): string {
  if (hashSource(text) !== plan.sourceHash) {
    throw new SourceError(
      "stale-document",
      "Source changed since annotation preview.",
    );
  }
  const fresh = previewAnnotations(
    scanSource(text),
    plan.level,
    plan.requests,
    plan.blocked,
  );
  if (canonical(fresh) !== canonical(plan)) {
    throw new SourceError(
      "invalid-preview",
      "Annotation preview was changed or cannot be reproduced.",
    );
  }
  return fresh.result;
}
