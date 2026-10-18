import {
  assertReusableDesignSource,
  namedStyle,
  originalThemeAttributes,
  recoverThemeAttributes,
  roleStyle,
  textProperties,
  variantDecorations,
  variantFor,
} from "./theme-styles.ts";
import {
  assertImageShape,
  authoredImageData,
  executedImageShape,
  imageNativeIdentities,
} from "./images.ts";
import { readSourceInline } from "./source-inline.ts";
import { hashSource } from "../source/mod.ts";
import { producerOutputChildren, producerReceipt } from "./producer-capture.ts";
import { type KpiAppearance, projectKpi } from "./kpi.ts";
import { kpiSource, kpiSourceAttributes } from "../source/kpi.ts";
import { refreshOverflowDiagnostics } from "./diagnostics.ts";
import { projectGraph, validateGraphOrigin } from "./graphs.ts";
import { sourceGraphs } from "../source/graphs.ts";
import {
  collectRichTableCandidates,
  type RichTableSnapshot,
} from "../rich/table.ts";
import { richTableElement, verifyRichTableSnapshot } from "../rich/project.ts";
import { collectPlotlyCandidates } from "../widgets/plotly.ts";
import {
  assertCompatibleComponentSource,
  projectComponent,
  sourceComponentClass,
} from "./components.ts";
import type { SourceDocument } from "../source/mod.ts";
import { isNativeIdentity, isSourceIdentity } from "../source/identity-id.ts";
import type { SourceInlineProof } from "./source-inline.ts";
import {
  NOTES_CODEC_VERSION,
  renderPlainNotes,
  sourceNotes,
} from "../source/notes.ts";
import { projectTable } from "./table.ts";
import { executedChartTable, projectChart } from "./chart.ts";
import {
  chartSource,
  chartSourceAttributes,
  isSourceChart,
  validateAuthoredChart,
} from "../source/chart.ts";
import {
  authoredTableBlock,
  literalTableBlocks,
  matchBareTable,
  tableNativeIdentity,
  tableProducer,
  validateAuthoredTable,
} from "../source/table.ts";
import { assetData } from "./assets.ts";
import { renderInline as inline } from "./inline.ts";
import { renderList } from "./lists.ts";
import { mathToNativeHtml } from "./math.ts";
import {
  applyElementDesign,
  componentFrames,
  type DesignDefaults,
  DesignError,
  designTheme,
  type Frame,
  parseDesignAttributes,
  type ReusableStyle,
  type SlideVariant,
} from "./design.ts";
import type {
  Ast,
  BentoDoc,
  Element,
  Json,
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
export interface WidgetProjection {
  element: Element;
  origin: Origin;
  slideId: string;
  outputHash: string;
}
export async function projectAst(
  ast: Ast,
  docId: string,
  assetRoots: string[],
  source?: SourceDocument,
  widgets: ReadonlyMap<string, WidgetProjection> = new Map(),
  defaults: DesignDefaults = {},
  richTables: ReadonlyMap<string, RichTableSnapshot> = new Map(),
  retainedFrames: ReadonlyMap<string, Frame> = new Map(),
  kpiAppearances: ReadonlyMap<string, KpiAppearance> = new Map(),
  inlineProofs?: ReadonlyMap<string, SourceInlineProof>,
  authoredImageRoot = assetRoots.at(-1),
): Promise<Projection> {
  const expectedRichTables = new Map(
    source
      ? collectRichTableCandidates(ast, source).map(
        (candidate) => [candidate.source.sourceId, candidate],
      )
      : [],
  );
  if (expectedRichTables.size !== richTables.size) {
    throw new Error(
      "RICH_TABLE_PROJECTION_MISMATCH: every executed rich table needs exactly one fresh verified capture",
    );
  }
  for (const [id, snapshot] of richTables) {
    const expected = expectedRichTables.get(id);
    if (!expected) {
      throw new Error(
        "RICH_TABLE_PROJECTION_MISMATCH: unexpected capture identity",
      );
    }
    await verifyRichTableSnapshot(expected, snapshot);
  }
  const imageProofs = inlineProofs ??
    (source ? await readSourceInline(source, authoredImageRoot) : new Map());
  const consumedImages = new Set<string>();
  const consumedRichTables = new Set<string>();
  const theme = designTheme(defaults);
  if (source) assertReusableDesignSource(source, defaults);
  const reusableTheme = defaults.theme;
  const consumedWidgets = new Set<string>();
  const expectedWidgets = new Map(
    widgets.size && source
      ? collectPlotlyCandidates(ast, source).map((c) => [c.source.sourceId, c])
      : [],
  );
  for (const [id, widget] of widgets) {
    if (
      !expectedWidgets.has(id) ||
      expectedWidgets.get(id)!.source.outputHash !== widget.outputHash
    ) {
      throw new Error(
        "WIDGET_PROJECTION_MISMATCH: widget does not match the checked executed AST",
      );
    }
  }
  const document: BentoDoc = {
    format: "bento/slides",
    version: 1,
    docId,
    title: ast.meta.title?.t === "MetaInlines"
      ? inline(ast.meta.title.c as Node[]).replace(/<[^>]+>/g, "")
      : "Untitled",
    size: { width: 1280, height: 720 },
    theme,
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
  let contentFrame: Frame | undefined;
  let slideContentFrame: Frame | undefined;
  let slideVariant: SlideVariant | undefined;
  let inheritedTextStyle: ReusableStyle = {};
  let inheritedCodeStyle: ReusableStyle = {};
  let inheritedCardTextStyle: ReusableStyle = {};
  let inheritedCardCodeStyle: ReusableStyle = {};
  const remainingFrame = () =>
    contentFrame ??
      (slideContentFrame
        ? {
          ...slideContentFrame,
          y,
          h: Math.max(.01, slideContentFrame.y + slideContentFrame.h - y),
        }
        : undefined);
  const selectedStyle = (
    attr: Attr,
    target: "text" | "code" | "card",
  ): ReusableStyle => {
    const declaration = parseDesignAttributes(attr);
    return declaration.style
      ? namedStyle(reusableTheme, declaration.style, target).properties
      : {};
  };
  const tableSources = new Set<string>();
  const expectedCharts = new Set<string>();
  const consumedCharts = new Set<string>();
  const chartAncestors = new Map<string, { attr: Attr; parentId?: string }>();
  const kpiAncestors = new Map<string, { attr: Attr; parentId?: string }>();
  if (source) {
    for (const block of source.blocks) {
      if (
        block.kind === "div" &&
        isSourceChart(block)
      ) {
        expectedCharts.add(block.id);
        for (const id of chartSource(source, block.id).ancestors) {
          const ancestor = source.blocks.find((candidate) =>
            candidate.id === id
          )!;
          chartAncestors.set(id, {
            attr: chartSourceAttributes(ancestor),
            parentId: ancestor.parentId,
          });
        }
      }
      if (
        block.kind !== "div" || sourceComponentClass(block.raw) !== ".bento-kpi"
      ) continue;
      for (const id of kpiSource(source, block.id).ancestors) {
        const ancestor = source.blocks.find((candidate) =>
          candidate.id === id
        )!;
        kpiAncestors.set(id, {
          attr: kpiSourceAttributes(ancestor),
          parentId: ancestor.parentId,
        });
      }
    }
  }
  const measuredComponents = {
    fixed: new Set<string>(),
    omitted: new Set<string>(),
  };
  // A producer may emit code through several transparent execution wrappers.
  // Count across those wrappers while keeping different slides/producers apart.
  const computedCodeIndexes = new Map<string, number>();
  // Only the authenticated execution boundary may admit a weak table producer.
  let verifiedTableProducer: string | undefined;
  function startSlide(
    id: string,
    selectedVariant = reusableTheme?.defaultVariant,
  ): Slide {
    if (document.slides.some((s) => s.id === id)) {
      throw new Error(`DUPLICATE_ID: ${id}`);
    }
    // A slide never inherits a preceding section's template or component frame.
    contentFrame = undefined;
    inheritedTextStyle = {};
    inheritedCodeStyle = {};
    inheritedCardTextStyle = {};
    inheritedCardCodeStyle = {};
    slideVariant = variantFor(reusableTheme, selectedVariant);
    slideContentFrame = slideVariant?.contentFrame;
    slide = {
      id,
      background: slideVariant?.background ?? theme.background,
      transition: "fade",
      notes: "",
      elements: [],
    };
    document.slides.push(slide);
    result.origins[id] = {};
    y = slideContentFrame?.y ?? 166;
    counter = 0;
    for (
      const element of variantDecorations(
        id,
        selectedVariant ?? "",
        slideVariant ?? {},
      )
    ) {
      add(element, { origin: "authored", sourceId: id, designOnly: true });
    }
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
  function text(
    id: string,
    html: string,
    heading: boolean,
    origin: Origin,
    role: "title" | "heading" | "body" = heading ? "title" : "body",
    specific: ReusableStyle = {},
  ) {
    // A list is one editable object, but its default box needs room for its
    // item/paragraph lines. This is conservative initial layout, not font-ink
    // measurement; explicit layout frames and saved geometry retain authority.
    const listLines = /^<(ul|ol)>/.test(html)
      ? html.replace(/<\/(?:li|p)>|<br>/g, "\n").replace(/<[^>]*>/g, "")
        .split("\n").filter((line) => line.trim())
        .reduce(
          (sum, line) => sum + Math.max(1, Math.ceil(line.length / 55)),
          0,
        )
      : 0;
    const h = contentFrame && !heading
      ? contentFrame.h
      : Math.max(90, listLines * 40 + 20);
    const frame = heading
      ? slideVariant?.titleFrame
      : contentFrame ?? slideContentFrame;
    add({
      id,
      type: "text",
      x: frame?.x ?? 80,
      y: heading ? frame?.y ?? 52 : y,
      w: frame?.w ?? 1120,
      h: heading ? frame?.h ?? h : h,
      rotation: 0,
      opacity: 1,
      html,
      fontSize: heading ? 42 : 26,
      fontFamily: theme.fontFamily,
      fontWeight: heading ? 700 : 400,
      color: theme.color,
      align: "left",
      valign: "top",
      lineHeight: 1.25,
      ...inheritedCardTextStyle,
      ...roleStyle(reusableTheme, role),
      ...inheritedTextStyle,
      ...(heading ? slideVariant?.title : {}),
      ...specific,
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
    if (declaration.component === "code") {
      if (elements.length !== 1 || elements[0].type !== "code") {
        throw new DesignError(
          "CODE_COMPONENT_CONTENT",
          "A .bento-code component needs exactly one displayed code fence.",
        );
      }
      delete declaration.component;
    } else if (declaration.component) {
      throw new DesignError(
        "COMPONENT_TARGET",
        "Card/layout components belong to fenced divs.",
      );
    }
    if (declaration.style) {
      if (
        !declaration.sourceId || elements.length !== 1 ||
        !["text", "code"].includes(elements[0].type)
      ) {
        throw new DesignError(
          "STYLE_TARGET_MISMATCH",
          "Named text/code styles require exactly one compatible native object.",
        );
      }
      namedStyle(
        reusableTheme,
        declaration.style,
        elements[0].type as "text" | "code",
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
  async function authoredFigure(node: Node, parentId?: string, outer?: Attr) {
    if (!source || !authoredImageRoot || !slide) {
      throw new Error(
        "UNMAPPED_AUTHORED_IMAGE: original source and source asset directory are required",
      );
    }
    const block = source.blocks.find((candidate) =>
      candidate.kind === "image" && candidate.origin === "authored" &&
      candidate.parentId === parentId && !consumedImages.has(candidate.id)
    );
    const proof = block && imageProofs.get(block.id);
    if (!block || !proof?.image?.data || proof.sourceHash !== source.hash) {
      throw new Error(
        "UNMAPPED_AUTHORED_IMAGE: image lacks its original independent source/asset proof",
      );
    }
    const shape = executedImageShape(node);
    assertImageShape({
      target: proof.image.target,
      captionHtml: proof.image.captionHtml,
      captioned: proof.image.captioned,
    }, shape);
    const ids = imageNativeIdentities(source, block);
    if (
      outer &&
      (!ids.attributes ||
        JSON.stringify(outer) !== JSON.stringify(ids.attributes))
    ) {
      throw new Error(
        "UNMAPPED_AUTHORED_IMAGE: executed image binding or ancestry differs from original source",
      );
    }
    const data = await authoredImageData(proof.image, authoredImageRoot);
    if (data !== proof.image.data) {
      throw new Error(
        "AUTHORED_IMAGE_ASSET_CHANGED: source asset changed during execution; preserve the project and render from a stable source asset",
      );
    }
    const shared = {
      target: shape.target,
      assetDigest: hashSource(data),
      imageId: ids.imageId,
      captionId: ids.captionId,
    };
    const imageFrame = remainingFrame();
    const imageHeight = imageFrame
      ? Math.max(100, imageFrame.h - 90)
      : Math.max(100, Math.min(400, 570 - y));
    const x = imageFrame?.x ?? 160, w = imageFrame?.w ?? 880;
    add({
      id: ids.imageId,
      type: "image",
      x,
      y,
      w,
      h: imageHeight,
      rotation: 0,
      opacity: 1,
      src: data,
      fit: "contain",
      groupId: ids.groupId,
    }, {
      origin: "authored",
      sourceId: block.id,
      image: { ...shared, role: "asset" },
    });
    add({
      id: ids.captionId,
      type: "text",
      x,
      y: y + imageHeight + 10,
      w,
      h: 80,
      rotation: 0,
      opacity: 1,
      html: shape.captionHtml,
      fontSize: 20,
      fontFamily: theme.fontFamily,
      fontWeight: 400,
      color: theme.color,
      align: "center",
      valign: "top",
      lineHeight: 1.25,
      groupId: ids.groupId,
    }, {
      origin: "authored",
      sourceId: block.id,
      image: { ...shared, role: "caption" },
    });
    consumedImages.add(block.id);
    y += imageHeight + 110;
  }
  async function figure(
    node: Node,
    computed: boolean,
    parentId?: string,
    producerId = parentId,
  ) {
    const [attr, , target] = node.c as [Attr, Node[], [string, string]];
    const id = attr[0] || parentId || `qb-image-${++counter}`;
    add({
      id,
      type: "image",
      x: remainingFrame()?.x ?? 160,
      y,
      w: remainingFrame()?.w ?? 880,
      h: remainingFrame()?.h ?? Math.max(100, Math.min(400, 670 - y)),
      rotation: 0,
      opacity: 1,
      src: await assetData(target[0], assetRoots),
      fit: "contain",
    }, {
      origin: computed ? "computed" : "authored",
      sourceId: id,
      ...(computed ? { producer: producerId ?? id } : {}),
    });
    y += 420;
  }
  async function walk(
    nodes: Node[],
    computed = false,
    parentId?: string,
    inComponent = false,
    groups?: Element[][],
    frames?: Frame[],
  ) {
    let headingIndex = 0;
    let paragraphIndex = 0, listIndex = 0;
    let codeIndex = 0;
    let mathIndex = 0;
    let sourceMarker: string | undefined;
    let slot = 0;
    for (const node of nodes) {
      const previousFrame = contentFrame;
      if (frames && node.t !== "RawBlock") contentFrame = frames[slot++];
      const groupSlide = slide, groupStart = slide?.elements.length ?? 0;
      // Child subtrees are measured independently before the component places them.
      if (groups) y = contentFrame?.y ?? 166;
      if (
        ![
          "Para",
          "Plain",
          "RawBlock",
          "CodeBlock",
          "BulletList",
          "OrderedList",
          "Table",
        ]
          .includes(node.t)
      ) {
        sourceMarker = undefined;
      }
      if (node.t === "Header") {
        const [level, rawAttr, content] = node.c as [number, Attr, Node[]];
        const attr = recoverThemeAttributes(
          rawAttr,
          "heading",
          source,
          computed,
        );
        const headerDesign = parseDesignAttributes(attr);
        if (
          headerDesign.variant &&
          (level !== 2 || inComponent || computed || parentId)
        ) {
          throw new DesignError(
            "VARIANT_TARGET_MISMATCH",
            "bento-variant belongs to an original top-level level-2 slide heading.",
          );
        }
        if (level <= 2 && !inComponent) {
          const id = attr[0] || `qb-slide-${document.slides.length + 1}`;
          startSlide(id, headerDesign.variant ?? reusableTheme?.defaultVariant);
          const nativeTitleId = attr[2].find(([name]) =>
            name === "bento-title-id"
          )?.[1];
          if (
            nativeTitleId !== undefined &&
            !isNativeIdentity(nativeTitleId)
          ) {
            throw new Error(
              "INVALID_ID: bento-title-id must be a safe explicit identity",
            );
          }
          text(
            nativeTitleId ?? `${id}-title`,
            inline(content),
            true,
            {
              origin: computed ? "computed" : "authored",
              sourceId: id,
              ...(computed && parentId ? { producer: parentId } : {}),
            },
            "title",
            selectedStyle(attr, "text"),
          );
        } else {
          headingIndex++;
          const mapped = inComponent && source && parentId
            ? source.blocks.filter((b) =>
              b.parentId === parentId && b.kind === "heading"
            )[headingIndex - 1]
            : undefined;
          const sourceId = mapped?.id ?? (attr[0] || undefined);
          text(
            sourceId || `${parentId || slide?.id}-heading-${++counter}`,
            inline(content),
            false,
            {
              origin: computed ? "computed" : "authored",
              sourceId,
              ...(computed && parentId ? { producer: parentId } : {}),
            },
            "heading",
            {
              fontSize: inComponent ? 32 : 26,
              fontWeight: inComponent ? 700 : 400,
              ...roleStyle(reusableTheme, "heading"),
              ...selectedStyle(attr, "text"),
            },
          );
        }
        design(attr, [slide!.elements.at(-1)!]);
      } else if (node.t === "Figure" && source && !computed) {
        await authoredFigure(node, parentId);
      } else if (node.t === "Div") {
        const [rawAttr, children] = node.c as [Attr, Node[]];
        const attr = recoverThemeAttributes(rawAttr, "div", source, computed);
        if (parseDesignAttributes(attr).variant) {
          throw new DesignError(
            "VARIANT_TARGET_MISMATCH",
            "bento-variant belongs to a level-2 slide heading.",
          );
        }
        const chartAncestor = chartAncestors.get(attr[0]);
        if (
          chartAncestor && (chartAncestor.parentId !== parentId ||
            JSON.stringify([...attr[1]].sort()) !==
              JSON.stringify([...chartAncestor.attr[1]].sort()) ||
            JSON.stringify([...attr[2]].sort()) !==
              JSON.stringify([...chartAncestor.attr[2]].sort()))
        ) {
          throw new Error(
            "UNMAPPED_CHART_SOURCE: executed chart ancestor attributes or ancestry differ from original source",
          );
        }
        const originalDiv = attr[0] &&
          source?.blocks.find((block) =>
            block.id === attr[0] && block.kind === "div" &&
            block.origin === "authored"
          );
        if (
          originalDiv && !kpiAncestors.has(attr[0]) &&
          !chartAncestors.has(attr[0]) && !isSourceChart(originalDiv)
        ) {
          // Transparent anonymous divs do not introduce a renderer source ID.
          // Every identified source ancestor is checked in turn, so moving an
          // intact subtree cannot retain a fabricated inherited context.
          let sourceParent = originalDiv.parentId;
          while (sourceParent) {
            const parent = source!.blocks.find((block) =>
              block.id === sourceParent
            );
            if (!parent || parent.stable) break;
            sourceParent = parent.parentId;
          }
          if (sourceParent !== parentId) {
            throw new Error(
              "UNMAPPED_PROVENANCE: authored source wrapper moved outside its original ancestry",
            );
          }
        }
        if (
          source && !computed &&
          (attr[1].includes("quarto-figure") ||
            attr[2].some(([name]) => name === "bento-image-id"))
        ) {
          if (attr[2].some(([name]) => name === "bento-image-id")) {
            if (children.length !== 1) {
              throw new Error(
                "UNMAPPED_AUTHORED_IMAGE: bound image wrapper needs exactly one source image",
              );
            }
            await authoredFigure(children[0], attr[0], attr);
            design(attr, slide!.elements.slice(groupStart));
          } else await authoredFigure(node, parentId);
          if (groups) groups.push(slide!.elements.slice(groupStart));
          contentFrame = previousFrame;
          continue;
        }
        const ancestor = kpiAncestors.get(attr[0]);
        if (
          ancestor && (ancestor.parentId !== parentId ||
            JSON.stringify([...attr[1]].sort()) !==
              JSON.stringify([...ancestor.attr[1]].sort()) ||
            JSON.stringify([...attr[2]].sort()) !==
              JSON.stringify([...ancestor.attr[2]].sort()))
        ) {
          throw new DesignError(
            "KPI_SOURCE_CONTEXT",
            "Executed KPI ancestor attributes or ancestry differ from original source.",
          );
        }
        const richTable = richTables.get(attr[0]);
        if (richTable) {
          if (
            inComponent || computed || !slide ||
            slide.id !== richTable.candidate.source.slideId ||
            consumedRichTables.has(attr[0])
          ) {
            throw new Error(
              "RICH_TABLE_PROJECTION_MISMATCH: use one original standalone rich table wrapper under its original slide",
            );
          }
          const { element, origin } = richTableElement(richTable);
          if (y + Number(element.h) > 700) {
            throw new Error(
              "UNSUPPORTED_RICH_TABLE: complete table cannot fit after preceding content; move it to a separate slide instead of clipping or shrinking",
            );
          }
          element.y = y;
          add(element, origin);
          result.diagnostics.push({
            ...richTable.diagnostic,
            elementId: element.id,
          });
          y += Number(element.h) + 20;
          consumedRichTables.add(attr[0]);
          continue;
        }
        const widget = widgets.get(attr[0]);
        if (widget) {
          if (
            inComponent || computed || !slide || slide.id !== widget.slideId ||
            consumedWidgets.has(attr[0]) || attr[2].some(([key]) =>
              key === "bento-element-id"
            )
          ) {
            throw new Error(
              "WIDGET_PROJECTION_MISMATCH: use a single identified widget wrapper outside components under its original slide",
            );
          }
          const element = structuredClone(widget.element);
          element.y = y;
          element.h = Math.min(Number(element.h), Math.max(100, 670 - y));
          add(element, widget.origin);
          design(attr, [element]);
          y += Number(element.h) + 20;
          consumedWidgets.add(attr[0]);
          continue;
        }

        const declaration = parseDesignAttributes(attr);
        if (declaration.component === "kpi") {
          if (
            !source || computed ||
            attr[1].some((c) => c === "cell" || c.startsWith("cell-output"))
          ) {
            throw new DesignError(
              "KPI_SOURCE_CONTEXT",
              "Declare an original KPI outside execution output; only verified source cards/layouts can contain it.",
            );
          }
          const binding = kpiSource(source, attr[0]);
          if (binding.wrapper.parentId !== parentId) {
            throw new DesignError(
              "KPI_SOURCE_CONTEXT",
              "Executed KPI ancestry differs from its original source component chain.",
            );
          }
          if (!slide) startSlide("qb-introduction");
          const component = await projectKpi(
            source,
            attr,
            children,
            contentFrame ?? retainedFrames.get(attr[0]) ?? remainingFrame() ?? {
              x: 80,
              y,
              w: 1120,
              h: Math.min(470, 680 - y),
            },
            defaults,
            kpiAppearances.get(slide!.id),
            binding.ancestors.some((id) => {
              const original = kpiAncestors.get(id)!;
              const properties =
                parseDesignAttributes(original.attr).properties;
              return ["x", "y", "w", "h"].some((field) => field in properties);
            }),
          );
          for (const element of component.elements) {
            measuredComponents.fixed.add(element.id);
          }
          if (component.appearanceRescued) {
            for (const element of component.elements) {
              if (element.type === "text") {
                measuredComponents.omitted.add(element.id);
              }
            }
            (result.kpiAppearanceRescues ??= []).push({
              slideId: slide!.id,
              elementIds: component.elements.filter((element) =>
                element.type === "text"
              ).map((element) => element.id),
            });
          }
          for (const element of component.elements) {
            add(element, component.origins[element.id]);
          }
          Object.assign(result.design![slide!.id] ??= {}, component.fields);
          // A rescued source baseline keeps the authoritative component frame.
          // Its unpainted default role heights must not move subsequent content.
          y = component.appearanceRescued
            ? Number(component.elements[0].y) +
              Number(component.elements[0].h) + 20
            : Math.max(
              ...component.elements.map((element) =>
                Number(element.y) + Number(element.h)
              ),
            ) + 20;
          if (groups) groups.push(slide!.elements.slice(groupStart));
          contentFrame = previousFrame;
          continue;
        }
        if (
          declaration.component === "diagram" ||
          declaration.component === "timeline"
        ) {
          if (!source || computed || inComponent || parentId) {
            throw new DesignError(
              "UNMAPPED_GRAPH_SOURCE",
              "Declare original graphs directly under a slide, outside execution and other components.",
            );
          }
          if (!slide) startSlide("qb-introduction");
          const projected = await projectGraph(
            source,
            node,
            remainingFrame() ?? {
              x: 80,
              y,
              w: 1120,
              h: Math.min(470, 680 - y),
            },
            defaults,
          );
          for (const element of projected.elements) {
            add(element, projected.origins[element.id]);
          }
          Object.assign(result.design![slide!.id] ??= {}, projected.fields);
          y = projected.frame.y + projected.frame.h + 20;
          continue;
        }
        if (
          declaration.component === "card" || declaration.component === "layout"
        ) {
          if (
            computed ||
            attr[1].some((c) => c === "cell" || c.startsWith("cell-output"))
          ) {
            throw new DesignError(
              "COMPUTED_COMPONENT",
              "Declare source components outside execution output.",
            );
          }
          if (!slide) startSlide("qb-introduction");
          if (
            declaration.component === "layout" &&
            children.some((child) =>
              child.t !== "Div" || !(child.c as [Attr, Node[]])[0][0]
            )
          ) {
            throw new DesignError(
              "LAYOUT_CHILDREN",
              "Named layouts require identified direct fenced-div children.",
            );
          }
          const cardDefaults = declaration.component === "card"
            ? {
              ...roleStyle(reusableTheme, "card"),
              ...selectedStyle(attr, "card"),
            }
            : {};
          if (declaration.component === "layout" && declaration.style) {
            throw new DesignError(
              "STYLE_TARGET_MISMATCH",
              "Named styles belong to card, text or code objects.",
            );
          }
          const previousTextStyle = inheritedCardTextStyle,
            previousCodeStyle = inheritedCardCodeStyle;
          const cardText = textProperties(cardDefaults);
          inheritedCardTextStyle = { ...inheritedCardTextStyle, ...cardText };
          inheritedCardCodeStyle = {
            ...inheritedCardCodeStyle,
            ...Object.fromEntries(
              Object.entries(cardText).filter(([field]) =>
                !["fontWeight", "letterSpacing"].includes(field)
              ),
            ),
          };
          const index = slide!.elements.length, componentY = y;
          const childGroups: Element[][] = [];
          const base = retainedFrames.get(attr[0]) ?? remainingFrame() ??
            {
              x: 80,
              y: componentY,
              w: 1120,
              h: Math.min(470, 680 - componentY),
            };
          const semantic = children.filter((child) => child.t !== "RawBlock");
          // Measure simple text/code rows at their final width; images receive
          // the remaining space. No layout rectangle is fitted a second time.
          const frameWidth = Number(declaration.properties.w ?? base.w) - 48;
          const lines = (html: string, size: number): number => {
            const plain = html.replace(/<br\s*\/?>/gi, "\n").replace(
              /<[^>]*>/g,
              "",
            );
            return plain.split("\n").reduce(
              (sum, row) =>
                sum + Math.max(
                  1,
                  Math.ceil(
                    [...row].reduce(
                      (width, ch) =>
                        width + (ch.codePointAt(0)! > 255 ? size : size * .65),
                      0,
                    ) / frameWidth,
                  ),
                ),
              0,
            );
          };
          const rowHeight = (child: Node): number => {
            if (
              child.t === "Div" &&
              (child.c as [Attr, Node[]])[0][1].includes("bento-kpi")
            ) return -1;
            // A chart fills the remaining card height, then validates its axes,
            // labels and legend at that exact frame. Wrapper siblings cannot be
            // measured as one chart and silently squeezed into the same slot.
            const containsChart = (node: Node): boolean =>
              node.t === "Div" &&
              ((node.c as [Attr, Node[]])[0][1].includes("bento-chart") ||
                (node.c as [Attr, Node[]])[1].some(containsChart));
            if (containsChart(child)) {
              let candidate = child;
              while (candidate.t === "Div") {
                const [attributes, nested] = candidate.c as [Attr, Node[]];
                if (attributes[1].includes("bento-chart")) return -1;
                const semantic = nested.filter((n) => n.t !== "RawBlock");
                if (semantic.length !== 1) {
                  throw new DesignError(
                    "COMPONENT_CHART_SUBTREE",
                    "Put chart wrapper siblings in separate card children.",
                  );
                }
                candidate = semantic[0];
              }
            }
            // A table can be wrapped by source and execution divs. Inspect the
            // whole subtree; never select one descendant and drop its siblings.
            const tableHeight = (value: Node): number | undefined => {
              if (value.t === "Table") {
                return Number(
                  projectTable(value, "measurement", 0, {
                    x: 0,
                    y: 0,
                    w: frameWidth,
                    h: 720,
                  }).h,
                );
              }
              if (value.t !== "Div") return undefined;
              const [attributes, nested] = value.c as [Attr, Node[]];
              if (attributes[1].includes("bento-chart")) return undefined;
              const semantic = nested.filter((n) => n.t !== "RawBlock");
              const measured = semantic.map(tableHeight);
              if (measured.every((h) => h === undefined)) return undefined;
              if (semantic.length !== 1) {
                throw new DesignError(
                  "COMPONENT_TABLE_SUBTREE",
                  "A table wrapper must contain only the table and transparent execution wrappers; move sibling text/code into separate card children.",
                );
              }
              return measured[0];
            };
            const measuredTable = tableHeight(child);
            if (measuredTable !== undefined) return measuredTable;
            if (images([child]).length) return -1;
            const measure = (
              node: Node,
              wrappers: ReusableStyle = {},
            ): number => {
              const attributes = node.t === "Header"
                ? (node.c as [number, Attr, Node[]])[1]
                : ["Div", "CodeBlock"].includes(node.t)
                ? (node.c as [Attr, unknown])[0]
                : undefined;
              const attr = attributes &&
                recoverThemeAttributes(
                  attributes,
                  node.t === "Header"
                    ? "heading"
                    : node.t === "CodeBlock"
                    ? "code"
                    : "div",
                  source,
                );
              const own = attr ? parseDesignAttributes(attr) : undefined;
              const selected = own?.style
                ? namedStyle(reusableTheme, own.style).properties
                : {};
              if (node.t === "Div") {
                const nested = (node.c as [Attr, Node[]])[1].filter((item) =>
                  item.t !== "RawBlock"
                );
                if (own?.component) return 90;
                return nested.reduce(
                  (sum, item) =>
                    sum +
                    measure(item, {
                      ...wrappers,
                      ...selected,
                      ...own?.properties,
                    }),
                  0,
                ) + Math.max(0, nested.length - 1) * 20;
              }
              const role = node.t === "Header"
                ? "heading"
                : node.t === "CodeBlock"
                ? "code"
                : "body";
              const values = {
                fontSize: role === "heading" ? 32 : role === "code" ? 24 : 26,
                lineHeight: 1.25,
                ...(role === "code"
                  ? inheritedCardCodeStyle
                  : inheritedCardTextStyle),
                ...roleStyle(reusableTheme, role),
                ...(role === "code" ? inheritedCodeStyle : inheritedTextStyle),
                ...wrappers,
                ...selected,
                ...own?.properties,
                ...declaration.properties,
              };
              const size = Number(values.fontSize),
                leading = Number(values.lineHeight);
              if (node.t === "Header") {
                return lines(
                      inline((node.c as [number, Attr, Node[]])[2]),
                      size,
                    ) * size * leading + 4;
              }
              if (node.t === "Para" || node.t === "Plain") {
                return lines(inline(node.c as Node[]), size) * size * leading +
                  5;
              }
              if (node.t === "CodeBlock") {
                return Math.max(
                  90,
                  ((node.c as [Attr, string])[1].split("\n").length + 1) *
                    size * leading,
                );
              }
              if (["BulletList", "OrderedList"].includes(node.t)) {
                return lines(renderList(node), size) * size * leading + 5;
              }
              return 90;
            };
            return measure(child);
          };
          const placement = componentFrames(
            declaration,
            base,
            semantic.length,
            defaults,
            declaration.component === "card"
              ? semantic.map(rowHeight)
              : undefined,
          );
          await walk(
            children,
            false,
            attr[0],
            true,
            childGroups,
            placement.children,
          );
          inheritedCardTextStyle = previousTextStyle;
          inheritedCardCodeStyle = previousCodeStyle;
          const fields = (result.design![slide!.id] ??= {});
          const component = projectComponent(
            childGroups.filter((group) => group.length),
            declaration,
            placement.frame,
            fields,
            defaults,
            measuredComponents,
          );
          if (declaration.component === "card") {
            const background = component.elements.find((element) =>
              element.id === `${declaration.sourceId}/qb-card-background`
            )!;
            for (const [field, value] of Object.entries(cardDefaults)) {
              if (
                ["fill", "stroke", "strokeWidth", "radius", "opacity"].includes(
                  field,
                ) && !(field in declaration.properties)
              ) background[field] = value;
            }
          }
          for (const id of component.decorativeIds) {
            if (slide!.elements.slice(0, index).some((e) => e.id === id)) {
              throw new Error(`DUPLICATE_ID: ${id}`);
            }
            result.origins[slide!.id][id] = {
              origin: "authored",
              sourceId: attr[0],
              designOnly: true,
            };
          }
          slide!.elements.splice(
            index,
            slide!.elements.length - index,
            ...component.elements,
          );
          Object.assign(fields, component.fields);
          y = Math.max(
            ...component.elements.filter((element) =>
              !measuredComponents.omitted.has(element.id)
            ).map((e) => Number(e.y) + Number(e.h)),
          ) + 20;
          if (groups) {
            groups.push(slide!.elements.slice(groupStart));
          }
          contentFrame = previousFrame;
          continue;
        }
        if (
          declaration.component === "code" &&
          (children.length !== 1 || children[0].t !== "CodeBlock")
        ) {
          throw new DesignError(
            "CODE_COMPONENT_CONTENT",
            "A .bento-code wrapper needs exactly one displayed, non-executable code fence.",
          );
        }
        const beforeSlide = slide, beforeCount = slide?.elements.length ?? 0;
        const priorTextStyle = inheritedTextStyle,
          priorCodeStyle = inheritedCodeStyle;
        if (declaration.style) {
          const named = namedStyle(reusableTheme, declaration.style);
          if (named.target === "card") {
            throw new DesignError(
              "STYLE_TARGET_MISMATCH",
              "Card styles require .bento-card.",
            );
          }
          if (named.target === "text") {
            inheritedTextStyle = { ...inheritedTextStyle, ...named.properties };
          } else {inheritedCodeStyle = {
              ...inheritedCodeStyle,
              ...named.properties,
            };}
        }
        if (attr[1].includes("bento-chart")) {
          const declaration = parseDesignAttributes(attr);
          if (!source || computed) {
            throw new Error(
              "UNMAPPED_CHART_SOURCE: declare chart intent in an original QMD wrapper, not generated output",
            );
          }
          const binding = chartSource(source, attr[0]);
          if (consumedCharts.has(attr[0])) {
            throw new Error(
              "UNMAPPED_CHART_SOURCE: original chart projected more than once",
            );
          }
          consumedCharts.add(attr[0]);
          if (
            binding.wrapper.parentId !== parentId ||
            JSON.stringify([...attr[1]].sort()) !==
              JSON.stringify([...binding.attr[1]].sort()) ||
            JSON.stringify([...attr[2]].sort()) !==
              JSON.stringify([...binding.attr[2]].sort())
          ) {
            throw new Error(
              "UNMAPPED_CHART_SOURCE: executed chart attributes or ancestry differ from original source",
            );
          }
          const executed = executedChartTable(
            binding.computed
              ? producerOutputChildren(
                ast,
                children,
                source.hash,
                binding.block.id,
              )
              : children,
          );
          if (
            binding.kind !== declaration.chartKind ||
            binding.computed !== executed.computed
          ) {
            throw new Error(
              "UNMAPPED_CHART_SOURCE: original chart intent or producer disagrees with execution",
            );
          }
          const element = projectChart(
            executed.table,
            binding.kind,
            `${attr[0]}/chart`,
            y,
            remainingFrame(),
          );
          if (!binding.computed) {
            validateAuthoredChart(source, binding.block.id, element);
          }
          add(element, {
            origin: binding.computed ? "computed" : "authored",
            sourceId: binding.block.id,
            ...(binding.computed ? { producer: binding.block.id } : {}),
          });
          design([
            attr[0],
            attr[1].filter((c) => c !== "bento-chart"),
            attr[2].filter(([k]) => k !== "bento-chart-kind"),
          ], [element]);
          y += Number(element.h) + 20;
          if (groups) groups.push(slide!.elements.slice(groupStart));
          contentFrame = previousFrame;
          continue;
        }
        const containsTable = (value: unknown): boolean =>
          Array.isArray(value)
            ? value.some(containsTable)
            : !!value && typeof value === "object" &&
              ((value as Node).t === "Table" ||
                containsTable((value as Node).c));
        if (attr[1].includes("quarto-float") && containsTable(children)) {
          throw new Error(
            "UNSUPPORTED_TABLE: captions and table floats need a faithful associated caption mapping; use an uncaptioned table with a non-tbl producer label for this slice",
          );
        }
        const token = attr[2].find(([key]) => key === "qbento-producer-proof")
          ?.[1];
        if (attr[1].includes("qbento-execution") || token !== undefined) {
          if (!source || token === undefined) {
            throw new Error(
              "INVALID_PRODUCER_RECEIPT: missing original source or token",
            );
          }
          const proof = producerReceipt(ast, source.hash, token);
          const producer = source.blocks.find((block) =>
            block.id === proof.id && block.kind === "chunk"
          );
          if (!producer || producer.slideId !== proof.slideId) {
            throw new Error(
              "INVALID_PRODUCER_RECEIPT: original producer scope changed",
            );
          }
          const previousProducer = verifiedTableProducer;
          verifiedTableProducer = proof.id;
          try {
            await walk(children, true, proof.id, inComponent);
          } finally {
            verifiedTableProducer = previousProducer;
          }
          contentFrame = previousFrame;
          if (groups && slide === groupSlide) {
            groups.push(slide!.elements.slice(groupStart));
          }
          continue;
        }
        // Unlabelled execution wrappers never infer producers from displayed code.
        const sourceParent = computed && parentId
          ? parentId
          : attr[0] || parentId;
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
          if (!isNativeIdentity(nativeId) || !attr[0]) {
            throw new Error(
              "INVALID_ID: bento-element-id needs safe visual and explicit source identities",
            );
          }
          if (
            isComputed || children.length !== 1 ||
            ![
              "Para",
              "Plain",
              "BulletList",
              "OrderedList",
              "CodeBlock",
              "Table",
            ]
              .includes(
                children[0].t,
              ) ||
            images(children).length
          ) {
            throw new Error(
              "AMBIGUOUS_VISUAL_BINDING: bento-element-id requires exactly one authored paragraph, list, display equation or displayed code",
            );
          }
          const content = children[0].c as Node[];
          const isList = ["BulletList", "OrderedList"].includes(children[0].t);
          const formula =
            isList || ["CodeBlock", "Table"].includes(children[0].t)
              ? undefined
              : displayFormula(content);
          if (children[0].t === "Table") {
            if (!source || tableNativeIdentity(source, attr[0]) !== nativeId) {
              throw new Error(
                "UNMAPPED_TABLE_SOURCE: native table identity differs from the original wrapper declaration",
              );
            }
            await walk(children, false, attr[0]);
            const element = slide!.elements.at(-1)!;
            const previousId = element.id;
            element.id = nativeId;
            result.origins[slide!.id][nativeId] =
              result.origins[slide!.id][previousId];
            delete result.origins[slide!.id][previousId];
          } else if (children[0].t === "CodeBlock") {
            const code = structuredClone(children[0]);
            const codeAttr = (code.c as [Attr, string])[0];
            if (codeAttr[0]) {
              throw new Error(
                "AMBIGUOUS_VISUAL_BINDING: displayed code has its own identity",
              );
            }
            codeAttr[0] = nativeId;
            await walk([code], false, attr[0]);
            result.origins[slide!.id][nativeId] = {
              origin: "authored",
              sourceId: `${attr[0]}/code:1`,
            };
          } else if (isList) {
            text(nativeId, renderList(children[0]), false, {
              origin: "authored",
              sourceId: `${attr[0]}/list:1`,
            });
          } else if (formula !== undefined) {
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
            await figure(img, isComputed, attr[0], sourceParent);
          }
        } else await walk(children, isComputed, sourceParent, inComponent);
        inheritedTextStyle = priorTextStyle;
        inheritedCodeStyle = priorCodeStyle;
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
          if (source && !computed) {
            await authoredFigure(node, parentId);
            if (groups) groups.push(slide!.elements.slice(groupStart));
            contentFrame = previousFrame;
            continue;
          }
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
      } else if (["BulletList", "OrderedList"].includes(node.t)) {
        // Marked lists still consume their source-kind ordinal.
        listIndex++;
        const id = sourceMarker ??
          (parentId ? `${parentId}/list:${listIndex}` : `qb-list-${++counter}`);
        const explicitMarker = sourceMarker;
        sourceMarker = undefined;
        text(id, renderList(node), false, {
          origin: computed ? "computed" : "authored",
          sourceId: explicitMarker ?? (parentId ? id : undefined),
          ...(computed && parentId ? { producer: parentId } : {}),
        });
      } else if (node.t === "Table") {
        if (!source || computed && !parentId) {
          throw new Error(
            "UNMAPPED_TABLE_SOURCE: tables need original source evidence and computed tables need an identified producer",
          );
        }
        const identifiedBlock = computed
          ? tableProducer(source, parentId!, verifiedTableProducer)
          : parentId
          ? authoredTableBlock(source, parentId)
          : undefined;
        const provisional = projectTable(
          node,
          "pending-table",
          y,
          remainingFrame(),
        );
        const block = identifiedBlock ?? matchBareTable(source, provisional);
        if (tableSources.has(block.id)) {
          throw new Error(
            "UNSUPPORTED_TABLE: multiple tables cannot claim one original source fragment",
          );
        }
        tableSources.add(block.id);
        if (!parentId && sourceMarker && block.explicitId !== sourceMarker) {
          throw new Error(
            "UNMAPPED_TABLE_SOURCE: a table marker must exist in its exact original source fragment",
          );
        }
        const id = computed
          ? `${block.id}/table:1`
          : parentId
          ? `${parentId}/table`
          : sourceMarker ?? `qb-table-${++counter}`;
        sourceMarker = undefined;
        const element: Element = { ...provisional, id };
        if (!computed) validateAuthoredTable(source, block.id, element);
        add(element, {
          origin: computed ? "computed" : "authored",
          sourceId: block.id,
          ...(computed ? { producer: block.id } : {}),
        });
        y += Number(element.h) + 20;
      } else if (node.t === "CodeBlock") {
        const [rawAttr, content] = node.c as [Attr, string];
        const attr = recoverThemeAttributes(rawAttr, "code", source, computed);
        if (parseDesignAttributes(attr).variant) {
          throw new DesignError(
            "VARIANT_TARGET_MISMATCH",
            "bento-variant belongs to a level-2 slide heading.",
          );
        }
        const codeDefaults = {
          ...inheritedCardCodeStyle,
          ...roleStyle(reusableTheme, "code"),
          ...inheritedCodeStyle,
          ...selectedStyle(attr, "code"),
        };
        const explicitCode = parseDesignAttributes(attr).properties;
        const codeSize = Number(
            explicitCode.fontSize ?? codeDefaults.fontSize ?? 24,
          ),
          codeLineHeight = Number(
            explicitCode.lineHeight ?? codeDefaults.lineHeight ?? 1.25,
          );
        let sourceId = attr[0] || sourceMarker;
        if (!sourceId && parentId) {
          if (computed) {
            const key = JSON.stringify([slide?.id, parentId]);
            const index = (computedCodeIndexes.get(key) ?? 0) + 1;
            computedCodeIndexes.set(key, index);
            sourceId = `${parentId}/code:${index}`;
          } else sourceId = `${parentId}/code:${++codeIndex}`;
        }
        sourceMarker = undefined;
        const languages = attr[1].filter((name) =>
          !["sourceCode", "cell-code", "bento-code"].includes(name)
        );
        if (languages.length > 1) {
          throw new Error(
            "UNSUPPORTED_CODE_CLASSES: displayed code supports one language class plus native visual attributes",
          );
        }
        const height = contentFrame
          ? Math.max(
            90,
            (content.split("\n").length + 1) * codeSize * codeLineHeight,
          )
          : Math.min(
            470,
            Math.max(
              90,
              (content.split("\n").length + 1) * codeSize * codeLineHeight,
            ),
          );
        const element: Element = {
          id: sourceId ?? `qb-code-${++counter}`,
          type: "code",
          content,
          x: (contentFrame ?? slideContentFrame)?.x ?? 80,
          y,
          w: (contentFrame ?? slideContentFrame)?.w ?? 1120,
          h: height,
          rotation: 0,
          opacity: 1,
          fontSize: 24,
          fontFamily: "ui-monospace, monospace",
          color: theme.color,
          align: "left",
          valign: "top",
          lineHeight: 1.25,
          ...codeDefaults,
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
          ? raw.match(/^\s*<!--\s*qb:([^\s]+)\s*-->\s*$/)
          : null;
        sourceMarker = marker && isSourceIdentity(marker[1])
          ? marker[1]
          : undefined;
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
      if (groups) {
        if (slide !== groupSlide && groupSlide) {
          throw new DesignError(
            "COMPONENT_SLIDE",
            "Component content cannot create slides.",
          );
        }
        groups.push(slide?.elements.slice(groupStart) ?? []);
      }
      contentFrame = previousFrame;
    }
  }
  await walk(ast.blocks);
  if (
    source &&
    consumedImages.size !==
      source.blocks.filter((block) => block.kind === "image").length
  ) {
    throw new Error(
      "UNMAPPED_AUTHORED_IMAGE: every original source image must be projected once with its caption",
    );
  }
  if (consumedCharts.size !== expectedCharts.size) {
    throw new Error(
      "UNMAPPED_CHART_SOURCE: every original chart must be projected exactly once",
    );
  }
  if (consumedRichTables.size !== richTables.size) {
    throw new Error(
      "RICH_TABLE_PROJECTION_MISMATCH: not every checked rich table was consumed exactly once",
    );
  }
  if (consumedWidgets.size !== widgets.size) {
    throw new Error(
      "WIDGET_PROJECTION_MISMATCH: not every verified widget was consumed exactly once",
    );
  }
  if (!document.slides.length) {
    throw new Error("EMPTY_DECK: source contains no supported content");
  }
  result.diagnostics = refreshOverflowDiagnostics(document, result.diagnostics);
  return result;
}

/** Execution modes that erase source/output boundaries cannot be reverse-mapped. */
export function assertSupportedExecutionSource(source: SourceDocument): void {
  assertCompatibleComponentSource(source);
  for (
    const block of source.blocks.filter((block) =>
      block.kind === "div" && sourceComponentClass(block.raw) === ".bento-kpi"
    )
  ) {
    kpiSource(source, block.id);
  }
  sourceGraphs(source);
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
  sourceInline?: ReadonlyMap<string, SourceInlineProof>,
  defaults: DesignDefaults = {},
): Projection {
  assertSupportedExecutionSource(source);
  assertReusableDesignSource(source, defaults);
  if (source.diagnostics.length) {
    throw new Error(
      "UNMAPPED_PROVENANCE: resolve original source identity/structure diagnostics first",
    );
  }
  const origins: Projection["origins"] = {};
  const used = new Set<string>();
  const originalHtml = (
    block: SourceDocument["blocks"][number],
  ): string | undefined => {
    if (!sourceInline) return block.content;
    const proof = sourceInline.get(block.id);
    return proof?.sourceHash === source.hash && proof.blockId === block.id &&
        proof.kind === block.kind
      ? proof.html
      : undefined;
  };
  // Automatic heading IDs and authored source IDs are different until a
  // reviewed sync pins them. Establish each slide from its exact original
  // heading before considering any unlabelled paragraph beneath it.
  const originalSlides = new Map<string, string>();
  for (const slide of projection.document.slides) {
    const exact = source.slides.filter((candidate) =>
      candidate.id === slide.id && candidate.stable
    );
    if (exact.length === 1) {
      originalSlides.set(slide.id, exact[0].id);
      continue;
    }
    const title = slide.elements.find((element) =>
      projection.origins[slide.id]?.[element.id]?.sourceId === slide.id &&
      element.type === "text" && typeof element.html === "string"
    );
    const matches = title
      ? source.slides.filter((candidate) => {
        const heading = source.blocks.find((block) =>
          block.id === candidate.headingId
        )!;
        return heading.origin === "authored" && !heading.stable &&
          originalHtml(heading) === title.html &&
          (!sourceInline ||
            sourceInline.get(heading.id)?.readerId === slide.id);
      })
      : [];
    if (matches.length === 1) originalSlides.set(slide.id, matches[0].id);
  }
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
      if (original.graph) {
        const sourceSlideId = originalSlides.get(slideId);
        if (!sourceSlideId) {
          throw new DesignError(
            "UNMAPPED_GRAPH_PROVENANCE",
            "Graph slide needs its exact original heading proof before projection.",
          );
        }
        validateGraphOrigin(source, original, element, slideId, sourceSlideId);
        origins[slideId][elementId] = {
          ...original,
          graph: {
            ...(original.graph as { [key: string]: Json }),
            nativeSlideId: slideId,
            sourceSlideId,
          },
        };
        continue;
      }
      if (original.designOnly) {
        if (elementId.startsWith(`${slideId}/qb-theme/`)) {
          const mappedSlide = originalSlides.get(slideId);
          const headingId = source.slides.find((candidate) =>
            candidate.id === mappedSlide
          )?.headingId;
          const heading = source.blocks.find((block) =>
            block.id === headingId && block.kind === "heading" &&
            block.origin === "authored"
          );
          const attributes = heading && originalThemeAttributes(heading);
          const selected =
            attributes && parseDesignAttributes(attributes).variant ||
            defaults.theme?.defaultVariant;
          const definition = variantFor(defaults.theme, selected);
          const expected = definition &&
            variantDecorations(slideId, selected!, definition).find((
              candidate,
            ) => candidate.id === elementId);
          if (
            !heading || original.origin !== "authored" ||
            ![slideId, heading.id].includes(original.sourceId ?? "") ||
            !expected || JSON.stringify(expected) !== JSON.stringify(element)
          ) {
            throw new DesignError(
              "UNMAPPED_THEME_DESIGN",
              "Theme decoration lacks its exact source heading, selected variant or bounded shape proof.",
            );
          }
          origins[slideId][elementId] = { ...original, sourceId: heading.id };
          continue;
        }
        const container = candidates[0];
        if (
          candidates.length !== 1 || container.kind !== "div" ||
          !container.stable ||
          element.type !== "shape" || element.shape !== "rect" ||
          !(sourceComponentClass(container.raw) === ".bento-card" &&
              elementId === `${container.id}/qb-card-background` ||
            sourceComponentClass(container.raw) === ".bento-kpi" &&
              elementId === `${container.id}/qb-kpi-background` &&
              element.groupId === kpiSource(source, container.id).groupId)
        ) {
          throw new Error(
            "UNMAPPED_COMPONENT_DESIGN: generated component background lacks original container proof",
          );
        }
        if (sourceComponentClass(container.raw) === ".bento-kpi") {
          const binding = kpiSource(source, container.id);
          if (binding.wrapper.slideId !== originalSlides.get(slideId)) {
            throw new Error(
              "UNMAPPED_COMPONENT_DESIGN: KPI background moved outside its verified source slide",
            );
          }
        }
        origins[slideId][elementId] = original;
        continue;
      }
      if (element.type === "chart") {
        const block = candidates.length === 1 ? candidates[0] : undefined;
        if (!block?.parentId) {
          throw new Error(
            "UNMAPPED_CHART_SOURCE: chart lacks one original data source",
          );
        }
        const binding = chartSource(source, block.parentId);
        if (
          binding.block.id !== block.id ||
          element.id !== `${binding.wrapper.id}/chart` ||
          binding.wrapper.slideId !== originalSlides.get(slideId) ||
          element.groupId !== binding.groupId ||
          (original.origin === "computed") !== binding.computed ||
          (binding.computed && original.producer !== binding.block.id)
        ) {
          throw new Error(
            "UNMAPPED_CHART_SOURCE: chart identity, group, slide or producer differs from original source",
          );
        }
      }
      if (original.origin === "computed") {
        const producer = original.producer ??
          (candidates[0]?.kind === "chunk" ? candidates[0].id : undefined);
        const producerBlock = source.blocks.find((b) =>
          b.id === producer && b.kind === "chunk"
        );
        if (
          !producer || !producerBlock || !originalSlides.has(slideId) ||
          producerBlock.slideId !== originalSlides.get(slideId)
        ) {
          throw new Error(
            `UNMAPPED_PROVENANCE: computed element ${elementId} has no verified original producer on its source slide; capture a fresh original execution receipt through qbento render or the guarded Quarto integration`,
          );
        }
        origins[slideId][elementId] = { ...original, producer };
        continue;
      }
      if (
        !candidates.length && element.type === "text" &&
        typeof element.html === "string"
      ) {
        // Only faithful original authored inline HTML can establish this
        // binding, uniquely within the same verified original slide.
        const kind = /^<(ul|ol)>/.test(element.html)
          ? "list"
          : original.sourceId
          ? "heading"
          : "paragraph";
        candidates = source.blocks.filter((b) =>
          b.kind === kind && b.origin === "authored" && !b.stable &&
          !b.parentId && b.slideId === originalSlides.get(slideId) &&
          originalSlides.has(slideId) && originalHtml(b) === element.html &&
          (kind !== "heading" || !sourceInline ||
            sourceInline.get(b.id)?.readerId === original.sourceId)
        );
      }
      if (
        !candidates.length && !original.sourceId && element.type === "text" &&
        typeof element.html === "string" && element.html.startsWith("$$")
      ) {
        candidates = source.blocks.filter((block) =>
          block.kind === "math" && block.origin === "authored" &&
          originalSlides.has(slideId) &&
          block.slideId === originalSlides.get(slideId) &&
          mathToNativeHtml(block.content) === element.html
        );
      }
      if (!candidates.length && !original.sourceId && element.type === "code") {
        candidates = source.blocks.filter((block) => {
          const proof = sourceInline?.get(block.id);
          return block.kind === "code" && block.origin === "authored" &&
            !block.stable && !block.parentId &&
            originalSlides.has(slideId) &&
            block.slideId === originalSlides.get(slideId) &&
            proof?.sourceHash === source.hash &&
            proof.code?.content === element.content &&
            proof.code?.grammarName === (element.grammarName ?? null);
        });
      }
      if (candidates.length !== 1) {
        throw new Error(
          `UNMAPPED_PROVENANCE: element ${elementId} is not uniquely linked to original source; explicitly pin authored identity or use a supported computed output`,
        );
      }
      const block = candidates[0];
      if (
        !originalSlides.has(slideId) ||
        block.slideId !== originalSlides.get(slideId)
      ) {
        throw new Error(
          "UNMAPPED_PROVENANCE: authored object moved outside its verified original source slide",
        );
      }
      if (block.kind === "image") {
        const proof = sourceInline?.get(block.id),
          metadata = original.image as Record<string, Json> | undefined;
        const ids = imageNativeIdentities(source, block);
        const role = metadata?.role;
        if (
          !proof?.image?.data || !metadata ||
          !["asset", "caption"].includes(String(role)) ||
          metadata.target !== proof.image.target ||
          metadata.assetDigest !== hashSource(proof.image.data) ||
          metadata.imageId !== ids.imageId ||
          metadata.captionId !== ids.captionId ||
          element.groupId !== ids.groupId ||
          block.slideId !== originalSlides.get(slideId) || (role === "asset"
            ? element.type !== "image" || element.id !== ids.imageId ||
              element.src !== proof.image.data
            : element.type !== "text" || element.id !== ids.captionId ||
              element.html !== proof.html) ||
          used.has(`${block.id}:${role}`)
        ) {
          throw new Error(
            "UNMAPPED_AUTHORED_IMAGE: image/caption pair, bytes, group or slide differs from the original source proof",
          );
        }
        used.add(`${block.id}:${role}`);
        origins[slideId][elementId] = {
          ...original,
          sourceId: block.id,
          origin: "authored",
        };
        continue;
      }
      if (used.has(block.id)) {
        throw new Error(
          `UNMAPPED_PROVENANCE: multiple executed objects claim authored source block ${block.id}`,
        );
      }
      if (block.kind === "paragraph" && block.parentId) {
        const role = source.blocks.find((candidate) =>
          candidate.id === block.parentId
        );
        const wrapper = role?.parentId &&
          source.blocks.find((candidate) => candidate.id === role.parentId);
        if (wrapper && sourceComponentClass(wrapper.raw) === ".bento-kpi") {
          const binding = kpiSource(source, wrapper.id);
          if (
            !binding.slots.some((slot) => slot.paragraph.id === block.id) ||
            element.groupId !== binding.groupId ||
            binding.wrapper.slideId !== originalSlides.get(slideId)
          ) {
            throw new Error(
              "UNMAPPED_COMPONENT_DESIGN: KPI role does not match its verified source group and slide",
            );
          }
        }
      }
      if (element.type === "chart") {
        validateAuthoredChart(source, block.id, element);
      } else if (element.type === "table") {
        validateAuthoredTable(source, block.id, element);
        if (
          block.slideId !== originalSlides.get(slideId) ||
          !block.parentId && element.groupId !== undefined
        ) {
          throw new Error(
            "UNMAPPED_TABLE_SOURCE: authored table moved outside its original source slide or into an invented group",
          );
        }
      } else if (block.kind === "unsupported" || block.kind === "div") {
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
      if (block.kind === "code" && block.origin === "authored") {
        const proof = sourceInline?.get(block.id);
        if (
          element.type !== "code" || !proof?.code ||
          proof.sourceHash !== source.hash ||
          proof.code.content !== element.content ||
          proof.code.grammarName !== (element.grammarName ?? null)
        ) {
          throw new Error(
            "UNMAPPED_PROVENANCE: displayed code differs from its exact authored fence and language",
          );
        }
      }
      if (
        block.kind === "list" && block.origin === "authored" &&
        originalHtml(block) !== element.html
      ) {
        throw new Error(
          "UNMAPPED_PROVENANCE: executed list differs from its exact authored source fragment",
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
  for (const block of source.blocks.filter((block) => block.kind === "image")) {
    if (!used.has(`${block.id}:asset`) || !used.has(`${block.id}:caption`)) {
      throw new Error(
        "UNMAPPED_AUTHORED_IMAGE: original image/caption pair is incomplete",
      );
    }
  }
  for (const block of source.blocks) {
    if (
      block.kind !== "div" || !isSourceChart(block)
    ) continue;
    const matching = projection.document.slides.flatMap((slide) =>
      slide.elements
    ).filter((element) =>
      element.id === `${block.id}/chart` && element.type === "chart"
    );
    if (matching.length !== 1) {
      throw new Error(
        "UNMAPPED_CHART_SOURCE: every original chart needs one native chart identity",
      );
    }
  }
  for (const block of literalTableBlocks(source)) {
    if (!used.has(block.id)) {
      throw new Error(
        "UNMAPPED_TABLE_SOURCE: an original literal table was removed or lost its exact source binding",
      );
    }
  }
  // A reader/filter may remove a whole authored list without emitting an
  // object to validate above. Source coverage is part of fidelity too.
  for (const block of source.blocks) {
    if (
      block.kind === "list" && block.origin === "authored" && block.slideId &&
      originalHtml(block) !== undefined && !used.has(block.id)
    ) {
      throw new Error(
        "UNMAPPED_PROVENANCE: an authored source list disappeared from executed output; source-transforming filters need an explicit adapter",
      );
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
