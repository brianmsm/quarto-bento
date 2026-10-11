import { plainTable, projectTable } from "../src/render/table.ts";
import {
  authoredTableBlock,
  parsePipeTable,
  tableProducer,
  validateAuthoredTable,
} from "../src/source/table.ts";
import {
  projectAst,
  validateProjectionOrigins,
} from "../src/render/project.ts";
import { scanSource } from "../src/source/mod.ts";
import { renderProject, saveProject } from "../src/core/project.ts";
import { previewSync } from "../src/core/sync.ts";
import { previewReconcile } from "../src/core/reconcile.ts";
import {
  canonical,
  captureEdits,
  compose,
  createState,
  StateStore,
  targetKey,
} from "../src/state/mod.ts";
import { assertProjectDocument } from "../src/render/validate.ts";
import type { Node } from "../src/render/types.ts";
function eq(a: unknown, b: unknown) {
  if (canonical(a) !== canonical(b)) {
    throw new Error(`${canonical(a)} != ${canonical(b)}`);
  }
}
async function refuses(action: () => unknown, code: string) {
  try {
    await action();
  } catch (error) {
    if (
      String(error).includes(code) || (error as { code?: string }).code === code
    ) return;
    throw error;
  }
  throw new Error(`Expected ${code}`);
}
interface Options {
  caption?: boolean;
  span?: number;
  rich?: boolean;
  headerRows?: number;
  footer?: boolean;
  rowHeaders?: number;
  bodies?: number;
  width?: number;
  rowClass?: string;
  rows?: string[][];
}
function table(options: Options = {}): Node {
  const attr = () => ["", [], []];
  const cell = (
    text: string,
  ) => [
    attr(),
    { t: "AlignDefault" },
    options.span ?? 1,
    1,
    text === "" ? [] : [{
      t: "Plain",
      c: options.rich
        ? [{ t: "Strong", c: [{ t: "Str", c: text }] }]
        : [{ t: "Str", c: text }],
    }],
  ];
  const row = (
    cells: string[],
    header = false,
  ) => [
    ["", [options.rowClass ?? (header ? "header" : "odd")], []],
    cells.map(cell),
  ];
  const header = row(["Group", "N"], true),
    rows = (options.rows ?? [["Alpha", "12"], ["Beta", "5"]]).map((r) =>
      row(r)
    );
  return {
    t: "Table",
    c: [
      ["", ["caption-top"], []],
      [
        null,
        options.caption
          ? [{ t: "Plain", c: [{ t: "Str", c: "Caption" }] }]
          : [],
      ],
      [{ t: "AlignLeft" }, { t: "AlignRight" }].map(
        (align) => [
          align,
          options.width === undefined
            ? { t: "ColWidthDefault" }
            : { t: "ColWidth", c: options.width },
        ],
      ),
      [attr(), Array.from({ length: options.headerRows ?? 1 }, () => header)],
      Array.from(
        { length: options.bodies ?? 1 },
        () => [attr(), options.rowHeaders ?? 0, [], rows],
      ),
      [attr(), options.footer ? [row(["Total", "17"])] : []],
    ],
  };
}
const original =
  "## Data {#data}\r\n\r\n::: {#summary}\r\n| Group | N |\r\n| :--- | ---: |\r\n| Alpha | 12 |\r\n| Beta | 5 |\r\n:::\r\n";
