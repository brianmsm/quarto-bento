/** Native attribute-free list vocabulary supported by pinned Bento. */
import { StateError } from "../state/mod.ts";
import {
  canonicalInlineHtml,
  inlineHtmlToMarkdown,
  renderInline,
} from "./inline.ts";
import type { Node } from "./types.ts";
export const LIST_CODEC_VERSION = 1;
const fail = (message: string): never => {
  throw new StateError("UNSUPPORTED_LIST", message);
};
export function renderList(node: Node, depth = 0): string {
  if (depth > 8) fail("List nesting exceeds eight levels.");
  let items: Node[][], tag: string;
  if (node.t === "BulletList") {
    items = node.c as Node[][];
    tag = "ul";
  } else if (node.t === "OrderedList") {
    const [attributes, children] = node.c as [
      [number, { t: string }, { t: string }],
      Node[][],
    ];
    if (
      attributes[0] !== 1 ||
      !["Decimal", "DefaultStyle"].includes(attributes[1].t) ||
      !["Period", "DefaultDelim"].includes(attributes[2].t)
    ) {
      fail(
        "Native Bento preserves decimal lists starting at 1 with period markers only; its sanitizer removes start/type attributes.",
      );
    }
    items = children;
    tag = "ol";
  } else return fail("Expected a bullet or ordered list.");
  if (!items.length) fail("Empty lists require explicit deletion.");
  return `<${tag}>` + items.map((blocks) => {
    if (!blocks.length || !["Plain", "Para"].includes(blocks[0].t)) {
      fail(
        "List items need initial authored text; empty items and block-only items require a separate projection.",
      );
    }
    return `<li>` + blocks.map((block) => {
      if (["BulletList", "OrderedList"].includes(block.t)) {
        return renderList(block, depth + 1);
      }
      if (!["Plain", "Para"].includes(block.t)) {
        fail(
          "List code, images and other non-text blocks need an explicit projection.",
        );
      }
      const content = renderInline(block.c as Node[]);
      if (!content.trim()) fail("Empty list paragraphs are unsupported.");
      return block.t === "Para" ? `<p>${content}</p>` : content;
    }).join("") + `</li>`;
  }).join("") + `</${tag}>`;
}
interface Leaf {
  html: string;
  markdown: string;
  paragraph: boolean;
}
interface List {
  tag: "ul" | "ol";
  items: (Leaf | List)[][];
}
/** Strict structural parser; inline leaves use the existing independently checked codec. */
export function parseNativeList(
  html: string,
): { html: string; markdown: string } {
  if (html.length > 1_000_000 || html.includes("\0")) {
    fail("Invalid or excessive list fragment.");
  }
  const tokens = html.trim().match(/<[^>]*>|[^<]+|</g) ?? [];
  let index = 0;
  const space = () => {
    while (/^\s+$/.test(tokens[index] ?? "")) index++;
  };
  const parse = (depth: number): List => {
    if (depth > 8) fail("List nesting exceeds eight levels.");
    space();
    const opener = /^<(ul|ol)>$/i.exec(tokens[index++] ?? "");
    if (!opener) fail("Lists must be attribute-free ul or ol elements.");
    const tag = opener![1].toLowerCase() as "ul" | "ol",
      items: List["items"] = [];
    space();
    while (/^<li>$/i.test(tokens[index] ?? "")) {
      index++;
      const parts: (Leaf | List)[] = [];
      while (index < tokens.length && !/^<\/li>$/i.test(tokens[index])) {
        if (/^<(?:ul|ol)>$/i.test(tokens[index])) {
          if (!parts.length) {
            fail("A list item needs text before nested lists.");
          }
          parts.push(parse(depth + 1));
          continue;
        }
        const paragraph = /^<p>$/i.test(tokens[index]);
        let leaf = "";
        if (paragraph) {
          index++;
          while (index < tokens.length && !/^<\/p>$/i.test(tokens[index])) {
            leaf += tokens[index++];
          }
          if (!/^<\/p>$/i.test(tokens[index++] ?? "")) {
            fail("Unclosed list paragraph.");
          }
        } else {
          if (parts.length) {
            fail("Text after nested lists needs a native paragraph boundary.");
          }
          while (
            index < tokens.length &&
            !/^<(?:ul|ol|p)>$|^<\/li>$/i.test(tokens[index])
          ) leaf += tokens[index++];
        }
        parts.push({
          html: canonicalInlineHtml(leaf),
          markdown: inlineHtmlToMarkdown(leaf),
          paragraph,
        });
      }
      if (!parts.length || !/^<\/li>$/i.test(tokens[index++] ?? "")) {
        fail("Malformed or empty list item.");
      }
      items.push(parts);
      space();
    }
    if (
      !items.length ||
      !new RegExp(`^</${tag}>$`, "i").test(tokens[index++] ?? "")
    ) fail("Malformed or empty list.");
    if (
      items.flat().some((i) => "paragraph" in i && i.paragraph) &&
      items.flat().some((i) => "paragraph" in i && !i.paragraph)
    ) {
      fail("Mixed tight and loose items need explicit source review.");
    }
    return { tag, items };
  };
  const root = parse(0);
  space();
  if (index !== tokens.length) {
    fail("A list object must contain exactly one list.");
  }
  const emitHtml = (list: List): string =>
    `<${list.tag}>` + list.items.map((parts) =>
      `<li>` + parts.map((part) =>
        "tag" in part
          ? emitHtml(part)
          : part.paragraph
          ? `<p>${part.html}</p>`
          : part.html
      ).join("") + `</li>`
    ).join("") + `</${list.tag}>`;
  const emitMarkdown = (list: List): string => {
    const loose = list.items.flat().some((part) =>
      "paragraph" in part && part.paragraph
    );
    return list.items.map((parts, n) => {
      const marker = list.tag === "ul" ? "- " : `${n + 1}. `,
        indent = " ".repeat(marker.length);
      const body = parts.map((part) =>
        "tag" in part ? emitMarkdown(part) : part.markdown
      ).join(loose ? "\n\n" : "\n");
      return marker + body.replaceAll("\n", "\n" + indent);
    }).join(loose ? "\n\n" : "\n");
  };
  return { html: emitHtml(root), markdown: emitMarkdown(root) };
}
