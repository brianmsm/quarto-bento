import { applyStructure, previewStructure } from "../src/source/structure.ts";
import { hashSource, scanSource, sliceBytes } from "../src/source/mod.ts";
import { applySync, previewSync } from "../src/core/sync.ts";
import {
  readProject,
  renderProject,
  renderProjectFromAst,
  saveProject,
} from "../src/core/project.ts";
import { canonical, targetKey } from "../src/state/mod.ts";
import { canonicalInlineHtml } from "../src/render/inline.ts";
function eq(a: unknown, b: unknown) {
  if (canonical(a) !== canonical(b)) {
    throw new Error(`${canonical(a)} != ${canonical(b)}`);
  }
}
function ok(value: unknown, message = "assertion failed"): asserts value {
  if (!value) throw new Error(message);
}
async function refuses(fn: () => unknown, code: string) {
  try {
    await fn();
  } catch (e) {
    if ((e as { code?: string }).code === code || String(e).includes(code)) {
      return;
    }
    throw e;
  }
  throw new Error(`Expected ${code}`);
}
const operation = {
  type: "insert-text" as const,
  slideId: "a",
  id: "new-source",
  elementId: "native-text",
  markdown: "Nuevo **β** 😀.",
};
Deno.test("text insertion is one UTF8 byte insertion outside source containers and before the next slide marker", async () => {
  const sources = [
    "## A {#a}\n\n::: {#body}\nOriginal β.\n:::\n\n<!-- qb:b -->\n\n## B\n",
    "## A {#a}\n\n### Detail {#detail}\n\nText.",
    "## A {#a}\n\n```{r}\n#| label: compute\nx <- 3\n```",
    "## A {#a}",
  ];
  for (const source of sources) {
    for (const newline of ["\n", "\r\n"]) {
      const text = source.replaceAll("\n", newline),
        plan = previewStructure(scanSource(text), [operation]);
      eq(plan.steps.length, 1);
      eq(plan.steps[0].edits.length, 1);
      const edit = plan.steps[0].edits[0];
      eq(edit.expected, "");
      eq(edit.span.start, edit.span.end);
      eq(
        plan.result,
        sliceBytes(text, { start: 0, end: edit.span.start }) +
          edit.replacement +
          sliceBytes(text, {
            start: edit.span.end,
            end: scanSource(text).byteLength,
          }),
      );
      const result = applyStructure(text, plan), mapped = scanSource(result);
      eq(
        mapped.blocks.find((b) => b.id === "new-source/paragraph:1")?.slideId,
        "a",
      );
      eq(mapped.blocks.find((b) => b.id === "new-source")?.parentId, undefined);
      if (source.includes("qb:b")) {
        ok(result.indexOf("new-source") < result.indexOf("<!-- qb:b -->"));
      }
      if (text.includes("\r\n")) {
        eq(result.replaceAll("\r\n", "").includes("\n"), false);
      }
      await refuses(() => applyStructure(text + newline, plan), "stale-source");
    }
  }
  for (
    const markdown of [
      "::: {#bad}\nText\n:::",
      '```{r}\nsystem("x")\n```',
      "`r 1+1`",
      "$$\nx\n$$",
      "<!-- qb:bad -->\nText",
      "---\nx: y\n---\nText",
      "One\n\nTwo",
    ]
  ) {
    await refuses(
      () =>
        previewStructure(scanSource(sources[0]), [{ ...operation, markdown }]),
      "invalid-text-insertion",
    );
  }
  for (
    const ending of [
      "\n::: {#open}\nText",
      "\n<!-- open",
      "\n```{r}\nx=1",
      "\n$$\nx",
    ]
  ) {
    await refuses(
      () => previewStructure(scanSource("## A {#a}\n" + ending), [operation]),
      ending.includes("$$") ? "invalid-text-insertion" : "ambiguous-structure",
    );
  }
  for (const elementId of ['bad" x="1', "bad\n:::", "id/child", "1number"]) {
    await refuses(
      () =>
        previewStructure(scanSource(sources[0]), [{ ...operation, elementId }]),
      "invalid-id",
    );
  }
  for (
    const existing of [
      "::: {#new-source}\nOld\n:::",
      "### Old {#new-source}",
      "```{r}\n#| label: new-source\nx=1\n```",
    ]
  ) {
    await refuses(
      () =>
        previewStructure(scanSource("## A {#a}\n\n" + existing), [operation]),
      "duplicate-id",
    );
  }
});
Deno.test("real Quarto text insertion preserves native design identity pending selection and exact CRLF source", async () => {
  const dir = await Deno.makeTempDir({ prefix: "qbento-text-insertion-" }),
    source = dir + "/deck.qmd";
  try {
    const original = [
      "---",
      "engine: knitr",
      "qbento-annotations: none",
      "---",
      "",
      "## A {#a}",
      "",
      "```{r}",
      "#| label: counter",
      "#| include: false",
      "cat('x', file='executions.txt', append=TRUE)",
      "```",
      "",
      "::: {#body}",
      "Original β.",
      ":::",
      "",
      "<!-- qb:b -->",
      "",
      "## B",
      "",
      "::: {#other}",
      "Other.",
      ":::",
    ].join("\r\n");
    await Deno.writeTextFile(source, original);
    const first = await renderProject(source),
      edited = structuredClone(first.state.emitted),
      template = edited.slides[0].elements[1];
    const html =
      'Nuevo <strong>β</strong> <em>dato</em> <s>viejo</s> <code>fit(x)</code> <a href="https://example.org/Case?a=One&amp;b=Two">Fuente</a><br>😀.';
    const added = {
      ...structuredClone(template),
      id: "native-new",
      html,
      x: 433,
      y: 315,
      w: 522,
      h: 170,
      fontSize: 27,
      fontFamily: "serif",
      color: "#123456",
      rotation: 7,
      fx: { enter: "fade-up", enterDur: 0.42, step: 1 },
    };
    edited.slides[0].elements.splice(1, 0, added);
    edited.slides[0].elements.push({
      id: "native-arrow",
      type: "shape",
      shape: "arrow",
      fill: "#156f65",
      x: 99,
      y: 492,
      w: 95,
      h: 31,
    });
    edited.slides[1].elements.push({
      ...structuredClone(added),
      html: "Second pending.",
    });
    const saved = await saveProject(source, edited, first.state.revision);
    eq(saved.pending.length, 2);
    eq(await Deno.readTextFile(source), original);
    const kept = await renderProject(source);
    eq(kept.state.pending.length, 2);
    const selected = kept.state.pending.find((p) => p.target.slideId === "a")!;
    const beforePreview = await Deno.readTextFile(dir + "/.qbento/state.json");
    const plan = await previewSync(source, [selected.id]);
    eq(await Deno.readTextFile(dir + "/executions.txt"), "xx");
    eq(await Deno.readTextFile(source), original);
    eq(await Deno.readTextFile(dir + "/.qbento/state.json"), beforePreview);
    eq(plan.excludedChangeIds.length, 1);
    eq(plan.creationChangeIds, [selected.id]);
    const insertion = plan.structure!.steps[0].edits[0];
    eq(plan.patch.patches, []);
    eq(insertion.expected, "");
    eq(insertion.span.start, insertion.span.end);
    eq(
      plan.result,
      sliceBytes(original, { start: 0, end: insertion.span.start }) +
        insertion.replacement +
        sliceBytes(original, {
          start: insertion.span.end,
          end: scanSource(original).byteLength,
        }),
    );
    ok(
      plan.result.indexOf('bento-element-id="native-new"') <
        plan.result.indexOf("<!-- qb:b -->"),
    );
    const applied = await applySync(source, plan);
    eq(await Deno.readTextFile(applied.sourceBackup), original);
    eq((await readProject(source)).pending.length, 2);
    eq(await Deno.readTextFile(dir + "/executions.txt"), "xx");
    const published = await renderProject(source),
      reopened = await readProject(source);
    eq(reopened.docId, first.state.docId);
    eq(reopened.pending.length, 1);
    eq(reopened.pending[0].target.slideId, "b");
    const actual = published.state.emitted.slides[0].elements.find((e) =>
      e.id === "native-new"
    )!;
    eq(actual, { ...added, html: canonicalInlineHtml(html) });
    eq(
      published.state.emitted.slides[0].elements.map((e) => e.id),
      edited.slides[0].elements.map((e) => e.id),
    );
    const provenance =
      reopened.provenance[targetKey({ slideId: "a", elementId: "native-new" })];
    eq(provenance.origin, "authored");
    ok(String(provenance.semanticId).startsWith("qb-text-"));
    eq(provenance.source?.siblings, 1);
    const second = await previewSync(source);
    await applySync(source, second);
    const done = await renderProject(source);
    eq(done.state.pending.length, 0);
    eq(done.state.docId, first.state.docId);
    eq(
      new Set(
        scanSource(await Deno.readTextFile(source)).blocks.filter((b) =>
          b.kind === "div"
        ).map((b) => b.id),
      ).size,
      4,
    );
    const changed = structuredClone(done.state.emitted);
    changed.slides[0].elements.find((e) => e.id === "native-new")!.html =
      "Edited after acquisition.";
    await saveProject(source, changed, done.state.revision);
    const followup = await previewSync(source);
    eq(followup.structure, undefined);
    eq(followup.patch.patches.length, 1);
    await applySync(source, followup);
    const final = await renderProject(source);
    eq(final.state.pending.length, 0);
    eq(
      final.state.emitted.slides[0].elements.find((e) => e.id === "native-new")!
        .x,
      433,
    );
    eq(await Deno.readTextFile(dir + "/executions.txt"), "xxxxx");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
async function fixture(extra = "", weak = false) {
  const dir = await Deno.makeTempDir({ prefix: "qbento-insert-refusal-" }),
    source = dir + "/deck.qmd";
  const text = "## A {#a}\n\n" +
    (weak ? "Original.\n" : "::: {#body}\nOriginal.\n:::\n") + extra;
  await Deno.writeTextFile(source, text);
  const first = await renderProjectFromAst(source, {
    sourceHash: hashSource(text),
    assetDirectories: [dir],
    ast: {
      meta: {},
      blocks: [
        { t: "Header", c: [2, ["a", [], []], [{ t: "Str", c: "A" }]] },
        ...(weak ? [{ t: "Para", c: [{ t: "Str", c: "Original." }] }] : [{
          t: "Div",
          c: [["body", [], []], [{
            t: "Para",
            c: [{ t: "Str", c: "Original." }],
          }]],
        }]),
      ],
    },
  });
  const edited = structuredClone(first.state.emitted);
  edited.slides[0].elements.push({
    ...structuredClone(edited.slides[0].elements[1]),
    id: "new-native",
    html: "New β.",
  });
  return { dir, source, text, first, edited };
}
Deno.test("text insertion refuses ambiguous grouped unsafe rich content and stale identities without writing source or pending", async () => {
  const f = await fixture();
  try {
    for (
      const [fields, code] of [
        [{ groupId: "card" }, "UNSUPPORTED_TEXT_INSERTION"],
        [{ html: '<font face="serif">new</font>' }, "UNSUPPORTED_HTML"],
        [{ html: '<span id="x">new</span>' }, "UNSUPPORTED_HTML"],
        [{ html: "<script>alert(1)</script>" }, "UNSUPPORTED_HTML"],
        [
          { html: "<code>r system(&quot;x&quot;)</code>" },
          "invalid-text-insertion",
        ],
        [{ html: "::: {#new}" }, "invalid-text-insertion"],
        [{ html: "$$x$$" }, "UNSUPPORTED_MATH"],
        [{ html: "<p>One</p><p>Two</p>" }, "UNSUPPORTED_HTML"],
        [{ html: "Wait..." }, "UNSUPPORTED_TEXT_INSERTION"],
      ] as const
    ) {
      const doc = structuredClone(f.edited);
      Object.assign(doc.slides[0].elements.at(-1)!, fields);
      const saved = await saveProject(
        f.source,
        doc,
        (await readProject(f.source)).revision,
      );
      const bytes = await Deno.readTextFile(f.dir + "/.qbento/state.json");
      await refuses(() => previewSync(f.source), code);
      eq(await Deno.readTextFile(f.source), f.text);
      eq(await Deno.readTextFile(f.dir + "/.qbento/state.json"), bytes);
      eq(saved.pending.length, 1);
    }
    await saveProject(
      f.source,
      f.edited,
      (await readProject(f.source)).revision,
    );
    const plan = await previewSync(f.source);
    await Deno.writeTextFile(
      f.source,
      f.text +
        '\n::: {#external bento-element-id="new-native"}\nExternally added.\n:::\n',
    );
    await refuses(() => previewSync(f.source), "STALE_SOURCE");
    await refuses(() => applySync(f.source, plan), "STALE_SOURCE");
    await Deno.writeTextFile(f.source, f.text);
    const changed = structuredClone(f.edited);
    changed.slides[0].elements.at(-1)!.x = 99;
    await saveProject(
      f.source,
      changed,
      (await readProject(f.source)).revision,
    );
    await refuses(() => applySync(f.source, plan), "STALE_REVISION");
    eq(await Deno.readTextFile(f.source), f.text);
  } finally {
    await Deno.remove(f.dir, { recursive: true });
  }
  const weak = await fixture("", true);
  try {
    await saveProject(weak.source, weak.edited, weak.first.state.revision);
    const plan = await previewSync(weak.source);
    eq(plan.identities?.bindings.length, 1);
    eq(await Deno.readTextFile(weak.source), weak.text);
    await applySync(weak.source, plan);
    const rebuilt = await renderProject(weak.source);
    eq(rebuilt.state.pending.length, 0);
    eq(rebuilt.state.docId, weak.first.state.docId);
    eq(
      rebuilt.state.emitted.slides[0].elements.find((element) =>
        element.id === "new-native"
      )?.html,
      "New β.",
    );
  } finally {
    await Deno.remove(weak.dir, { recursive: true });
  }
  const id = "qb-text-" +
      hashSource(canonical(["a", "new-native"])).slice(0, 24),
    collision = await fixture(`\n::: {#${id}}\nReserved.\n:::\n`);
  try {
    await saveProject(
      collision.source,
      collision.edited,
      collision.first.state.revision,
    );
    await refuses(() => previewSync(collision.source), "duplicate-id");
    eq(await Deno.readTextFile(collision.source), collision.text);
  } finally {
    await Deno.remove(collision.dir, { recursive: true });
  }
});

Deno.test("text insertion composes existing edits slide order and annotations without promoting unapproved changes", async () => {
  const dir = await Deno.makeTempDir({ prefix: "qbento-insert-combined-" }),
    source = dir + "/deck.qmd";
  try {
    const text =
      "## A {#a}\n\n::: {#body}\nOriginal.\n:::\n\n## B {#b}\n\n::: {#other}\nOther.\n:::\n";
    await Deno.writeTextFile(source, text);
    const first = await renderProject(source),
      edited = structuredClone(first.state.emitted);
    edited.slides[0].elements[1].html = "Changed authored paragraph.";
    edited.slides[0].elements.push({
      ...structuredClone(edited.slides[0].elements[1]),
      id: "new-combined",
      html: "New <strong>conclusion</strong>.",
      x: 230,
      y: 380,
    });
    edited.slides.reverse();
    const saved = await saveProject(source, edited, first.state.revision);
    eq(saved.pending.length, 3);
    const plan = await previewSync(source);
    eq(plan.creationChangeIds.length, 1);
    eq(plan.patch.patches.length, 1);
    eq(plan.structure!.operations.map((op) => op.type), [
      "insert-text",
      "reorder-slides",
    ]);
    ok(
      plan.annotations.patches.length > 0,
      "default minimal annotations should remain inspected patches",
    );
    const altered = structuredClone(plan);
    altered.result += "Unreviewed text.";
    await refuses(() => applySync(source, altered), "INVALID_PLAN");
    eq(await Deno.readTextFile(source), text);
    await applySync(source, plan);
    eq((await readProject(source)).pending.length, 3);
    const next = await renderProject(source);
    eq(next.state.pending.length, 0);
    eq(next.state.docId, first.state.docId);
    eq(next.state.emitted.slides.map((s) => s.id), ["b", "a"]);
    eq(
      next.state.emitted.slides[1].elements.find((e) =>
        e.id === "new-combined"
      )!.x,
      230,
    );
    eq(
      next.state.emitted.slides[1].elements.find((e) =>
        e.id === "body/paragraph:1"
      )!.html,
      "Changed authored paragraph.",
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