Deno.test("plain tables preserve native headers rows alignment weights and escaped cell text", () => {
  const native = projectTable(
    table({ rows: [["<script> & β 😀", ""]] }),
    "summary/table",
  );
  eq(native.type, "table");
  eq(native.header, true);
  eq(native.columns, [{ w: 1 }, { w: 1 }]);
  eq(native.rows, [{
    cells: [{ html: "Group", align: "left" }, { html: "N", align: "right" }],
  }, {
    cells: [{ html: "&lt;script&gt; &amp; β 😀", align: "left" }, {
      html: "",
      align: "right",
    }],
  }]);
  eq(
    projectTable(table({ headerRows: 0, width: 0.5 }), "computed/table").header,
    false,
  );
  eq(
    projectTable(table({ headerRows: 0, width: 0.5 }), "computed/table")
      .columns,
    [{ w: 0.5 }, { w: 0.5 }],
  );
});
Deno.test("table codec refuses every unmapped structural or rich-content feature", async () => {
  for (
    const variant of [
      { caption: true },
      { span: 2 },
      { rich: true },
      { headerRows: 2 },
      { footer: true },
      { rowHeaders: 1 },
      { bodies: 2 },
      { width: 0 },
      { rowClass: "important" },
      { rows: [["ragged"]] },
    ]
  ) await refuses(() => plainTable(table(variant)), "UNSUPPORTED_TABLE");
});
Deno.test("table header is semantic for authored and computed content; long or tall tables refuse before clipping", async () => {
  const element = projectTable(table(), "table");
  eq(element.h, 168);
  const document = {
    docId: "doc",
    slides: [{ id: "slide", elements: [element] }],
  };
  for (const origin of ["authored", "computed"] as const) {
    const state = createState(document, {
      [targetKey({ slideId: "slide", elementId: "table" })]: { origin },
    });
    const edited = structuredClone(document);
    edited.slides[0].elements[0].header = false;
    const saved = captureEdits(state, edited);
    eq(saved.pending.length, 1);
    eq(saved.pending[0].path, ["header"]);
    eq(saved.pending[0].origin, origin);
    eq(
      saved.pending[0].status,
      origin === "computed" ? "conflict" : "bento-ahead",
    );
    eq(saved.overrides.length, 0);
    // Fresh source structure participates in the baseline; header is never a
    // retained visual override masking a changed generated TableHead.
    const sourceChanged = structuredClone(document);
    sourceChanged.slides[0].elements[0].header = false;
    const fresh = compose(state, sourceChanged);
    eq(fresh.document.slides[0].elements[0].header, false);
    eq(fresh.state.generatedBaseline.slides[0].elements[0].header, false);
    eq(fresh.state.pending.length, 0);
    if (origin === "computed") {
      await refuses(() => compose(saved, document), "MERGE_CONFLICT");
    } else {
      eq(compose(saved, document).state.pending[0].path, ["header"]);
      eq(compose(saved, sourceChanged).state.pending.length, 0);
    }
  }
  await refuses(
    () =>
      projectTable(
        table({ rows: [["Long wrapping cell text that cannot fit", "1"]] }),
        "table",
      ),
    "UNSUPPORTED_TABLE_LAYOUT",
  );
  await refuses(
    () =>
      projectTable(
        table({ rows: Array.from({ length: 20 }, () => ["A", "1"]) }),
        "table",
      ),
    "UNSUPPORTED_TABLE_LAYOUT",
  );
});
Deno.test("authored table provenance independently verifies original cells alignment and a unique wrapper", async () => {
  const doc = scanSource(original),
    block = authoredTableBlock(doc, "summary"),
    element = projectTable(table(), "summary/table");
  eq(block.kind, "unsupported");
  eq(validateAuthoredTable(doc, block.id, element).id, block.id);
  const wrong = projectTable(
    table({ rows: [["Alpha", "999"], ["Beta", "5"]] }),
    "summary/table",
  );
  await refuses(
    () => validateAuthoredTable(doc, block.id, wrong),
    "UNMAPPED_TABLE_SOURCE",
  );
  const tampered = structuredClone(doc);
  tampered.blocks.find((b) => b.id === block.id)!.content = block.content
    .replace("12", "999");
  await refuses(
    () => validateAuthoredTable(tampered, block.id, wrong),
    "UNMAPPED_TABLE_SOURCE",
  );
  for (
    const source of [
      original.replace("::: {#summary}", "::: {}"),
      original.replace(
        "| Alpha | 12 |",
        "Extra paragraph.\r\n\r\n| Alpha | 12 |",
      ),
      original.replace("| Alpha | 12 |", "| Alpha | `r 1 + 1` |"),
    ]
  ) {
    await refuses(
      () => authoredTableBlock(scanSource(source), "summary"),
      "UNMAPPED_TABLE_SOURCE",
    );
  }
  eq(
    parsePipeTable("| Text | N |\n| :--- | ---: |\n| A \\| B | 1 |\n")
      .rows[1][0].text,
    "A | B",
  );
});
Deno.test("computed table producer requires original executable evidence rather than a reused identity", async () => {
  const source =
    "## Data {#data}\n\n::: {#computed}\n```{r}\n#| label: maker\nknitr::kable(data.frame(x=1), format='pipe')\n```\n:::\n";
  eq(tableProducer(scanSource(source), "computed").id, "maker");
  eq(tableProducer(scanSource(source), "maker").kind, "chunk");
  for (
    const text of [
      source.replace("```{r}", "```{#maker .r}").replace(
        "#| label: maker\n",
        "",
      ),
      source.replace("```\n:::", "```\n\nExtra.\n:::"),
      source.replace(
        "```\n:::",
        "```\n\n```{r}\n#| label: other\nx <- 2\n```\n:::",
      ),
    ]
  ) {
    await refuses(
      () => tableProducer(scanSource(text), "computed"),
      "UNMAPPED_TABLE_SOURCE",
    );
  }
});
Deno.test("executed authored table cannot borrow unsupported provenance by ID alone", async () => {
  const source = scanSource(original);
  const ast = {
    meta: {},
    blocks: [{
      t: "Header",
      c: [2, ["data", [], []], [{ t: "Str", c: "Data" }]],
    }, { t: "Div", c: [["summary", [], []], [table()]] }],
  };
  const result = validateProjectionOrigins(
    source,
    await projectAst(ast, "doc", [], source),
  );
  eq(result.origins.data["summary/table"], {
    origin: "authored",
    sourceId: "summary/unsupported:1",
  });
  const changed = scanSource(original.replace("12", "13"));
  await refuses(
    () => projectAst(ast, "doc", [], changed),
    "UNMAPPED_TABLE_SOURCE",
  );
  await refuses(
    () => projectAst({ meta: {}, blocks: [table()] }, "doc", [], source),
    "UNMAPPED_TABLE_SOURCE",
  );
});
Deno.test("multiple computed tables from one producer refuse unstable positional identity", async () => {
  const source = scanSource(
    "## Data {#data}\n\n::: {#computed}\n```{r}\n#| label: maker\n#| echo: false\nx <- 1\n```\n:::\n",
  );
  await refuses(() =>
    projectAst(
      {
        meta: {},
        blocks: [{
          t: "Div",
          c: [["computed", ["cell"], []], [table(), table()]],
        }],
      },
      "doc",
      [],
      source,
    ), "UNSUPPORTED_TABLE");
});
const canRun =
  (await Deno.permissions.query({ name: "run" })).state === "granted";
