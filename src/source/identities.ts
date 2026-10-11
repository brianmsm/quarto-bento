/** Inspectable identity acquisition; source writes belong only to approved sync. */
import {
  hashSource,
  scanSource,
  sliceBytes,
  type SourceDocument,
  SourceError,
  type SourcePatch,
} from "./mod.ts";
import { isNativeIdentity, isSourceIdentity } from "./identity-id.ts";
import {
  originalAttributeTokens,
  originalPandocAttributes,
} from "./attributes.ts";

export interface IdentityRequest {
  blockId: string;
  sourceId: string;
  nativeId: string;
  title: boolean;
}
export interface IdentityPreview {
  version: 1;
  kind: "source-identities";
  sourceHash: string;
  requests: IdentityRequest[];
  /** Preserve offset-derived computed identities without editing executable bytes. */
  producerRequests?: string[];
  patches: SourcePatch[];
  bindings: { blockId: string; newBlockId: string }[];
  result: string;
  resultHash: string;
}
const encoder = new TextEncoder(),
  decoder = new TextDecoder("utf-8", { fatal: true });
function fail(message: string): never {
  throw new SourceError("ambiguous-identity", message);
}
function splice(text: string, patches: SourcePatch[]) {
  let bytes = encoder.encode(text);
  for (
    const patch of [...patches].sort((a, b) => b.span.start - a.span.start)
  ) {
    if (sliceBytes(text, patch.span) !== patch.expected) {
      fail(
        "Identity fragment changed.",
      );
    }
    const replacement = encoder.encode(patch.replacement),
      next = new Uint8Array(
        bytes.length - (patch.span.end - patch.span.start) + replacement.length,
      );
    next.set(bytes.subarray(0, patch.span.start));
    next.set(replacement, patch.span.start);
    next.set(
      bytes.subarray(patch.span.end),
      patch.span.start + replacement.length,
    );
    bytes = next;
  }
  return decoder.decode(bytes);
}
export function previewIdentities(
  document: SourceDocument,
  requests: IdentityRequest[],
  producerRequests: string[] = [],
): IdentityPreview {
  if (
    hashSource(document.text) !== document.hash || document.diagnostics.length
  ) fail("Resolve source diagnostics before acquiring identities.");
  const patches: SourcePatch[] = [],
    bindings: IdentityPreview["bindings"] = [],
    reserved = new Set(
      document.blocks.filter((b) => b.stable).map((b) => b.id),
    );
  const seen = new Set<string>();
  for (const request of requests) {
    if (
      !isSourceIdentity(request.sourceId) ||
      !isNativeIdentity(request.nativeId) || seen.has(request.blockId) ||
      reserved.has(request.sourceId)
    ) fail("Source/native identities are unsafe or collide.");
    seen.add(request.blockId);
    reserved.add(request.sourceId);
    const blocks = document.blocks.filter((block) =>
      block.id === request.blockId
    );
    if (blocks.length !== 1) {
      fail("Identity does not select exactly one original block.");
    }
    const block = blocks[0];
    if (
      block.stable || block.origin !== "authored" || !block.editable ||
      !["heading", "paragraph", "list"].includes(block.kind)
    ) {
      fail(
        "Only weak authored headings, paragraphs and lists can acquire a verified identity.",
      );
    }
    if (block.parentId) {
      const parent = document.blocks.find((candidate) =>
        candidate.id === block.parentId
      );
      if (!parent || /\.bento-[\w-]+/.test(parent.raw.split(/\r?\n/)[0])) {
        fail(
          "Pin component child identities explicitly; wrapping must not change component structure.",
        );
      }
    }
    let replacement: string, newBlockId: string;
    if (block.kind === "heading") {
      const newline = block.raw.endsWith("\r\n")
        ? "\r\n"
        : block.raw.endsWith("\n")
        ? "\n"
        : "";
      const line = block.raw.slice(0, block.raw.length - newline.length),
        attrs = /\{([^{}]*)\}[ \t]*$/.exec(line);
      const native = request.title
        ? ` bento-title-id="${request.nativeId}"`
        : "";
      if (attrs) {
        const attr = originalPandocAttributes(
          attrs[1],
          originalAttributeTokens(attrs[1]),
        );
        if (attr[0] || attr[2].some(([name]) => name === "bento-title-id")) {
          fail("Heading already has an ambiguous source/native declaration.");
        }
        replacement = line.slice(0, attrs.index) +
          `{#${request.sourceId} ${attrs[1]}${native}}` +
          line.slice(attrs.index + attrs[0].length) + newline;
      } else replacement = line + ` {#${request.sourceId}${native}}` + newline;
      newBlockId = request.sourceId;
    } else {
      if (request.title) fail("A body text block is not a slide title.");
      const newline = document.newline;
      const body = block.raw + (block.raw.endsWith("\n") ? "" : newline);
      replacement =
        `::: {#${request.sourceId} bento-element-id="${request.nativeId}"}${newline}${newline}${body}${newline}:::${newline}`;
      newBlockId = `${request.sourceId}/${block.kind}:1`;
    }
    patches.push({
      blockId: block.id,
      span: block.span,
      expected: block.raw,
      replacement,
    });
    bindings.push({ blockId: block.id, newBlockId });
  }
  for (const producerId of producerRequests) {
    const blocks = document.blocks.filter((block) => block.id === producerId);
    const block = blocks[0];
    if (
      !/^chunk@(?:0|[1-9][0-9]*)$/.test(producerId) || seen.has(producerId) ||
      blocks.length !== 1 || !block || block.kind !== "chunk" ||
      block.origin !== "computed" || block.stable || block.parentId ||
      block.id !== `chunk@${block.span.start}`
    ) {
      fail(
        "Producer identity needs one exact unlabelled top-level executable chunk.",
      );
    }
    seen.add(producerId);
    patches.push({
      blockId: producerId,
      span: { start: block.span.start, end: block.span.start },
      expected: "",
      replacement: `<!-- qb-producer:${producerId} -->${document.newline}`,
    });
  }
  const ordered = [...patches].sort((a, b) => a.span.start - b.span.start);
  for (let i = 1; i < ordered.length; i++) {
    if (ordered[i].span.start < ordered[i - 1].span.end) {
      fail("Identity patches overlap.");
    }
  }
  const result = splice(document.text, patches), fresh = scanSource(result);
  if (fresh.diagnostics.length) {
    fail("Acquired identities make source structure ambiguous.");
  }
  for (const binding of bindings) {
    const before = document.blocks.find((block) =>
        block.id === binding.blockId
      )!,
      after = fresh.blocks.filter((block) => block.id === binding.newBlockId);
    if (
      after.length !== 1 || after[0].kind !== before.kind ||
      after[0].content !== before.content || after[0].origin !== "authored"
    ) fail("Identity acquisition changed authored content.");
  }
  for (const producerId of producerRequests) {
    const before = document.blocks.find((block) => block.id === producerId)!;
    const matches = fresh.blocks.filter((block) => block.id === producerId);
    const after = matches[0];
    if (
      matches.length !== 1 || after.kind !== "chunk" ||
      after.origin !== "computed" || !after.stable ||
      after.raw !== before.raw || after.content !== before.content ||
      after.editable
    ) fail("Producer identity changed executable content or ownership.");
  }
  return {
    version: 1,
    kind: "source-identities",
    sourceHash: document.hash,
    requests: structuredClone(requests),
    ...(producerRequests.length
      ? { producerRequests: [...producerRequests] }
      : {}),
    patches,
    bindings,
    result,
    resultHash: hashSource(result),
  };
}
export function applyIdentities(text: string, plan: IdentityPreview): string {
  if (hashSource(text) !== plan.sourceHash) {
    throw new SourceError(
      "stale-source",
      "Source changed after identity preview.",
    );
  }
  const fresh = previewIdentities(
    scanSource(text),
    plan.requests,
    plan.producerRequests,
  );
  if (JSON.stringify(fresh) !== JSON.stringify(plan)) {
    throw new SourceError(
      "invalid-identity-plan",
      "Identity preview was modified.",
    );
  }
  return fresh.result;
}
