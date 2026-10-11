import { isAbsolute, relative, resolve } from "node:path";
import { escapeHtml } from "./html.ts";
import type {
  Ast,
  BentoDoc,
  Element,
  Node,
  Origin,
  Projection,
  Slide,
} from "./types.ts";
type Attr = [string, string[], [string, string][]];
function inline(nodes: Node[]): string {
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
        return `<b>${inline(node.c as Node[])}</b>`;
      case "Emph":
        return `<i>${inline(node.c as Node[])}</i>`;
      case "Underline":
        return `<u>${inline(node.c as Node[])}</u>`;
      case "Strikeout":
        return `<span style="text-decoration:line-through">${
          inline(node.c as Node[])
        }</span>`;
      case "Code":
        return escapeHtml((node.c as [Attr, string])[1]);
      case "Span":
        return inline((node.c as [Attr, Node[]])[1]);
      case "Link":
        return inline((node.c as [Attr, Node[], unknown])[1]);
      default:
        throw new Error(
          `UNSUPPORTED_INLINE: ${node.t}; no faithful projection implemented`,
        );
    }
  }).join("");
}
function images(nodes: Node[]): Node[] {
  const result: Node[] = [];
  const walk = (value: unknown) => {
    if (Array.isArray(value)) value.forEach(walk);
    else if (value && typeof value === "object") {
      const n = value as Node;
      if (n.t === "Image") result.push(n);
      else if ("c" in n) walk(n.c);
    }
  };
  walk(nodes);
  return result;
}
async function assetData(src: string, assetRoots: string[]): Promise<string> {
  if (/^[a-z][a-z0-9+.-]*:/i.test(src) || src.startsWith("//")) {
    throw new Error("EXTERNAL_ASSET: local bundled image required");
  }
  for (const root of assetRoots) {
    try {
      const actual = await Deno.realPath(resolve(root, src));
      const rel = relative(await Deno.realPath(root), actual);
      if (
        rel === ".." || rel.startsWith("../") || rel.startsWith("..\\") ||
        isAbsolute(rel)
      ) continue;
      const bytes = await Deno.readFile(actual);
      const extension = actual.split(".").pop()?.toLowerCase();
      const mime = ({
        svg: "image/svg+xml",
        png: "image/png",
        jpg: "image/jpeg",
        jpeg: "image/jpeg",
        webp: "image/webp",
      } as Record<string, string>)[extension || ""];
      if (!mime) {
        throw new Error("UNSUPPORTED_ASSET: image format is not supported");
      }
      if (extension === "svg") {
        const text = new TextDecoder().decode(bytes);
        if (
          /<(?:script|foreignObject)\b|\bon\w+\s*=|(?:href|src)\s*=\s*["']\s*(?:https?:|\/\/|javascript:)|<!ENTITY/i
            .test(text)
        ) {
          throw new Error(
            "UNSAFE_SVG: scripts, external references and entities are not supported",
          );
        }
      }
      let binary = "";
      for (const byte of bytes) binary += String.fromCharCode(byte);
      return `data:${mime};base64,${btoa(binary)}`;
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) throw error;
    }
  }
  throw new Error(
    `MISSING_ASSET: ${src} is not within the source/build directory`,
  );
}
export async function projectAst(
  ast: Ast,
  docId: string,
  assetRoots: string[],
): Promise<Projection> {
  const document: BentoDoc = {
    format: "bento/slides",
    version: 1,
    docId,
    title: ast.meta.title?.t === "MetaInlines"
      ? inline(ast.meta.title.c as Node[]).replace(/<[^>]+>/g, "")
      : "Untitled",
    size: { width: 1280, height: 720 },
    theme: {
      background: "#ffffff",
      color: "#172a35",
      accent: "#156f65",
      fontFamily: "Arial, sans-serif",
    },
    slides: [],
  };
  const result: Projection = { document, origins: {}, diagnostics: [] };
  let slide: Slide | undefined;
  let y = 166;
  let counter = 0;
  function startSlide(id: string): Slide {
    if (document.slides.some((s) => s.id === id)) {
      throw new Error(`DUPLICATE_ID: ${id}`);
    }
    slide = {
      id,
      background: "#ffffff",
      transition: "fade",
      notes: "",
      elements: [],
    };
    document.slides.push(slide);
    result.origins[id] = {};
    y = 166;
    counter = 0;
    return slide;
  }
  function add(el: Element, origin: Origin) {
    if (!slide) startSlide("qb-introduction");
    if (slide!.elements.some((item) => item.id === el.id)) {
      throw new Error(`DUPLICATE_ID: ${el.id}`);
    }
    slide!.elements.push(el);
    result.origins[slide!.id][el.id] = origin;
  }
  function text(id: string, html: string, heading: boolean, origin: Origin) {
    const h = heading ? 90 : 90;
    add({
      id,
      type: "text",
      x: 80,
      y: heading ? 52 : y,
      w: 1120,
      h,
      rotation: 0,
      opacity: 1,
      html,
      fontSize: heading ? 42 : 26,
      fontFamily: "Arial, sans-serif",
      fontWeight: heading ? 700 : 400,
      color: "#172a35",
      align: "left",
      valign: "top",
      lineHeight: 1.25,
    }, origin);
    if (!heading) y += h + 20;
  }
  async function figure(node: Node, computed: boolean, parentId?: string) {
    const [attr, , target] = node.c as [Attr, Node[], [string, string]];
    const id = attr[0] || parentId || `qb-image-${++counter}`;
    add({
      id,
      type: "image",
      x: 160,
      y,
      w: 880,
      h: Math.min(400, 670 - y),
      rotation: 0,
      opacity: 1,
      src: await assetData(target[0], assetRoots),
      fit: "contain",
    }, {
      origin: computed ? "computed" : "authored",
      sourceId: id,
      ...(computed ? { producer: id } : {}),
    });
    y += 420;
  }
  async function walk(nodes: Node[], computed = false, parentId?: string) {
    let paragraphIndex = 0;
    for (const node of nodes) {
      if (node.t === "Header") {
        const [level, attr, content] = node.c as [number, Attr, Node[]];
        if (level <= 2) {
          const id = attr[0] || `qb-slide-${document.slides.length + 1}`;
          startSlide(id);
          text(`${id}-title`, inline(content), true, {
            origin: "authored",
            sourceId: id,
          });
        } else {text(
            attr[0] || `${parentId || slide?.id}-heading-${++counter}`,
            inline(content),
            false,
            {
              origin: computed ? "computed" : "authored",
              sourceId: attr[0] || undefined,
            },
          );}
      } else if (node.t === "Div") {
        const [attr, children] = node.c as [Attr, Node[]];
        const isComputed = computed ||
          attr[1].some((c) => c === "cell" || c.startsWith("cell-output"));
        if (attr[1].includes("notes")) {
          if (!slide) startSlide("qb-introduction");
          slide!.notes = children.filter((n) => n.t === "Para").map((n) =>
            inline(n.c as Node[])
          ).join("\n");
        } else if (
          attr[1].includes("quarto-float") && images(children).length
        ) {
          for (const img of images(children)) {
            await figure(img, isComputed, attr[0]);
          }
        } else await walk(children, isComputed, attr[0] || parentId);
      } else if (node.t === "Para" || node.t === "Plain") {
        const content = node.c as Node[];
        const imgs = images(content);
        if (imgs.length) {
          if (content.some((n) => n.t !== "Image" && n.t !== "Space")) {
            throw new Error("MIXED_IMAGE_TEXT: split figure and paragraph");
          }
          for (const img of imgs) await figure(img, computed, parentId);
        } else {
          const id = parentId
            ? `${parentId}/paragraph:${++paragraphIndex}`
            : `qb-paragraph-${++counter}`;
          text(id, inline(content), false, {
            origin: computed ? "computed" : "authored",
            sourceId: parentId ? id : undefined,
          });
        }
      } else if (node.t === "RawBlock") {
        const [format, raw] = node.c as [string, string];
        if (
          format !== "html" ||
          !/^\s*(?:<\/?(?:div|section|figure|figcaption)[^>]*>\s*|<!--[\s\S]*?-->\s*)*$/
            .test(raw)
        ) {
          throw new Error(
            "UNSUPPORTED_RAW: raw output needs a faithful, isolated fallback",
          );
        }
      } else {throw new Error(
          `UNSUPPORTED_BLOCK: ${node.t}; no faithful projection implemented`,
        );}
    }
  }
  await walk(ast.blocks);
  if (!document.slides.length) {
    throw new Error("EMPTY_DECK: source contains no supported content");
  }
  for (const s of document.slides) {
    for (const el of s.elements) {
      if (Number(el.y) + Number(el.h) > 720 || Number(el.h) <= 0) {
        result.diagnostics.push({
          code: "OVERFLOW",
          message: `Element exceeds slide ${s.id}`,
          elementId: el.id,
        });
      }
    }
  }
  return result;
}
