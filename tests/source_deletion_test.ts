import { applyStructure, previewStructure } from "../src/source/structure.ts";
import { scanSource, sliceBytes, SourceError } from "../src/source/mod.ts";
import { sourceDeletion } from "../src/source/deletion.ts";
import { canonical } from "../src/state/json.ts";
function ok(value: unknown, message = "assertion failed"): asserts value {
  if (!value) throw new Error(message);
}
function eq(a: unknown, b: unknown) {
  ok(canonical(a) === canonical(b), `${canonical(a)} != ${canonical(b)}`);
}
function refuses(fn: () => unknown, code: string) {
  try {
    fn();
  } catch (error) {
    ok(error instanceof SourceError && error.code === code, String(error));
    return;
  }
  throw new Error(`Expected ${code}`);
}
const frame = (body: string) =>
  `## A {#a}\n\n${body}\n\n::: {#keep}\nKeep β 😀.\n:::\n`;
Deno.test("element deletion removes exactly one identified UTF8/CRLF unit and its technical marker", () => {
  for (const newline of ["\n", "\r\n"]) {
    for (
      const [body, blockId] of [
        ["::: {#body}\nLiteral β 😀.\n:::", "body/paragraph:1"],
        ["<!-- qb:body -->\nLiteral β 😀.", "body"],
        [
          '::: {#body bento-element-id="native" x="90"}\nLiteral β 😀.\n:::',
          "body/paragraph:1",
        ],
        ["<!-- qb:formula -->\n$$\ny = 1\n$$", "formula"],
        ["```{#display .javascript}\nconst x = 1;\n```", "display"],
        [
          "::: {#display}\n```javascript\nconst x = 1;\n```\n:::",
          "display/code:1",
        ],
        ["::: {#formula}\n$$\ny = 1\n$$\n:::", "formula/math:1"],
      ]
    ) {
      const source = frame(body).replaceAll("\n", newline),
        mapping = scanSource(source);
      const deletion = sourceDeletion(mapping, blockId);
      const preview = previewStructure(mapping, [{
        type: "delete-block",
        blockId,
        confirmed: true,
      }]);
      eq(preview.steps[0].edits, [{
        span: deletion.span,
        expected: deletion.expected,
        replacement: "",
      }]);
      eq(
        preview.result,
        sliceBytes(source, { start: 0, end: deletion.span.start }) +
          sliceBytes(source, {
            start: deletion.span.end,
            end: mapping.byteLength,
          }),
      );
      eq(applyStructure(source, preview), preview.result);
      ok(!preview.result.includes("qb:body"));
      eq(scanSource(preview.result).blocks.map((b) => b.id), [
        "a",
        "keep",
        "keep/paragraph:1",
      ]);
      if (newline === "\r\n") {
        ok(!preview.result.replaceAll("\r\n", "").includes("\n"));
      }
    }
  }
});
Deno.test("element deletion refuses containers, headings, computation, hidden syntax and shifted remaining identities", () => {
  for (
    const [body, blockId] of [
      ["## Nested {#nested}", "nested"],
      ["```{r}\n#| label: producer\nx <- 1\n```", "producer"],
      ["::: {#body}\n`r 1 + 1`\n:::", "body/paragraph:1"],
      ["::: {#body .bento-card}\nLiteral.\n:::", "body/paragraph:1"],
      [":::: {#parent}\n::: {#body}\nLiteral.\n:::\n::::", "body/paragraph:1"],
      ["::: {#body}\nOne.\n\nTwo.\n:::", "body/paragraph:1"],
      ["::: {#body}\n<!-- unrelated -->\nLiteral.\n:::", "body/paragraph:1"],
      [":::: {#body}\nLiteral.\n:::", "body/paragraph:1"],
      ["Literal.", "paragraph@12"],
    ]
  ) {
    refuses(
      () => sourceDeletion(scanSource(frame(body)), blockId),
      "unsafe-element-delete",
    );
  }
  const source =
    "## A {#a}\n\n::: {#body}\nDelete.\n:::\n\nUnpinned survivor.\n";
  refuses(
    () =>
      previewStructure(scanSource(source), [{
        type: "delete-block",
        blockId: "body/paragraph:1",
        confirmed: true,
      }]),
    "unsafe-element-delete",
  );
});
Deno.test("element deletion protects Markdown, encoded HTML and citation references to removed identities", () => {
  for (
    const reference of [
      "See @body.",
      "[See](#body)",
      "[See](<#body>)",
      "[See](#%62ody)",
      "[See][r]\n\n[r]: <#body>",
      '<a href="&#35;body">See</a>',
      '<a href="#%62ody">See</a>',
    ]
  ) {
    const source = frame("::: {#body}\nLiteral.\n:::") + "\n" + reference +
      "\n";
    refuses(
      () => sourceDeletion(scanSource(source), "body/paragraph:1"),
      "shared-reference",
    );
  }
});
Deno.test("element deletion requires explicit confirmation and refuses stale or tampered source plans", () => {
  const source = frame("::: {#body}\nLiteral.\n:::");
  refuses(
    () =>
      previewStructure(scanSource(source), [{
        type: "delete-block",
        blockId: "body/paragraph:1",
        confirmed: false as true,
      }]),
    "confirmation-required",
  );
  const plan = previewStructure(scanSource(source), [{
    type: "delete-block",
    blockId: "body/paragraph:1",
    confirmed: true,
  }]);
  refuses(() => applyStructure(source + "\n", plan), "stale-source");
  const tampered = structuredClone(plan);
  tampered.steps[0].edits[0].span.start--;
  refuses(() => applyStructure(source, tampered), "invalid-preview");
});
