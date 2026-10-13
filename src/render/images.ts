import { assetData } from "./assets.ts";
import { isAbsolute } from "node:path";
import { renderInline } from "./inline.ts";
import type { Node } from "./types.ts";
export type ImageAttr = [string, string[], [string, string][]];
export interface AuthoredImageShape {
  target: string;
  captionHtml: string;
  captioned: boolean;
}
function fail(): never {
  throw new Error(
    "UNSUPPORTED_AUTHORED_IMAGE: use one local standalone Markdown image with a bounded caption; image titles, numbered/cross-reference figures, extra HTML and transformed image structures need an explicit faithful adapter",
  );
}
const plain = (attr: ImageAttr) =>
  !attr[0] && !attr[1].length && !attr[2].length;
function image(
  node: Node,
  executed: boolean,
): { target: string; captionHtml: string } {
  if (node.t !== "Image" || !Array.isArray(node.c) || node.c.length !== 3) {
    return fail();
  }
  const [attr, alt, target] = node.c as [ImageAttr, Node[], [string, string]];
  if (
    !Array.isArray(attr) || !Array.isArray(alt) || !Array.isArray(target) ||
    target.length !== 2 || typeof target[0] !== "string" || target[1] !== ""
  ) return fail();
  if (
    executed
      ? attr[0] || attr[2].length ||
        JSON.stringify(attr[1]) !== JSON.stringify(["img-fluid"]) &&
          !plain(attr)
      : !plain(attr)
  ) return fail();
  return { target: target[0], captionHtml: renderInline(alt) };
}
function singleImage(blocks: Node[], executed: boolean) {
  if (blocks.length !== 1 || !["Plain", "Para"].includes(blocks[0].t)) {
    return fail();
  }
  const content = blocks[0].c as Node[];
  if (!Array.isArray(content) || content.length !== 1) return fail();
  return image(content[0], executed);
}
/** Original Pandoc Figure is checked independently from Quarto's generated HTML. */
export function originalImageShape(node: Node): AuthoredImageShape {
  if (node.t === "Para" || node.t === "Plain") {
    const value = singleImage([node], false);
    if (value.captionHtml) return fail();
    return { ...value, captioned: false };
  }
  if (node.t !== "Figure" || !Array.isArray(node.c) || node.c.length !== 3) {
    return fail();
  }
  const [attr, caption, blocks] = node.c as [ImageAttr, [null, Node[]], Node[]];
  if (
    !plain(attr) || !Array.isArray(caption) || caption.length !== 2 ||
    caption[0] !== null || caption[1].length !== 1 ||
    !["Plain", "Para"].includes(caption[1][0].t)
  ) return fail();
  const value = singleImage(blocks, false);
  const captionHtml = renderInline(caption[1][0].c as Node[]);
  if (!captionHtml || captionHtml !== value.captionHtml) return fail();
  return { ...value, captioned: true };
}
const raw = (node: Node, kind: "RawBlock" | "RawInline", expected: string) =>
  node.t === kind &&
  JSON.stringify(node.c) === JSON.stringify(["html", expected]);
