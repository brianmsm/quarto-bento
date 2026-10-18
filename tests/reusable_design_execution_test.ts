import { executeQuarto } from "../src/render/quarto.ts";
import {
  projectAst,
  validateProjectionOrigins,
} from "../src/render/project.ts";
import { scanSource } from "../src/source/mod.ts";
import { readSourceInline } from "../src/render/source-inline.ts";
import { reusableTheme } from "./fixtures/reusable-design.ts";
import { assertReusableDesignSource } from "../src/render/theme-styles.ts";
import { initializeDesignPackage } from "../src/core/design-initialize.ts";
import {
  applyDesignImport,
  previewDesignImport,
} from "../src/core/design-package.ts";
import { renderProject } from "../src/core/project.ts";

function assert(value: unknown, message = "assertion failed"): asserts value {
  if (!value) throw new Error(message);
}
async function rejects(action: () => Promise<unknown>, code: string) {
  try {
    await action();
  } catch (error) {
    assert(String(error).includes(code), String(error));
    return;
  }
  throw new Error(`expected ${code}`);
}

Deno.test("real Quarto preserves named wrapper heading styles inside and outside cards with explicit source precedence", async () => {
  const directory = await Deno.makeTempDir({ prefix: "qbento-heading-style-" });
  try {
    const source = directory + "/deck.qmd";
    const qmd = `## Free content {#free}

::: {#caption-wrapper bento-style="caption"}
### Caption heading {#caption-heading}
:::

### Ordinary heading {#ordinary-heading}

## Card content {#card-slide}

:::: {#card .bento-card}
::: {#card-wrapper bento-style="caption"}
### Card heading {#card-heading color="#993355"}
:::
::::
`;
    await Deno.writeTextFile(source, qmd);
    const theme = structuredClone(reusableTheme);
    theme.namedStyles!.caption.properties.fontWeight = 600;
    await initializeDesignPackage(source, {
      format: "qbento/design",
      version: 1,
      name: "Heading styles",
      registry: {
        schemaVersion: 1,
        themes: { test: theme },
        activeTheme: "test",
      },
    });
    const result = await renderProject(source);
    const [free, card] = result.state.emitted.slides;
    const caption = free.elements.find((element) =>
      element.id === "caption-heading"
    )!;
    const nested = card.elements.find((element) =>
      element.id === "card-heading"
    )!;
    const ordinary = free.elements.find((element) =>
      element.id === "ordinary-heading"
    )!;
    assert(
      caption.fontSize === 18 && caption.color === "#777777" &&
        caption.fontWeight === 600,
      JSON.stringify(caption),
    );
    assert(
      nested.fontSize === 18 && nested.color === "#993355" &&
        nested.fontWeight === 600,
      JSON.stringify(nested),
    );
    assert(
      ordinary.fontSize === 30 && ordinary.color === "#174941" &&
        ordinary.fontWeight === 400,
    );
    assert(await Deno.readTextFile(source) === qmd);
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("incompatible wrapper style import refuses without mutation and render preflight stops before executing R", async () => {
  const directory = await Deno.makeTempDir({ prefix: "qbento-style-import-" });
  try {
    const source = directory + "/deck.qmd";
    const qmd =
      '## Slide {#slide}\n\n::: {#caption bento-style="caption"}\nA caption.\n:::\n\n## Calculation {#calculation}\n\n```{r}\n#| label: producer\n#| echo: false\nfile.create("producer-ran")\n```\n';
    await Deno.writeTextFile(source, qmd);
    const pkg = {
      format: "qbento/design",
      version: 1,
      name: "Import compatibility",
      registry: {
        schemaVersion: 1,
        themes: { test: structuredClone(reusableTheme) },
        activeTheme: "test",
      },
    };
    await initializeDesignPackage(source, pkg);
    await renderProject(source);
    await Deno.remove(directory + "/producer-ran");
    const paths = [
      "deck.qmd",
      ".qbento/design.json",
      ".qbento/state.json",
      "deck.bento.html",
    ];
    const before = await Promise.all(
      paths.map((path) => Deno.readTextFile(directory + "/" + path)),
    );
    const plan = await previewDesignImport(source, pkg);
    pkg.registry.themes.test.namedStyles!.caption = {
      target: "code",
      properties: { fontSize: 18 },
    };
    await rejects(
      () => previewDesignImport(source, pkg),
      "STYLE_TARGET_MISMATCH",
    );
    await rejects(
      () => applyDesignImport(source, { ...plan, package: pkg }),
      "STYLE_TARGET_MISMATCH",
    );
    for (const [index, path] of paths.entries()) {
      assert(
        await Deno.readTextFile(directory + "/" + path) === before[index],
        path,
      );
    }
    // Even a manually edited registry must be checked before any producer runs.
    await Deno.writeTextFile(
      directory + "/.qbento/design.json",
      JSON.stringify(pkg.registry),
    );
    await rejects(() => renderProject(source), "STYLE_TARGET_MISMATCH");
    assert(
      !await Deno.stat(directory + "/producer-ran").then(
        () => true,
        () => false,
      ),
    );
    for (const [index, path] of paths.entries()) {
      if (path !== ".qbento/design.json") {
        assert(
          await Deno.readTextFile(directory + "/" + path) === before[index],
          path,
        );
      }
    }
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});
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
Deno.test("real themed introduction refuses before executing a producer and leaves source/output untouched", async () => {
  const { renderProject } = await import("../src/core/project.ts");
  const directory = await Deno.makeTempDir({ prefix: "qbento-theme-intro-" });
  try {
    await Deno.mkdir(`${directory}/.qbento`);
    await Deno.writeTextFile(
      `${directory}/.qbento/design.json`,
      JSON.stringify({
        schemaVersion: 1,
        themes: { spp: reusableTheme },
        activeTheme: "spp",
      }),
    );
    const path = `${directory}/intro.qmd`;
    const qmd =
      'Opening content.\n\n```{r}\n#| label: intro-producer\nfile.create("producer-ran")\n1\n```\n\n## Next {#next}\n\nLater text.\n';
    await Deno.writeTextFile(path, qmd);
    let failure: unknown;
    try {
      await renderProject(path);
    } catch (error) {
      failure = error;
    }
    assert(
      String(failure).includes("THEME_INTRO_HEADING_REQUIRED"),
      String(failure),
    );
    assert(await Deno.readTextFile(path) === qmd);
    for (
      const name of ["producer-ran", "intro.bento.html", ".qbento/state.json"]
    ) {
      try {
        await Deno.stat(`${directory}/${name}`);
        throw new Error(`unexpected ${name}`);
      } catch (error) {
        assert(error instanceof Deno.errors.NotFound, String(error));
      }
    }
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});
