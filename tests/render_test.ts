import { extractDocument, spliceDocument } from "../src/render/html.ts";
import { projectAst } from "../src/render/project.ts";
import type { Ast, BentoDoc } from "../src/render/types.ts";
function assert(ok: unknown, message = "assertion failed"): asserts ok {
  if (!ok) throw new Error(message);
}
function throws(fn: () => unknown, code: string) {
  try {
    fn();
  } catch (e) {
    assert(String(e).includes(code));
    return;
  }
  throw new Error("expected " + code);
}
const doc: BentoDoc = {
  format: "bento/slides",
  version: 1,
  docId: "fixed",
  title: "</script><script>alert(1)</script>",
  size: { width: 1280, height: 720 },
  theme: {
    background: "white",
    color: "black",
    accent: "blue",
    fontFamily: "Arial",
  },
  slides: [{ id: "a", elements: [] }],
};
Deno.test("shell splicing escapes script payload and roundtrips without replacement expansion", () => {
  const shell =
    '<html><head></head><script type="application/bento+json" id="bento-doc">{}</script><body>$&</body></html>';
  const html = spliceDocument(shell, doc);
  assert(!html.includes(doc.title));
  assert(extractDocument(html).title === doc.title);
  assert(html.endsWith("<body>$&</body></html>"));
  throws(() => extractDocument(html + html), "INVALID_HTML");
  throws(() => spliceDocument(shell, doc, "</script>"), "INVALID_BOOTSTRAP");
});
Deno.test("untrusted HTML refuses collaboration and duplicate identities", () => {
  const shell = '<script id="bento-doc">{}</script>';
  throws(
    () =>
      extractDocument(
        spliceDocument(shell, {
          ...doc,
          slides: [...doc.slides, ...doc.slides],
        }),
      ),
    "DUPLICATE_ID",
  );
  const edited = { ...doc, collab: { key: "secret" } };
  throws(
    () => extractDocument(spliceDocument(shell, edited)),
    "COLLABORATION_DISABLED",
  );
});
Deno.test("AST projection preserves explicit identities and escapes authored text", async () => {
  const ast: Ast = {
    meta: {},
    blocks: [{
      t: "Header",
      c: [2, ["results", [], []], [{ t: "Str", c: "Title" }]],
    }, {
      t: "Div",
      c: [["finding", [], []], [{
        t: "Para",
        c: [{ t: "Str", c: "<img src=x onerror=alert(1)>" }],
      }]],
    }],
  };
  const p = await projectAst(ast, "fixed", []);
  assert(p.document.docId === "fixed");
  assert(p.document.slides[0].elements[1].id === "finding/paragraph:1");
  assert(String(p.document.slides[0].elements[1].html).startsWith("&lt;img"));
  assert(
    p.origins.results["finding/paragraph:1"].sourceId === "finding/paragraph:1",
  );
});
Deno.test("remote asset refuses an apparently successful offline deck", async () => {
  const ast: Ast = {
    meta: {},
    blocks: [{
      t: "Para",
      c: [{
        t: "Image",
        c: [["picture", [], []], [], ["https://example.org/pic.svg", ""]],
      }],
    }],
  };
  try {
    await projectAst(ast, "fixed", []);
  } catch (e) {
    assert(String(e).includes("EXTERNAL_ASSET"));
    return;
  }
  throw new Error("remote image accepted");
});
Deno.test("projection preserves approved native title and body source marker identities", async () => {
  const ast: Ast = {
    meta: {},
    blocks: [
      {
        t: "Header",
        c: [2, ["native-slide", [], [["bento-title-id", "native-title"]]], [{
          t: "Str",
          c: "Title",
        }]],
      },
      { t: "RawBlock", c: ["html", "<!-- qb:native-body -->"] },
      { t: "Para", c: [{ t: "Str", c: "Body" }] },
    ],
  };
  const projected = await projectAst(ast, "doc", []);
  assert(
    projected.document.slides[0].elements.map((e) => e.id).join(",") ===
      "native-title,native-body",
  );
  assert(
    projected.origins["native-slide"]["native-title"].sourceId ===
      "native-slide",
  );
  assert(
    projected.origins["native-slide"]["native-body"].sourceId === "native-body",
  );
});
Deno.test("computed cell headings retain computed provenance and producer; computed notes refuse authored classification", async () => {
  const ast: Ast = {
    meta: {},
    blocks: [{
      t: "Div",
      c: [["producer", ["cell"], []], [{
        t: "Div",
        c: [["", ["cell-output-display"], []], [{
          t: "Header",
          c: [2, ["computed-title", [], []], [{ t: "Str", c: "Generated" }]],
        }]],
      }]],
    }],
  };
  const projection = await projectAst(ast, "doc", []);
  assert(
    projection.origins["computed-title"]["computed-title-title"].origin ===
      "computed",
  );
  assert(
    projection.origins["computed-title"]["computed-title-title"].producer ===
      "producer",
  );
  const notes: Ast = {
    meta: {},
    blocks: [{
      t: "Div",
      c: [["producer", ["cell"], []], [{
        t: "Div",
        c: [["", ["notes"], []], [{
          t: "Para",
          c: [{ t: "Str", c: "Generated note" }],
        }]],
      }]],
    }],
  };
  let refused = false;
  try {
    await projectAst(notes, "doc", []);
  } catch (error) {
    assert(String(error).includes("COMPUTED_NOTES_UNSUPPORTED"));
    refused = true;
  }
  assert(refused);
});
Deno.test("speaker notes refuse lists and code instead of silently dropping content", async () => {
  for (
    const unsupported of [{
      t: "BulletList",
      c: [[{ t: "Plain", c: [{ t: "Str", c: "Point" }] }]],
    }, { t: "CodeBlock", c: [["", [], []], "x=1"] }]
  ) {
    const ast: Ast = {
      meta: {},
      blocks: [{ t: "Header", c: [2, ["a", [], []], [{ t: "Str", c: "A" }]] }, {
        t: "Div",
        c: [["", ["notes"], []], [
          { t: "Para", c: [{ t: "Str", c: "Kept" }] },
          unsupported,
        ]],
      }],
    };
    let refused = false;
    try {
      await projectAst(ast, "doc", []);
    } catch (error) {
      assert(String(error).includes("UNSUPPORTED_NOTES"));
      refused = true;
    }
    assert(refused);
  }
});
Deno.test("source-aware provenance accepts exact plain QMD and refuses unknown or ambiguous output", async () => {
  const { validateProjectionOrigins, assertSupportedExecutionSource } =
    await import("../src/render/project.ts");
  const { scanSource } = await import("../src/source/mod.ts");
  const ast: Ast = {
    meta: {},
    blocks: [{
      t: "Header",
      c: [2, ["plain-title", [], []], [{ t: "Str", c: "Plain title" }]],
    }, { t: "Para", c: [{ t: "Str", c: "Literal." }] }],
  };
  const p = await projectAst(ast, "doc", []),
    source = scanSource("## Plain title\n\nLiteral.\n");
  const mapped = validateProjectionOrigins(source, p);
  assert(
    mapped.origins["plain-title"]["plain-title-title"].sourceId ===
      source.blocks[0].id,
  );
  assert(
    mapped.origins["plain-title"]["qb-paragraph-1"].sourceId ===
      source.blocks[1].id,
  );
  throws(
    () =>
      validateProjectionOrigins(
        scanSource("## Other title\n\nOther text.\n"),
        p,
      ),
    "UNMAPPED_PROVENANCE",
  );
  throws(
    () =>
      validateProjectionOrigins(
        scanSource("## Plain title\n\nLiteral.\n\nLiteral.\n"),
        p,
      ),
    "UNMAPPED_PROVENANCE",
  );
  throws(
    () =>
      assertSupportedExecutionSource(
        scanSource('```{r}\n#| results: asis\ncat("## Generated")\n```\n'),
      ),
    "UNMAPPED_PROVENANCE",
  );
});
