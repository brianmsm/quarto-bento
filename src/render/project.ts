import type { SourceDocument } from "../source/mod.ts";
import {
  NOTES_CODEC_VERSION,
  renderPlainNotes,
  sourceNotes,
} from "../source/notes.ts";
import { isAbsolute, relative, resolve } from "node:path";
import { renderInline as inline } from "./inline.ts";
import { mathToNativeHtml } from "./math.ts";
import {
  applyElementDesign,
  DesignError,
  parseDesignAttributes,
} from "./design.ts";
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
function displayFormula(content: Node[]): string | undefined {
  if (!content.some((node) => node.t === "Math")) return undefined;
  const math = content[0]?.c as [{ t: string }, string] | undefined;
  if (
    content.length !== 1 || content[0].t !== "Math" ||
    math?.[0]?.t !== "DisplayMath" || typeof math[1] !== "string"
  ) {
    throw new Error(
      "MIXED_MATH_TEXT: display equations need one standalone formula; inline/mixed math requires a separate supported projection",
    );
  }
  return math[1];
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
  // UNC and device paths must refuse before realPath can contact a share on Windows.
  if (/^[a-z][a-z0-9+.-]*:/i.test(src) || /^[/\\]{2}/.test(src)) {
    throw new Error("EXTERNAL_ASSET: local bundled image required");
  }
  for (const root of assetRoots) {
    try {
      const candidate = resolve(root, src);
      const lexical = relative(resolve(root), candidate);
      if (
        lexical === ".." || lexical.startsWith("../") ||
        lexical.startsWith("..\\") || isAbsolute(lexical)
      ) continue;
      const actual = await Deno.realPath(candidate);
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
  source?: SourceDocument,
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
  const result: Projection = {
    document,
    origins: {},
    diagnostics: [],
    design: {},
  };
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
  function math(id: string, tex: string, origin: Origin) {
    const html = mathToNativeHtml(tex);
    const height = Math.min(
      330,
      Math.max(110, (tex.trim().split("\n").length + 1) * 44),
    );
    text(id, html, false, origin);
    const element = slide!.elements.at(-1)!;
    element.h = height;
    element.fontSize = 32;
    element.align = "center";
    element.valign = "middle";
    y += height - 90;
  }
  function design(attr: Attr, elements: Element[]) {
    const declaration = parseDesignAttributes(attr);
    if (declaration.component) {
      throw new DesignError(
        "COMPONENT_INTEGRATION_PENDING",
        "Use a directly mapped single-object wrapper until component projection is integrated.",
      );
    }
    if (!Object.keys(declaration.properties).length) return;
    if (!declaration.sourceId || elements.length !== 1 || !slide) {
      throw new DesignError(
        "AMBIGUOUS_DESIGN_TARGET",
        "Explicit QMD fields need one object and a stable source #id.",
      );
    }
    const element = elements[0],
      applied = applyElementDesign(element, declaration);
    const fields = (result.design![slide.id] ??= {});
    const previous = fields[element.id] ?? { ownedPaths: [], bindings: {} };
    if (
      applied.ownedPaths.some((field) => previous.ownedPaths.includes(field))
    ) {
      throw new DesignError(
        "AMBIGUOUS_DESIGN_OWNERSHIP",
        "Several source declarations own the same visual field.",
      );
    }
    fields[element.id] = {
      ownedPaths: [...previous.ownedPaths, ...applied.ownedPaths],
      bindings: {
        ...previous.bindings,
        ...Object.fromEntries(
          Object.entries(applied.bindings).map((
            [field, attribute],
          ) => [field, { sourceId: declaration.sourceId, attribute }]),
        ),
      },
    };
    slide.elements[slide.elements.findIndex((e) => e.id === element.id)] =
      applied.element;
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
    let codeIndex = 0;
    let mathIndex = 0;
    let sourceMarker: string | undefined;
    for (const node of nodes) {
      if (!["Para", "Plain", "RawBlock", "CodeBlock"].includes(node.t)) {
        sourceMarker = undefined;
      }
      if (node.t === "Header") {
        const [level, attr, content] = node.c as [number, Attr, Node[]];
        if (level <= 2) {
          const id = attr[0] || `qb-slide-${document.slides.length + 1}`;
          startSlide(id);
          const nativeTitleId = attr[2].find(([name]) =>
            name === "bento-title-id"
          )?.[1];
          if (
            nativeTitleId !== undefined &&
            !/^[A-Za-z][\w:.-]*$/.test(nativeTitleId)
          ) {
            throw new Error(
              "INVALID_ID: bento-title-id must be a safe explicit identity",
            );
          }
          text(nativeTitleId ?? `${id}-title`, inline(content), true, {
            origin: computed ? "computed" : "authored",
            sourceId: id,
            ...(computed && parentId ? { producer: parentId } : {}),
          });
        } else {text(
            attr[0] || `${parentId || slide?.id}-heading-${++counter}`,
            inline(content),
            false,
            {
              origin: computed ? "computed" : "authored",
              sourceId: attr[0] || undefined,
              ...(computed && parentId ? { producer: parentId } : {}),
            },
          );}
        design(attr, [slide!.elements.at(-1)!]);
      } else if (node.t === "Div") {
        const [attr, children] = node.c as [Attr, Node[]];
        const beforeSlide = slide, beforeCount = slide?.elements.length ?? 0;
        // Quarto can remove ordinary cell labels. An exact, unique echoed
        // original code body is evidence for its producer, never for authorship.
        let sourceParent = attr[0] || parentId;
        if (!attr[0] && attr[1].includes("cell") && source) {
          const echoes = children.filter((child) =>
            child.t === "CodeBlock" &&
            (child.c as [Attr, string])[0][1].includes("cell-code")
          );
          if (echoes.length === 1) {
            const content = (echoes[0].c as [Attr, string])[1];
            const candidates = source.blocks.filter((block) =>
              block.kind === "chunk" &&
              block.content.replace(/\r\n|\r/g, "\n").split("\n").filter((
                  line,
                ) => !/^\s*#\|/.test(line)
                ).join("\n").replace(/\n$/, "") === content
            );
            if (candidates.length === 1) sourceParent = candidates[0].id;
            else {throw new Error(
                "UNMAPPED_PROVENANCE: echoed cell code does not identify one original producer",
              );}
          }
        }
        const isComputed = computed ||
          attr[1].some((c) => c === "cell" || c.startsWith("cell-output"));
        const nativeId = attr[2].find(([name]) => name === "bento-element-id")
          ?.[1];
        if (nativeId !== undefined) {
          if (attr[1].includes("notes")) {
            throw new Error(
              "UNSUPPORTED_NOTES: native element bindings do not apply to slide notes",
            );
          }
          if (!/^[A-Za-z][\w:.-]*$/.test(nativeId) || !attr[0]) {
            throw new Error(
              "INVALID_ID: bento-element-id needs safe visual and explicit source identities",
            );
          }
          if (
            isComputed || children.length !== 1 ||
            !["Para", "Plain"].includes(children[0].t) ||
            images(children).length
          ) {
            throw new Error(
              "AMBIGUOUS_VISUAL_BINDING: bento-element-id requires exactly one authored text paragraph",
            );
          }
          const content = children[0].c as Node[];
          const formula = displayFormula(content);
          if (formula !== undefined) {
            math(nativeId, formula, {
              origin: "authored",
              sourceId: `${attr[0]}/math:1`,
            });
          } else {text(nativeId, inline(content), false, {
              origin: "authored",
              sourceId: `${attr[0]}/paragraph:1`,
            });}
        } else if (attr[1].includes("notes")) {
          if (isComputed) {
            throw new Error(
              "COMPUTED_NOTES_UNSUPPORTED: generated speaker notes need explicit computed slide-property provenance; refusing authored classification",
            );
          }
          const original = source && slide && attr[0]
            ? sourceNotes(source, attr[0], slide.id)
            : undefined;
          const plain = renderPlainNotes(children);
          if (
            !slide || !attr[0] || attr[1].length !== 1 || attr[2].length ||
            parentId
          ) {
            throw new Error(
              "UNMAPPED_NOTES: use a single top-level identified .notes div under an explicit slide",
            );
          }
          if (result.notes?.[slide.id]) {
            throw new Error("AMBIGUOUS_NOTES: use one notes block per slide");
          }
          if (original) {
            if (original.text !== plain) {
              throw new Error(
                "UNSUPPORTED_NOTES: executed notes differ from literal original plain text; transformations and computed content need an explicit adapter",
              );
            }
          }
          slide.notes = plain;
          (result.notes ??= {})[slide.id] = {
            sourceId: attr[0],
            codec: NOTES_CODEC_VERSION,
          };
        } else if (
          attr[1].includes("quarto-float") && images(children).length
        ) {
          for (const img of images(children)) {
            await figure(img, isComputed, attr[0]);
          }
        } else await walk(children, isComputed, sourceParent);
        design(
          attr,
          slide && (!beforeSlide || slide === beforeSlide)
            ? slide.elements.slice(beforeCount)
            : [],
        );
      } else if (node.t === "Para" || node.t === "Plain") {
        const content = node.c as Node[];
        const imgs = images(content);
        const formula = displayFormula(content);
        if (formula !== undefined) {
          mathIndex++;
          const sourceId = sourceMarker ??
            (parentId ? `${parentId}/math:${mathIndex}` : undefined);
          sourceMarker = undefined;
          math(sourceId ?? `qb-math-${++counter}`, formula, {
            origin: computed ? "computed" : "authored",
            ...(sourceId ? { sourceId } : {}),
            ...(computed && parentId ? { producer: parentId } : {}),
          });
        } else if (imgs.length) {
          if (content.some((n) => n.t !== "Image" && n.t !== "Space")) {
            throw new Error("MIXED_IMAGE_TEXT: split figure and paragraph");
          }
          for (const img of imgs) await figure(img, computed, parentId);
        } else {
          const id = sourceMarker ??
            (parentId
              ? `${parentId}/paragraph:${++paragraphIndex}`
              : `qb-paragraph-${++counter}`);
          const explicitMarker = sourceMarker;
          sourceMarker = undefined;
          text(id, inline(content), false, {
            origin: computed ? "computed" : "authored",
            sourceId: explicitMarker ?? (parentId ? id : undefined),
            ...(computed && parentId ? { producer: parentId } : {}),
          });
        }
      } else if (node.t === "CodeBlock") {
        const [attr, content] = node.c as [Attr, string];
        const sourceId = attr[0] || sourceMarker ||
          (parentId ? `${parentId}/code:${++codeIndex}` : undefined);
        sourceMarker = undefined;
        const languages = attr[1].filter((name) =>
          !["sourceCode", "cell-code"].includes(name)
        );
        if (languages.length > 1) {
          throw new Error(
            "UNSUPPORTED_CODE_CLASSES: displayed code supports one language class plus native visual attributes",
          );
        }
        const height = Math.min(
          470,
          Math.max(90, (content.split("\n").length + 1) * 30),
        );
        const element: Element = {
          id: sourceId ?? `qb-code-${++counter}`,
          type: "code",
          content,
          x: 80,
          y,
          w: 1120,
          h: height,
          rotation: 0,
          opacity: 1,
          fontSize: 24,
          fontFamily: "ui-monospace, monospace",
          color: "#172a35",
          align: "left",
          valign: "top",
          lineHeight: 1.25,
          ...(languages[0] ? { grammarName: languages[0] } : {}),
        };
        add(element, {
          origin: computed ? "computed" : "authored",
          ...(sourceId ? { sourceId } : {}),
          ...(computed && parentId ? { producer: parentId } : {}),
        });
        design(attr, [element]);
        y += height + 20;
      } else if (node.t === "RawBlock") {
        const [format, raw] = node.c as [string, string];
        const marker = format === "html"
          ? raw.match(/^\s*<!--\s*qb:([A-Za-z][\w:.-]*)\s*-->\s*$/)
          : null;
        sourceMarker = marker?.[1];
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

/** Execution modes that erase source/output boundaries cannot be reverse-mapped. */
export function assertSupportedExecutionSource(source: SourceDocument): void {
  for (const block of source.blocks.filter((b) => b.kind === "chunk")) {
    if (
      /(?:#\|\s*results\s*:\s*|results\s*=\s*)["']?asis\b|\b(?:knitr::)?asis_output\s*\(/i
        .test(block.raw)
    ) {
      throw new Error(
        `UNMAPPED_PROVENANCE: chunk ${block.id} uses as-is output, which can erase execution-origin boundaries; use a supported wrapped output or preserve it outside editable projection`,
      );
    }
  }
}
/** Bind executed projection to exact original blocks; never guess unknown output is authored. */
export function validateProjectionOrigins(
  source: SourceDocument,
  projection: Projection,
): Projection {
  assertSupportedExecutionSource(source);
  if (source.diagnostics.length) {
    throw new Error(
      "UNMAPPED_PROVENANCE: resolve original source identity/structure diagnostics first",
    );
  }
  const origins: Projection["origins"] = {};
  const used = new Set<string>();
  for (const [slideId, entries] of Object.entries(projection.origins)) {
    origins[slideId] = {};
    const slide = projection.document.slides.find((s) => s.id === slideId);
    for (const [elementId, original] of Object.entries(entries)) {
      const element = slide?.elements.find((e) => e.id === elementId);
      if (!element) {
        throw new Error(
          "UNMAPPED_PROVENANCE: source origin has no projected element",
        );
      }
      let candidates = original.sourceId
        ? source.blocks.filter((b) => b.id === original.sourceId)
        : [];
      if (original.origin === "computed") {
        const producer = original.producer ??
          (candidates[0]?.kind === "chunk" ? candidates[0].id : undefined);
        if (
          !producer ||
          !source.blocks.some((b) => b.id === producer && b.kind === "chunk")
        ) {
          throw new Error(
            `UNMAPPED_PROVENANCE: computed element ${elementId} has no verified original producer`,
          );
        }
        origins[slideId][elementId] = { ...original, producer };
        continue;
      }
      if (
        !candidates.length && element.type === "text" &&
        typeof element.html === "string"
      ) {
        // Only literal, unique unlabelled original text can establish this binding.
        // Exact HTML/string equality deliberately rejects transformed Markdown.
        const kind = original.sourceId ? "heading" : "paragraph";
        candidates = source.blocks.filter((b) =>
          b.kind === kind && b.origin === "authored" && !b.stable &&
          !b.parentId && b.content === element.html
        );
      }
      if (
        !candidates.length && !original.sourceId && element.type === "text" &&
        typeof element.html === "string" && element.html.startsWith("$$")
      ) {
        candidates = source.blocks.filter((block) =>
          block.kind === "math" && block.origin === "authored" &&
          mathToNativeHtml(block.content) === element.html
        );
      }
      if (candidates.length !== 1) {
        throw new Error(
          `UNMAPPED_PROVENANCE: element ${elementId} is not uniquely linked to original source; explicitly pin authored identity or use a supported computed output`,
        );
      }
      const block = candidates[0];
      if (used.has(block.id)) {
        throw new Error(
          `UNMAPPED_PROVENANCE: multiple executed objects claim authored source block ${block.id}`,
        );
      }
      if (block.kind === "unsupported" || block.kind === "div") {
        throw new Error(
          `UNMAPPED_PROVENANCE: element ${elementId} points to an unsupported source container`,
        );
      }
      if (
        element.type === "text" && typeof element.html === "string" &&
        element.html.startsWith("$$") && block.kind !== "math"
      ) {
        throw new Error(
          "UNMAPPED_PROVENANCE: a display formula needs a separately mapped original math block",
        );
      }
      if (
        block.kind === "math" &&
        (element.type !== "text" || typeof element.html !== "string" ||
          mathToNativeHtml(block.content) !== element.html)
      ) {
        throw new Error(
          "UNMAPPED_PROVENANCE: executed math differs from the exact authored source formula",
        );
      }
      used.add(block.id);
      origins[slideId][elementId] = {
        ...original,
        sourceId: block.id,
        origin: block.origin,
      };
    }
  }
  for (const [slideId, binding] of Object.entries(projection.notes ?? {})) {
    const original = sourceNotes(source, binding.sourceId, slideId);
    const slide = projection.document.slides.find((s) => s.id === slideId);
    if (
      binding.codec !== NOTES_CODEC_VERSION || slide?.notes !== original.text
    ) {
      throw new Error(
        "UNMAPPED_NOTES: speaker notes lack verified original plain-text provenance",
      );
    }
  }
  return { ...projection, origins };
}
