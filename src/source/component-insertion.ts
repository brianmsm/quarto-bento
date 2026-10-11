/** Bounded component source; no design geometry, source execution or inferred roles. */
import { scanSource, type SourceDocument, SourceError } from "./mod.ts";
import { kpiSource } from "./kpi.ts";
export interface ComponentInsertion {
  type: "insert-component";
  kind: "card" | "kpi";
  slideId: string;
  id: string;
  fields: {
    role: "title" | "body" | "label" | "value" | "detail";
    sourceId: string;
    markdown: string;
  }[];
}
function fail(message: string): never {
  throw new SourceError("invalid-component-insertion", message);
}
export function componentMarkdown(operation: ComponentInsertion): string {
  const keys = (value: object, expected: string[]) =>
    Object.keys(value).length === expected.length &&
    expected.every((key) => Object.hasOwn(value, key));
  if (
    !operation ||
    !keys(operation, ["type", "kind", "slideId", "id", "fields"]) ||
    operation.type !== "insert-component" ||
    !["card", "kpi"].includes(operation.kind) ||
    !/^[A-Za-z][\w:.-]{0,119}$/.test(operation.id) ||
    typeof operation.slideId !== "string" || !Array.isArray(operation.fields)
  ) fail("Use one explicit identified card or KPI with exact authored roles.");
  const roles = operation.kind === "card"
    ? ["title", "body"]
    : ["label", "value", ...(operation.fields.length === 3 ? ["detail"] : [])];
  if (operation.fields.length !== roles.length) {
    fail("Use title/body or label/value/optional detail in that order.");
  }
  const pieces = [`:::: {#${operation.id} .bento-${operation.kind}}`];
  for (const [index, field] of operation.fields.entries()) {
    if (
      !field || !keys(field, ["role", "sourceId", "markdown"]) ||
      field.role !== roles[index] ||
      field.sourceId !== `${operation.id}-${field.role}` ||
      typeof field.markdown !== "string" || !field.markdown.trim() ||
      field.markdown.length > 12000
    ) {
      fail(
        "Each authored field needs its explicit role and reserved source identity.",
      );
    }
    const markdown = field.markdown.replace(/\r\n|\r/g, "\n"),
      parsed = scanSource(markdown),
      block = parsed.blocks[0];
    if (
      parsed.diagnostics.length || parsed.blocks.length !== 1 ||
      block.kind !== "paragraph" || !block.editable ||
      block.origin !== "authored" || block.explicitId || block.parentId ||
      block.content !== markdown || /<!--|-->|\{\{[<%]|\$\$|\\\[/.test(markdown)
    ) {
      fail(
        "Fields must be one complete authored paragraph, with no structural, computed or display-math syntax.",
      );
    }
    if (field.role === "title") {
      if (/[\r\n]/.test(markdown)) fail("A card title must be a single line.");
      pieces.push(`### ${markdown} {#${field.sourceId}}`);
    } else {
      pieces.push(
        `::: {#${field.sourceId}${
          operation.kind === "kpi" ? ` bento-role="${field.role}"` : ""
        }}\n${markdown}\n:::`,
      );
    }
  }
  pieces.push("::::");
  const result = pieces.join("\n\n") + "\n\n", parsed = scanSource(result);
  if (
    parsed.diagnostics.length ||
    parsed.blocks.some((block) => block.origin !== "authored")
  ) fail("Component fields introduced unsupported syntax.");
  if (operation.kind === "kpi") kpiSource(parsed, operation.id);
  else {
    const direct = parsed.blocks.filter((block) =>
      block.parentId === operation.id
    );
    if (
      direct.length !== 2 || direct[0].kind !== "heading" ||
      direct[0].level !== 3 || direct[0].id !== `${operation.id}-title` ||
      direct[0].content !== operation.fields[0].markdown ||
      direct[1].kind !== "div" || direct[1].id !== `${operation.id}-body`
    ) fail("Card title/body must preserve exact source roles.");
    const body = parsed.blocks.filter((block) =>
      block.parentId === direct[1].id
    );
    if (
      body.length !== 1 || body[0].kind !== "paragraph" ||
      body[0].id !== `${direct[1].id}/paragraph:1`
    ) fail("Card body must preserve one source paragraph.");
  }
  return result;
}
export function generatedComponent(
  source: SourceDocument,
  operation: ComponentInsertion,
): string {
  const section = componentMarkdown(operation),
    existing = new Set(source.blocks.map((block) => block.id));
  for (const block of scanSource(section).blocks) {
    if (existing.has(block.id)) {
      throw new SourceError(
        "duplicate-id",
        `Source identity ${block.id} already exists.`,
      );
    }
  }
  return section.replace(/\n/g, source.newline);
}
export function verifyComponentInsertion(
  before: SourceDocument,
  after: SourceDocument,
  operation: ComponentInsertion,
): void {
  const expected = scanSource(componentMarkdown(operation)),
    ids = new Set(expected.blocks.map((block) => block.id));
  const added = after.blocks.filter((block) => ids.has(block.id));
  const semantic = (blocks: SourceDocument["blocks"]) =>
    blocks.map((
      block,
    ) => [
      block.id,
      block.kind,
      block.origin,
      block.parentId,
      block.content.replace(/\r\n/g, "\n"),
      block.level,
    ]);
  if (
    JSON.stringify(semantic(added)) !==
      JSON.stringify(semantic(expected.blocks)) ||
    added.some((block) => block.slideId !== operation.slideId) ||
    JSON.stringify(before.slides.map((slide) => [slide.id, slide.stable])) !==
      JSON.stringify(after.slides.map((slide) => [slide.id, slide.stable]))
  ) {
    fail(
      "Insertion must preserve exact component roles and existing slide boundaries.",
    );
  }
  const prior = (blocks: SourceDocument["blocks"]) =>
    blocks.map((
      block,
    ) => [
      block.kind,
      block.raw.replace(/\r?\n$/, ""),
      block.origin,
      block.level,
      block.slideId,
    ]);
  if (
    JSON.stringify(prior(before.blocks)) !==
      JSON.stringify(prior(after.blocks.filter((block) => !ids.has(block.id))))
  ) fail("Insertion changed existing source bytes or block boundaries.");
}
