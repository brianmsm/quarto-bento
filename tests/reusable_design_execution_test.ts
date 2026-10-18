import { executeQuarto } from "../src/render/quarto.ts";
import {
  projectAst,
  validateProjectionOrigins,
} from "../src/render/project.ts";
import { scanSource } from "../src/source/mod.ts";
import { readSourceInline } from "../src/render/source-inline.ts";
import { reusableTheme } from "./fixtures/reusable-design.ts";
import { assertReusableDesignSource } from "../src/render/theme-styles.ts";

function assert(value: unknown, message = "assertion failed"): asserts value {
  if (!value) throw new Error(message);
}
Deno.test("real Quarto projects reusable SPP title bar, section, cards, captions and displayed code without source churn", async () => {
  const directory = await Deno.makeTempDir({
    prefix: "qbento-reusable-design-",
  });
  try {
    const path = `${directory}/session.qmd`;
    const qmd =
      `---\ntitle: Session 02\n---\n\n## Review {#review}\n\n:::: {#question .bento-card bento-style="question"}\n\n### Checkpoint {#checkpoint}\n\n::: {#question-text}\nWhat is the general factor?\n:::\n\n::: {#caption bento-style="caption" color="#795566"}\nA caption with an explicit local color.\n:::\n\n::::\n\n## Practice {#practice bento-variant="section"}\n\n## R example {#r-example}\n\n::: {#snippet .bento-code bento-style="snippet"}\n\n\`\`\`r\nmodel <- c(1, 2, 3)\nsum(model)\n\`\`\`\n\n:::\n\n## Computed {#computed}\n\n\`\`\`{r}\n#| label: result\n#| echo: false\nsum(c(1, 2, 3))\n\`\`\`\n`;
    await Deno.writeTextFile(path, qmd);
    const source = scanSource(qmd), defaults = { theme: reusableTheme };
    assertReusableDesignSource(source, defaults);
    const ast = await executeQuarto(path, `${directory}/build`);
    const inline = await readSourceInline(source, directory);
    const projected = validateProjectionOrigins(
      source,
      await projectAst(
        ast,
        "reusable-real",
        [`${directory}/build`, directory],
        source,
        new Map(),
        defaults,
        new Map(),
        new Map(),
        new Map(),
        inline,
      ),
      inline,
      defaults,
    );
    const [review, practice, example, computed] = projected.document.slides;
    assert(review.elements[0].id === "review/qb-theme/content/title-bar");
    assert(
      review.elements.find((element) =>
        element.id === "question/qb-card-background"
      )?.fill === "#fff0f6",
    );
    assert(
      review.elements.find((element) => element.id === "checkpoint")?.color ===
        "#174941",
      "card erased the reusable heading role",
    );
    const caption = review.elements.find((element) =>
      element.id === "caption/paragraph:1"
    )!;
    assert(caption.fontSize === 18 && caption.color === "#795566");
    assert(projected.design?.review?.[caption.id].ownedPaths.includes("color"));
    assert(
      !projected.design?.review?.[caption.id].ownedPaths.includes("fontSize"),
    );
    assert(practice.background === "#b11562" && practice.elements[0].y === 220);
    assert(example.background === "#fafafa");
    const code = example.elements.find((element) => element.type === "code")!;
    assert(
      code.fontSize === 18 && code.color === "#335577" &&
        code.fontFamily === "Fira Code, monospace",
    );
    assert(
      code.grammarName === "r" && String(code.content).includes("sum(model)"),
    );
    assert(
      computed.elements.some((element) =>
        projected.origins.computed[element.id].origin === "computed" &&
        String(element.content).includes("6")
      ),
    );
    assert(
      await Deno.readTextFile(path) === qmd,
      "render rewrote the original source",
    );
    assert(
      !projected.diagnostics.some((diagnostic) =>
        /OVERFLOW/.test(diagnostic.code)
      ),
      JSON.stringify(projected.diagnostics),
    );
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});