Deno.test({
  name:
    "real authored pipe table renders natively and retains pending cell edits without source rewriting",
  ignore: !canRun,
  fn: async () => {
    const dir = await Deno.makeTempDir({ prefix: "qbento-authored-table-" });
    try {
      const path = dir + "/deck.qmd";
      await Deno.writeTextFile(path, original);
      const first = await renderProject(path),
        native = first.state.emitted.slides[0].elements.find((e) =>
          e.type === "table"
        )!;
      assertProjectDocument(first.state.emitted);
      eq(native.rows, projectTable(table(), "x").rows);
      const provenance = first.state
        .provenance[targetKey({ slideId: "data", elementId: native.id })];
      eq(provenance.origin, "authored");
      eq(provenance.source?.kind, "unsupported");
      eq(provenance.source?.parentId, "summary");
      const edited = structuredClone(first.state.emitted),
        element = edited.slides[0].elements.find((e) => e.id === native.id)!;
      element.x = 222;
      element.rows =
        projectTable(table({ rows: [["Alpha", "999"], ["Beta", "5"]] }), "x")
          .rows;
      const saved = await saveProject(path, edited, first.state.revision);
      eq(saved.pending.length, 1);
      eq(saved.pending[0].origin, "authored");
      await refuses(() => previewSync(path), "UNSUPPORTED_SYNC");
      eq(await Deno.readTextFile(path), original);
      const reopened = await new StateStore(dir + "/.qbento").load();
      eq(reopened?.pending, saved.pending);
      const retained = await renderProject(path);
      eq(
        retained.state.emitted.slides[0].elements.find((e) =>
          e.id === native.id
        )!.rows,
        element.rows,
      );
      eq(retained.state.pending.length, 1);
      await Deno.writeTextFile(
        path,
        original.replace("| Beta | 5 |", "| Beta | 6 |"),
      );
      await refuses(() => renderProject(path), "MERGE_CONFLICT");
      const conflict = await previewReconcile(path);
      eq(conflict.changes[0].change.status, "conflict");
      eq(
        conflict.document.slides[0].elements.find((e) => e.id === native.id)!.x,
        222,
      );
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  },
});
Deno.test({
  name:
    "real knitr pipe table recomputes values while retaining native design and computed provenance",
  ignore: !canRun,
  fn: async () => {
    const dir = await Deno.makeTempDir({ prefix: "qbento-computed-table-" });
    try {
      const path = dir + "/deck.qmd", csv = dir + "/data.csv";
      const text =
        '## Data {#data}\n\n::: {#computed-table}\n```{r}\n#| label: table-maker\n#| echo: false\nknitr::kable(read.csv("data.csv"), format="pipe", align=c("l", "r"))\n```\n:::\n';
      await Deno.writeTextFile(path, text);
      await Deno.writeTextFile(csv, "Group,N\nAlpha,12\nBeta,5\n");
      const first = await renderProject(path),
        native = first.state.emitted.slides[0].elements.find((e) =>
          e.type === "table"
        )!;
      assertProjectDocument(first.state.emitted);
      const provenance = first.state
        .provenance[targetKey({ slideId: "data", elementId: native.id })];
      eq(provenance.origin, "computed");
      eq(provenance.producer, "table-maker");
      const edited = structuredClone(first.state.emitted),
        element = edited.slides[0].elements.find((e) => e.id === native.id)!;
      element.x = 240;
      element.w = 900;
      element.h = 220;
      element.style = {
        ...(element.style as Record<string, string | number>),
        fontSize: 22,
        headerBg: "#156f65",
      };
      const saved = await saveProject(path, edited, first.state.revision);
      eq(saved.pending.length, 0);
      await Deno.writeTextFile(csv, "Group,N\nAlpha,30\nBeta,5\n");
      const next = await renderProject(path),
        current = next.state.emitted.slides[0].elements.find((e) =>
          e.id === native.id
        )!;
      eq(current.x, 240);
      eq(current.w, 900);
      eq(current.h, 220);
      eq(current.style, element.style);
      eq(
        current.rows,
        projectTable(table({ rows: [["Alpha", "30"], ["Beta", "5"]] }), "x")
          .rows,
      );
      const manipulated = structuredClone(next.state.emitted);
      manipulated.slides[0].elements.find((e) => e.id === native.id)!.rows =
        native.rows;
      const pending = await saveProject(path, manipulated, next.state.revision);
      eq(pending.pending[0].origin, "computed");
      eq(pending.pending[0].status, "conflict");
      await refuses(() => previewSync(path), "SYNC_CONFLICT");
      eq(await Deno.readTextFile(path), text);
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  },
});
Deno.test({
  name:
    "real table captions and rich cells refuse instead of dropping semantic content",
  ignore: !canRun,
  fn: async () => {
    for (
      const content of [
        original.replace("Alpha", "**Alpha**"),
        original.replace(":::\r\n", "\r\n: Caption\r\n:::\r\n"),
        original.replace("Group", "[Group](https://example.org)"),
      ]
    ) {
      const dir = await Deno.makeTempDir({ prefix: "qbento-table-refusal-" });
      try {
        const path = dir + "/deck.qmd";
        await Deno.writeTextFile(path, content);
        await refuses(
          () => renderProject(path),
          content.includes("Caption")
            ? "UNMAPPED_TABLE_SOURCE"
            : "UNSUPPORTED_TABLE",
        );
        eq(await Deno.readTextFile(path), content);
      } finally {
        await Deno.remove(dir, { recursive: true });
      }
    }
  },
});
