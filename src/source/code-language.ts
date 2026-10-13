import {
  hashSource,
  scanSource,
  type SourceDocument,
  SourceError,
  type SourcePatch,
} from "./mod.ts";
import {
  originalAttributeTokens,
  originalPandocAttributes,
} from "./attributes.ts";
/** Exact built-in selector IDs at Bento pin 3d6f7f1fcdf2308e875345ce4f1e0ec0820c914b; no inferred aliases. */
export const DISPLAYED_CODE_LANGUAGES = [
  "js",
  "ts",
  "py",
  "rust",
  "go",
  "java",
  "sh",
  "sql",
  "c",
  "cpp",
  "csharp",
  "kotlin",
  "swift",
  "scala",
  "dart",
  "zig",
  "php",
  "ruby",
  "perl",
  "lua",
  "r",
  "julia",
  "powershell",
  "haskell",
  "elixir",
  "erlang",
  "clojure",
  "ocaml",
  "fsharp",
  "json",
  "yaml",
  "toml",
  "ini",
  "xml",
  "html",
  "css",
  "graphql",
  "proto",
  "dockerfile",
  "makefile",
  "asm",
  "elm",
  "nim",
  "crystal",
  "solidity",
  "hcl",
  "nix",
  "matlab",
  "fortran",
  "pascal",
  "groovy",
  "verilog",
  "vhdl",
  "latex",
  "objc",
  "scheme",
  "lisp",
  "prolog",
  "ada",
  "d",
  "gleam",
  "batch",
  "awk",
  "tcl",
  "vb",
  "scss",
  "nginx",
  "jinja",
  "sparql",
  "cypher",
  "fish",
  "apex",
  "purescript",
  "odin",
  "zsh",
  "diff",
  "md",
] as const;
export interface CodeLanguageRequest {
  blockId: string;
  expected: string | null;
  language: string | null;
}
export interface CodeLanguagePreview {
  version: 1;
  kind: "displayed-code-language";
  sourceHash: string;
  requests: CodeLanguageRequest[];
  patches: SourcePatch[];
  result: string;
  resultHash: string;
}
function fail(message: string): never {
  throw new SourceError("unsupported-code-language", message);
}
export function checkedCodeLanguage(value: unknown): string | null {
  if (value === null) return null;
  if (
    typeof value !== "string" ||
    !DISPLAYED_CODE_LANGUAGES.includes(
      value as typeof DISPLAYED_CODE_LANGUAGES[number],
    )
  ) {
    fail(
      "Select an exact built-in Bento language ID, or remove the language; executable syntax and unknown aliases are unsupported.",
    );
  }
  return value;
}
export function codeLanguageSyntax(raw: string) {
  const line = raw.split(/\r?\n/)[0],
    fence = /^ {0,3}(`{3,}|~{3,})([ \t]*)(.*?)([ \t]*)$/.exec(line);
  if (!fence) {
    fail("Displayed code requires one exact original non-executable fence.");
  }
  const prefix = line.indexOf(fence[1]) + fence[1].length + fence[2].length,
    info = fence[3];
  if (info.startsWith("{")) {
    if (!/^\{[^{}]*\}$/.test(info)) {
      fail("Executable/raw/nested fence syntax cannot change language.");
    }
    const content = info.slice(1, -1),
      tokens = originalAttributeTokens(content),
      attr = originalPandocAttributes(content, tokens);
    if (attr[1].length > 1) {
      fail("Displayed code must have at most one original language class.");
    }
    const token = tokens.find((t) => !t.key && content[t.start] === ".");
    return {
      grammar: attr[1][0] ?? null,
      start: prefix + 1 + (token?.start ?? content.length),
      end: prefix + 1 + (token?.end ?? content.length),
      attribute: true,
    };
  }
  if (/[\s{}]/.test(info)) {
    fail("Plain displayed fences require one literal language token.");
  }
  return {
    grammar: info || null,
    start: prefix,
    end: prefix + info.length,
    attribute: false,
  };
}
const encoder = new TextEncoder(),
  decoder = new TextDecoder("utf-8", { fatal: true });
function splice(text: string, patches: SourcePatch[]) {
  let bytes = encoder.encode(text);
  for (const p of [...patches].sort((a, b) => b.span.start - a.span.start)) {
    if (
      decoder.decode(bytes.subarray(p.span.start, p.span.end)) !== p.expected
    ) throw new SourceError("stale-fragment", p.blockId);
    const replacement = encoder.encode(p.replacement),
      next = new Uint8Array(
        bytes.length - p.span.end + p.span.start + replacement.length,
      );
    next.set(bytes.subarray(0, p.span.start));
    next.set(replacement, p.span.start);
    next.set(bytes.subarray(p.span.end), p.span.start + replacement.length);
    bytes = next;
  }
  return decoder.decode(bytes);
}
export function previewCodeLanguages(
  doc: SourceDocument,
  requests: CodeLanguageRequest[],
): CodeLanguagePreview {
  if (hashSource(doc.text) !== doc.hash) {
    throw new SourceError("stale-document", "Source snapshot changed.");
  }
  const seen = new Set<string>(), patches: SourcePatch[] = [];
  for (const r of requests) {
    if (
      !r || Object.keys(r).sort().join(",") !== "blockId,expected,language" ||
      typeof r.blockId !== "string" ||
      !(r.expected === null || typeof r.expected === "string") ||
      seen.has(r.blockId)
    ) fail("Malformed or duplicate code language request.");
    seen.add(r.blockId);
    checkedCodeLanguage(r.language);
    const blocks = doc.blocks.filter((b) => b.id === r.blockId), b = blocks[0];
    if (
      blocks.length !== 1 || b.kind !== "code" || b.origin !== "authored" ||
      !b.editable
    ) fail("Language sync is limited to one authored non-executable fence.");
    const syntax = codeLanguageSyntax(b.raw);
    if (syntax.grammar !== r.expected) {
      throw new SourceError(
        "source-conflict",
        "Original displayed language changed; recalculate before reviewing.",
      );
    }
    const line = b.raw.split(/\r?\n/)[0],
      expected = line.slice(syntax.start, syntax.end),
      replacement = r.language === null
        ? ""
        : syntax.attribute
        ? (syntax.grammar ? "." + r.language : " ." + r.language)
        : r.language;
    const start = b.span.start +
        encoder.encode(line.slice(0, syntax.start)).length,
      end = b.span.start + encoder.encode(line.slice(0, syntax.end)).length;
    patches.push({
      blockId: b.id,
      span: { start, end },
      expected,
      replacement,
    });
  }
  const result = splice(doc.text, patches), fresh = scanSource(result);
  const shape = (d: SourceDocument) =>
    d.blocks.map(
      (b) => [
        b.kind,
        b.explicitId,
        b.level,
        b.origin,
        b.kind === "div" ? null : b.content,
      ],
    );
  if (
    JSON.stringify(shape(doc)) !== JSON.stringify(shape(fresh)) ||
    fresh.diagnostics.length
  ) {
    fail(
      "Language edit changed source body, identity or execution boundaries.",
    );
  }
  for (const r of requests) {
    const b = fresh.blocks.find((b) => b.id === r.blockId);
    if (!b || codeLanguageSyntax(b.raw).grammar !== r.language) {
      fail("Language does not round-trip exactly.");
    }
  }
  return {
    version: 1,
    kind: "displayed-code-language",
    sourceHash: doc.hash,
    requests: structuredClone(requests),
    patches,
    result,
    resultHash: hashSource(result),
  };
}
export function applyCodeLanguages(text: string, preview: CodeLanguagePreview) {
  if (
    preview.version !== 1 || preview.kind !== "displayed-code-language" ||
    hashSource(text) !== preview.sourceHash
  ) {
    throw new SourceError(
      "stale-source",
      "Review the current code language patch.",
    );
  }
  const verified = previewCodeLanguages(scanSource(text), preview.requests);
  if (JSON.stringify(verified) !== JSON.stringify(preview)) {
    throw new SourceError(
      "invalid-preview",
      "Code language preview changed after review.",
    );
  }
  return verified.result;
}
