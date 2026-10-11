import {
  applyPatches,
  hashSource,
  previewPatches,
  resolveSourceMapping,
  scanSource,
  sliceBytes,
  SourceError,
} from "../src/source/mod.ts";
function eq(actual: unknown, expected: unknown) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
  }
}
function fails(fn: () => unknown, code: string) {
  try {
    fn();
  } catch (error) {
    if (error instanceof SourceError && error.code === code) return;
    throw error;
  }
  throw new Error(`Expected ${code}`);
}
Deno.test("UTF-8 spans and CRLF content patch preserve every surrounding byte", () => {
  const text =
    '---\r\ntitle: "Résumé"\r\n---\r\n\r\n## Éxito {#success .wide}\r\n\r\n<!-- keep me -->\r\n<!-- qb:body -->\r\nβ = .32 y 😀.\r\nSegunda línea.\r\n\r\n```{r}\r\n#| label: fig-test\r\nplot(1:3)\r\n```\r\n';
  const doc = scanSource(text), body = doc.blocks.find((b) => b.id === "body")!;
  eq(sliceBytes(text, body.contentSpan), "β = .32 y 😀.\r\nSegunda línea.");
  eq(doc.blocks.find((b) => b.id === "success")?.content, "Éxito");
  const preview = previewPatches(doc, [{
    blockId: "body",
    replacement: "Nueva β 😀.\nOtra línea.",
  }, { blockId: "success", replacement: "Resultado" }]);
  eq(
    applyPatches(text, preview),
    text.replace("Éxito", "Resultado").replace(
      "β = .32 y 😀.\r\nSegunda línea.",
      "Nueva β 😀.\r\nOtra línea.",
    ),
  );
  eq(doc.blocks.find((b) => b.id === "fig-test")?.origin, "computed");
});
Deno.test("computed and ambiguous source refuse reverse edits", () => {
  const doc = scanSource(
    "## A {#a}\n\n`r round(x, 2)`\n\nLiteral.\n\nLiteral.\n\n```{python}\nprint(2)\n```\n",
  );
  const computed = doc.blocks.find((b) =>
    b.kind === "paragraph" && b.origin === "computed"
  )!;
  fails(
    () => previewPatches(doc, [{ blockId: computed.id, replacement: "42" }]),
    "unmapped",
  );
  fails(
    () =>
      resolveSourceMapping(doc, { sourceHash: doc.hash, literal: "Literal." }),
    "ambiguous-source",
  );
  fails(
    () =>
      resolveSourceMapping(doc, {
        sourceHash: doc.hash,
        sourceId: "a",
        computed: true,
      }),
    "computed-source",
  );
  fails(
    () =>
      resolveSourceMapping(doc, {
        sourceHash: doc.hash,
        sourceId: "a",
        literal: "Changed",
      }),
    "transformed-source",
  );
});
Deno.test("nested fenced divs preserve fences and exact child spans", () => {
  const text =
    '## A {#a}\n\n:::: {#grid .bento-layout}\n::: {#card .bento-card x="84"}\n<!-- qb:body -->\nA plain paragraph.\n:::\n::::\n\n## B {#b}\n\nSecond slide.\n';
  const doc = scanSource(text);
  eq(doc.blocks.find((b) => b.id === "body")?.parentId, "card");
  eq(doc.blocks.find((b) => b.id === "card")?.parentId, "grid");
  eq(doc.slides.map((s) => s.id), ["a", "b"]);
  eq(
    sliceBytes(text, doc.slides[0].span) + sliceBytes(text, doc.slides[1].span),
    text,
  );
  eq(
    applyPatches(
      text,
      previewPatches(doc, [{ blockId: "body", replacement: "New body." }]),
    ),
    text.replace("A plain paragraph.", "New body."),
  );
  fails(
    () => previewPatches(doc, [{ blockId: "grid", replacement: "No" }]),
    "unmapped",
  );
});
Deno.test("stale snapshots, fragments, duplicate IDs and tampered previews refuse", () => {
  const text = "## A {#a}\n\nText.\n";
  const doc = scanSource(text);
  const preview = previewPatches(doc, [{ blockId: "a", replacement: "B" }]);
  fails(() => applyPatches(text + "\n", preview), "stale-source");
  fails(
    () =>
      previewPatches(doc, [{
        blockId: "a",
        expected: "Old",
        replacement: "B",
      }]),
    "stale-fragment",
  );
  const tampered = structuredClone(preview);
  tampered.patches[0].span.end++;
  fails(() => applyPatches(text, tampered), "invalid-preview");
  fails(
    () =>
      previewPatches(scanSource("## A {#a}\n\n## B {#a}\n"), [{
        blockId: "a",
        replacement: "C",
      }]),
    "ambiguous-source",
  );
  fails(
    () =>
      previewPatches(doc, [{ blockId: "a", replacement: "B" }, {
        blockId: "a",
        replacement: "C",
      }]),
    "overlapping-patches",
  );
});
Deno.test("displayed code and math edit inner bytes only", () => {
  const text =
    "<!-- qb:code -->\n~~~~python\nx = 1\n~~~~\n\n<!-- qb:math -->\n$$\nx^2\n$$\n";
  const doc = scanSource(text);
  eq(
    applyPatches(
      text,
      previewPatches(doc, [{ blockId: "code", replacement: "x = 2" }, {
        blockId: "math",
        replacement: "x^3",
      }]),
    ),
    text.replace("x = 1", "x = 2").replace("x^2", "x^3"),
  );
  fails(
    () =>
      previewPatches(doc, [{
        blockId: "code",
        replacement: "~~~\n```{r}\n42\n```",
      }]),
    "structural-replacement",
  );
});
Deno.test("unsupported Markdown, includes and unclosed containers are not editable", () => {
  for (
    const text of [
      "> quote\n",
      "|a|b|\n|-|-|\n",
      "{{< include other.qmd >}}\n",
      "::: {.card}\nText\n",
      "```python\nx = 1\n",
    ]
  ) {
    const doc = scanSource(text);
    eq(doc.blocks.filter((b) => b.editable).length, 0);
  }
});
Deno.test("paragraph replacement cannot silently create slide, chunk, or delete", () => {
  const doc = scanSource("<!-- qb:p -->\nHello.\n");
  for (
    const replacement of [
      "## New slide",
      "One\n\nTwo",
      "```{r}\n1\n```",
      "",
      "- list",
    ]
  ) {
    fails(
      () => previewPatches(doc, [{ blockId: "p", replacement }]),
      "structural-replacement",
    );
  }
  fails(
    () => previewPatches(doc, [{ blockId: "p", replacement: "`r 42`" }]),
    "computed-replacement",
  );
});
Deno.test("hash is SHA-256 and exact literal mapping needs matching execution snapshot", () => {
  eq(
    hashSource("abc"),
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
  );
  const doc = scanSource("## Hi {#hi}\n\nUnique.\n");
  eq(
    resolveSourceMapping(doc, { sourceHash: doc.hash, literal: "Unique." })
      .content,
    "Unique.",
  );
  fails(
    () =>
      resolveSourceMapping(doc, {
        sourceHash: hashSource("old"),
        literal: "Unique.",
      }),
    "stale-source",
  );
});
Deno.test("hash matches WebCrypto for multiblock and Unicode source snapshots", async () => {
  for (const text of ["", "a".repeat(55), "x".repeat(64), "β😀".repeat(1000)]) {
    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(text),
    );
    const expected = [...new Uint8Array(digest)].map((v) =>
      v.toString(16).padStart(2, "0")
    ).join("");
    eq(hashSource(text), expected);
  }
});
Deno.test("quoted attribute text is not an ID, raw blocks and arbitrary execution languages refuse", () => {
  const doc = scanSource(
    '## Heading {title="x #false-id" #real}\n\n```{custom-engine}\nwork()\n```\n\n```{=html}\n<p>raw</p>\n```\n',
  );
  eq(doc.blocks[0].id, "real");
  eq(doc.blocks[1].origin, "computed");
  eq(doc.blocks[2].editable, false);
  fails(
    () => previewPatches(doc, [{ blockId: "real", replacement: "A ###" }]),
    "structural-replacement",
  );
});
Deno.test("sole and final fenced-div IDs survive attribute delimiters", () => {
  for (
    const attributes of [
      "{#card}",
      "{.bento-card #card}",
      "{#card .bento-card}",
      '{title="Quoted #false" #card}',
    ]
  ) {
    const doc = scanSource(`## A {#a}\n\n::: ${attributes}\nParagraph.\n:::\n`);
    const div = doc.blocks.find((b) => b.kind === "div")!,
      paragraph = doc.blocks.find((b) => b.kind === "paragraph")!;
    eq([div.id, div.explicitId, div.stable], ["card", "card", true]);
    eq([paragraph.id, paragraph.parentId], ["card/paragraph:1", "card"]);
  }
  const code = scanSource("```{.python #display}\nx = 1\n```\n").blocks[0];
  eq([code.id, code.editable], ["display", true]);
});
