import { validateDesignPackage } from "./design-package.ts";
import { registryDefaults } from "../render/registry.ts";
import { projectAst } from "../render/project.ts";
import { loadBentoShell } from "../render/shell.ts";
import { spliceDocument } from "../render/html.ts";
import { scanSource } from "../source/mod.ts";
import type { BentoDoc, Node } from "../render/types.ts";
import {
  ISOLATION_BOOTSTRAP,
  OFFLINE_CSP,
  prepareIsolatedDocument,
} from "../bridge/isolation.ts";

/** A neutral native sample; never executes or imports the target's content. */
export async function previewDesignPackage(value: unknown): Promise<string> {
  const design = validateDesignPackage(value);
  const defaults = registryDefaults(design.registry);
  const theme = defaults.theme;
  const named = Object.entries(theme?.namedStyles ?? {});
  const card = named.find(([, style]) => style.target === "card")?.[0];
  const caption = named.find(([, style]) => style.target === "text")?.[0];
  const blocks: Node[] = [], source: string[] = [];
  const words = (text: string): Node[] => [{ t: "Str", c: text }];
  const heading = (id: string, text: string, variant?: string) => {
    const attributes = variant ? [["bento-variant", variant]] : [];
    source.push(
      `## ${text} {#${id}${variant ? ` bento-variant="${variant}"` : ""}}\n`,
    );
    blocks.push({ t: "Header", c: [2, [id, [], attributes], words(text)] });
  };
  const paragraph = (id: string, text: string, style?: string) => {
    const attributes = style ? [["bento-style", style]] : [];
    source.push(
      `::: {#${id}${style ? ` bento-style="${style}"` : ""}}\n${text}\n:::\n`,
    );
    blocks.push({
      t: "Div",
      c: [[id, [], attributes], [{ t: "Para", c: words(text) }]],
    });
  };
  heading("design-content", "A clear explanation");
  paragraph(
    "design-body",
    "New content uses the shared typography, colors and spacing.",
  );
  if (caption) paragraph("design-caption", "A reusable text style.", caption);
  heading("design-card-slide", "A reusable card");
  source.push(
    `::: {#design-card .bento-card${
      card ? ` bento-style="${card}"` : ""
    }}\nA focused finding with room to read.\n:::\n`,
  );
  blocks.push({
    t: "Div",
    c: [["design-card", ["bento-card"], card ? [["bento-style", card]] : []], [{
      t: "Para",
      c: words("A focused finding with room to read."),
    }]],
  });
  heading("design-code-slide", "Displayed code");
  source.push("```r\nvalues <- c(2, 4, 6)\nmean(values)\n```\n");
  blocks.push({
    t: "CodeBlock",
    c: [["", ["r"], []], "values <- c(2, 4, 6)\nmean(values)"],
  });
  for (
    const name of Object.keys(theme?.variants ?? {}).filter((name) =>
      name !== theme?.defaultVariant
    ).slice(0, 4)
  ) {
    heading("design-variant-" + name, "A new section", name);
    paragraph(
      "design-variant-body-" + name,
      "A consistent transition to the next topic.",
    );
  }
  const projected = await projectAst(
    { meta: {}, blocks },
    "design-preview-" + crypto.randomUUID(),
    [],
    scanSource(source.join("\n")),
    new Map(),
    defaults,
  );
  const doc = prepareIsolatedDocument({
    ...projected.document,
    readonly: true,
  });
  return spliceDocument(
    await loadBentoShell(),
    doc as unknown as BentoDoc,
    ISOLATION_BOOTSTRAP,
    OFFLINE_CSP,
  );
}
