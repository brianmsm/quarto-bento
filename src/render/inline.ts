/** Faithful bounded rich-text vocabulary shared by projection and explicit sync. */
import { StateError } from "../state/mod.ts";
import { escapeHtml } from "./html.ts";
import type { Node } from "./types.ts";
export const INLINE_CODEC_VERSION = 1;
type Attr = [string, string[], [string, string][]];
function fail(message: string): never {
  throw new StateError("UNSUPPORTED_HTML", message);
}
function decodeEntities(value: string): string {
  return value.replace(/&([^;\s]+);/g, (_whole, name: string) => {
    const named: Record<string, string> = {
      amp: "&",
      lt: "<",
      gt: ">",
      quot: '"',
      apos: "'",
      nbsp: "\u00a0",
    };
    if (Object.hasOwn(named, name)) return named[name];
    if (/^#(?:[0-9]+|x[0-9a-f]+)$/i.test(name)) {
      const point = name[1].toLowerCase() === "x"
        ? parseInt(name.slice(2), 16)
        : parseInt(name.slice(1), 10);
      if (
        point > 0 && point <= 0x10ffff && !(point >= 0xd800 && point <= 0xdfff)
      ) {
        return String.fromCodePoint(point);
      }
    }
    return fail(`Unsupported or invalid HTML entity &${name};.`);
  });
}
function webLink(href: string): string {
  if (
    !/^https?:\/\//i.test(href) || /[\s<>"'\\]/u.test(href) ||
    Array.from(href).some((c) =>
      c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127
    )
  ) {
    fail(
      "Only explicit http/https links without control characters are supported by native Bento.",
    );
  }
  try {
    if (!new URL(href).hostname) fail("Link has no hostname.");
  } catch {
    fail("Link is not a valid web URL.");
  }
  return href;
}
function plainAttributes(attr: Attr): boolean {
  return !attr[0] && !attr[1].length && !attr[2].length;
}
export function renderInline(nodes: Node[]): string {
  return nodes.map((node) => {
    switch (node.t) {
      case "Str":
        return escapeHtml(String(node.c));
      case "Space":
      case "SoftBreak":
        return " ";
      case "LineBreak":
        return "<br>";
      case "Strong":
        return `<b>${renderInline(node.c as Node[])}</b>`;
      case "Emph":
        return `<i>${renderInline(node.c as Node[])}</i>`;
      case "Underline":
        return `<u>${renderInline(node.c as Node[])}</u>`;
      case "Strikeout":
        return `<s>${renderInline(node.c as Node[])}</s>`;
      case "Code": {
        const [attr, code] = node.c as [Attr, string];
        if (!plainAttributes(attr)) {
          fail("Inline code attributes need an explicit supported projection.");
        }
        return `<code>${escapeHtml(code)}</code>`;
      }
      case "Span":
        return renderInline((node.c as [Attr, Node[]])[1]);
      case "Link": {
        const [attr, content, [href, title]] = node.c as [
          Attr,
          Node[],
          [string, string],
        ];
        if (!plainAttributes(attr) || title) {
          fail(
            "Native Bento cannot retain link titles or extra link attributes; edit the source explicitly.",
          );
        }
        return `<a href="${escapeHtml(webLink(href))}">${
          renderInline(content)
        }</a>`;
      }
      default:
        throw new Error(
          `UNSUPPORTED_INLINE: ${node.t}; no faithful projection implemented`,
        );
    }
  }).join("");
}
const escapeMarkdown = (text: string) =>
  text.replace(/[\\`*_[\]{}<>!#$|~^@]/g, "\\$&");
function codeSpan(text: string): string {
  if (!text || /[\r\n\t]|^\s|\s$| {2,}/.test(text)) {
    fail(
      "Inline code with empty text or significant whitespace needs explicit source review; Pandoc normalizes those spaces.",
    );
  }
  const longest = Math.max(
    0,
    ...(text.match(/`+/g) ?? []).map((s) => s.length),
  );
  const delimiter = "`".repeat(longest + 1);
  const pad = /^`|`$/.test(text) ? " " : "";
  return delimiter + pad + text + pad + delimiter;
}
interface OpenTag {
  tag: string;
  kind: "b" | "i" | "s" | "code" | "a";
  text: string;
  href?: string;
}
/** Parse only the reviewed subset. Unsupported markup never disappears silently. */
function convertInline(html: string): { markdown: string; html: string } {
  if (html.length > 1_000_000 || html.includes("\u0000")) {
    fail("Invalid or excessive text fragment.");
  }
  let input = html.trim();
  const wrapper = input.match(/^<(p|div)>([\s\S]*)<\/\1>$/i);
  if (wrapper && !new RegExp(`<\\/?${wrapper[1]}\\b`, "i").test(wrapper[2])) {
    input = wrapper[2];
  }
  const tokens = input.match(/<[^>]*>|[^<]+|</g) ?? [];
  let open: OpenTag | undefined, markdown = "", canonical = "";
  for (const token of tokens) {
    if (!token.startsWith("<")) {
      const raw = decodeEntities(token);
      const text = open?.kind === "code"
        ? raw
        : raw.replace(/[\r\n\t ]+/g, " ");
      if (open) open.text += text;
      else {
        markdown += escapeMarkdown(text);
        canonical += escapeHtml(text);
      }
      continue;
    }
    if (/^<br\s*\/?\s*>$/i.test(token)) {
      if (open) {
        fail("Line breaks inside formatted spans need explicit source review.");
      }
      markdown += "  \n";
      canonical += "<br>";
      continue;
    }
    const end = token.match(/^<\/([a-z]+)\s*>$/i);
    if (end) {
      if (!open || open.tag !== end[1].toLowerCase()) {
        fail("HTML tags are unbalanced.");
      }
      if (!open.text || (open.kind !== "code" && /^\s|\s$/.test(open.text))) {
        fail(
          "Empty formatting or boundary whitespace needs explicit source review.",
        );
      }
      if (open.kind === "code") markdown += codeSpan(open.text);
      else if (open.kind === "a") {
        markdown += `[${escapeMarkdown(open.text)}](<${open.href}>)`;
      } else {
        const mark = ({ b: "**", i: "*", s: "~~" })[open.kind];
        markdown += mark + escapeMarkdown(open.text) + mark;
      }
      canonical += `<${open.kind}${
        open.kind === "a" ? ` href="${escapeHtml(open.href!)}"` : ""
      }>${escapeHtml(open.text)}</${open.kind}>`;
      open = undefined;
      continue;
    }
    if (open) fail("Nested formatting needs explicit source review.");
    const style = token.match(/^<(b|strong|i|em|s|code)\s*>$/i);
    const legacyStrike =
      /^<span\s+style=(?:"text-decoration:\s*line-through;?"|'text-decoration:\s*line-through;?')\s*>$/i
        .test(token);
    const link = token.match(/^<a\s+href=(?:"([^"]*)"|'([^']*)')\s*>$/i);
    if (!style && !legacyStrike && !link) {
      fail(
        "Supported text sync: plain text, b/strong, i/em, s, code, web links and br. Review other formatting in QMD.",
      );
    }
    const tag = link ? "a" : legacyStrike ? "span" : style![1].toLowerCase();
    const kind = link
      ? "a"
      : legacyStrike || tag === "s"
      ? "s"
      : tag === "code"
      ? "code"
      : ["b", "strong"].includes(tag)
      ? "b"
      : "i";
    if (["b", "i", "s"].includes(kind) && /(?:\*\*|\*|~~)$/.test(markdown)) {
      fail("Adjacent emphasis needs explicit source review.");
    }
    if (kind === "code" && /`$/.test(markdown)) {
      fail("Adjacent code spans need explicit source review.");
    }
    open = {
      tag,
      kind,
      text: "",
      ...(link ? { href: webLink(decodeEntities(link[1] ?? link[2])) } : {}),
    };
  }
  if (open) fail("HTML tags are unclosed.");
  markdown = markdown.trim().replace(/(^|\n)([-+] )/g, "$1\\$2").replace(
    /(^|\n)(\d+)([.)]) /g,
    "$1$2\\$3 ",
  );
  if (!markdown) {
    fail("An empty text field requires explicit deletion, not text sync.");
  }
  return { markdown, html: canonical.trim() };
}
export function inlineHtmlToMarkdown(html: string): string {
  return convertInline(html).markdown;
}
export function canonicalInlineHtml(html: string): string {
  return convertInline(html).html;
}