/** Accept only the known Quarto image wrapper, never general raw HTML. */
export function executedImageShape(node: Node): AuthoredImageShape {
  if (node.t === "Figure") return originalImageShape(node);
  if (node.t === "Para" || node.t === "Plain") {
    const value = singleImage([node], true);
    if (value.captionHtml) return fail();
    return { ...value, captioned: false };
  }
  if (node.t !== "Div" || !Array.isArray(node.c) || node.c.length !== 2) {
    return fail();
  }
  const [attr, children] = node.c as [ImageAttr, Node[]];
  if (
    attr[0] || attr[2].length ||
    JSON.stringify([...attr[1]].sort()) !==
      JSON.stringify(["quarto-figure", "quarto-figure-center"])
  ) return fail();
  if (
    children.length !== 4 || !raw(children[0], "RawBlock", "<figure>") ||
    !raw(children[3], "RawBlock", "</figure>") || children[2].t !== "Plain"
  ) return fail();
  const value = singleImage([children[1]], true);
  if (value.captionHtml) return fail();
  const caption = children[2].c as Node[];
  if (
    !Array.isArray(caption) || caption.length < 3 ||
    !raw(caption[0], "RawInline", "<figcaption>") ||
    !raw(caption.at(-1)!, "RawInline", "</figcaption>")
  ) return fail();
  const captionHtml = renderInline(caption.slice(1, -1));
  if (!captionHtml) return fail();
  return { target: value.target, captionHtml, captioned: true };
}
export function assertImageShape(
  original: AuthoredImageShape,
  executed: AuthoredImageShape,
) {
  if (JSON.stringify(original) !== JSON.stringify(executed)) {
    throw new Error(
      "UNMAPPED_AUTHORED_IMAGE: executed image path or caption differs from the exact original source",
    );
  }
}
export function assertAuthoredSvgData(src: string) {
  if (!src.startsWith("data:image/svg+xml;base64,")) return;
  const svg = new TextDecoder().decode(
    Uint8Array.from(atob(src.split(",")[1]), (c) => c.charCodeAt(0)),
  );
  if (/<!DOCTYPE|<!ENTITY|<(?:script|foreignObject)\b|\bon\w+\s*=/i.test(svg)) {
    throw new Error(
      "UNSAFE_SVG: authored images must be self-contained and script-free",
    );
  }
  const css = [...svg.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map((
    match,
  ) => match[1]);
  css.push(
    ...[...svg.matchAll(/\bstyle\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)].map((
      match,
    ) => match[1] ?? match[2]),
  );
  for (const value of css) {
    const decoded = value.replace(
      /&#(?:x([0-9a-f]+)|([0-9]+));/gi,
      (_whole, hex: string, decimal: string) => {
        const point = parseInt(hex ?? decimal, hex ? 16 : 10);
        if (
          point > 0x10ffff || point === 0 || point >= 0xd800 && point <= 0xdfff
        ) {
          throw new Error(
            "UNSAFE_SVG: invalid XML character reference in style",
          );
        }
        return String.fromCodePoint(point);
      },
    ).replace(/\/\*[\s\S]*?\*\//g, "");
    if (/@|\\/.test(decoded)) {
      throw new Error(
        "UNSAFE_SVG: authored image styles cannot use at-rules or escaped dependency syntax",
      );
    }
    for (const match of decoded.matchAll(/url\(([^)]*)\)/gi)) {
      if (!/^\s*["']?#[^\s"']+["']?\s*$/.test(match[1])) {
        throw new Error(
          "UNSAFE_SVG: authored image styles must use only internal fragment references",
        );
      }
    }
  }
  for (const match of svg.matchAll(/\b(?:href|src)\s*=\s*["']([^"']*)["']/gi)) {
    if (
      !/^#[^\s]*$/.test(match[1]) &&
      !/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(match[1])
    ) {
      throw new Error(
        "UNSAFE_SVG: authored images cannot reference external or local companion resources",
      );
    }
  }
  for (const match of svg.matchAll(/url\(([^)]*)\)/gi)) {
    if (!/^\s*["']?#[^\s"']+["']?\s*$/.test(match[1])) {
      throw new Error(
        "UNSAFE_SVG: authored image styles must use only internal fragment references",
      );
    }
  }
}

/** Read only the source file, not a generated build file sharing its name. */
export async function authoredImageData(
  shape: AuthoredImageShape,
  sourceRoot: string,
) {
  if (/[?#]/.test(shape.target)) {
    throw new Error(
      "UNSUPPORTED_AUTHORED_IMAGE: image fragments/query semantics need a dedicated adapter",
    );
  }
  let file: string;
  try {
    file = decodeURIComponent(shape.target);
  } catch {
    throw new Error("INVALID_IMAGE_PATH: malformed escaped local path");
  }
  if (
    !file || isAbsolute(file) || /^[a-z][a-z0-9+.-]*:/i.test(file) ||
    /^[/\\]{2}/.test(file) || file.includes("\0")
  ) {
    throw new Error(
      "EXTERNAL_ASSET: authored image must use a relative local source asset",
    );
  }
  const data = await assetData(shape.target, [sourceRoot]);
  assertAuthoredSvgData(data);
  return data;
}

import type { SourceBlock, SourceDocument } from "../source/mod.ts";
import {
  originalAttributeTokens,
  originalPandocAttributes,
} from "../source/attributes.ts";
import { isNativeIdentity } from "../source/identity-id.ts";
export function imageNativeIdentities(
  source: SourceDocument,
  block: SourceBlock,
) {
  const parent = block.parentId
    ? source.blocks.find((candidate) => candidate.id === block.parentId)
    : undefined;
  const attributes = parent
    ? originalPandocAttributes(
      parent.raw.split(/\r?\n/)[0].replace(/^\s*:{3,}\s*\{/, "").replace(
        /\}\s*$/,
        "",
      ),
      originalAttributeTokens(
        parent.raw.split(/\r?\n/)[0].replace(/^\s*:{3,}\s*\{/, "").replace(
          /\}\s*$/,
          "",
        ),
      ),
    )
    : undefined;
  const caption = attributes?.[2].find(([name]) => name === "bento-element-id")
    ?.[1];
  const image = attributes?.[2].find(([name]) => name === "bento-image-id")
    ?.[1];
  if (caption !== undefined || image !== undefined) {
    if (
      !caption || !image || !isNativeIdentity(caption) ||
      !isNativeIdentity(image) || caption === image
    ) {
      throw new Error(
        "INVALID_IMAGE_BINDING: source image pair needs distinct exact caption and image IDs",
      );
    }
    return {
      imageId: image,
      captionId: caption,
      groupId: `${image}-figure`,
      attributes,
    };
  }
  const imageId = block.stable || parent?.stable
    ? block.id
    : `qb-image-${
      source.blocks.filter((candidate) => candidate.kind === "image").findIndex(
        (candidate) => candidate.id === block.id,
      ) + 1
    }`;
  return {
    imageId,
    captionId: `${imageId}-caption`,
    groupId: `${imageId}-figure`,
    attributes,
  };
}
