import { withHeadlessChromium } from "../src/browser/chromium.ts";
import {
  collectRichTableCandidates,
  type RichTableCandidate,
  richTableHtml,
  snapshotRichTable,
} from "../src/rich/table.ts";
import { executeQuarto } from "../src/render/quarto.ts";
import type { Ast, Node } from "../src/render/types.ts";
import { hashSource, scanSource } from "../src/source/mod.ts";
import { canonical } from "../src/state/json.ts";
function eq(a: unknown, b: unknown) {
  if (canonical(a) !== canonical(b)) {
    throw new Error(`${canonical(a)} != ${canonical(b)}`);
  }
}
function ok(value: unknown, message: string) {
  if (!value) throw new Error(message);
}
async function refuses(action: () => unknown, code: string) {
  try {
    await action();
  } catch (error) {
    if (String(error).includes(code)) return;
    throw error;
  }
  throw new Error(`Expected ${code}`);
}
const qmd = (id: string, code: string) =>
  `---\nengine: knitr\n---\n\n## Results {#results}\n\n::: {#${id}}\n\n\`\`\`{r}\n#| label: ${id}-maker\n#| echo: false\ncat('executed\\n', file='${id}-count.txt', append=TRUE)\n${code}\n\`\`\`\n\n:::\n`;
const source = qmd("rich", "gt::gt(data.frame(N=1))");
const div = (id: string, classes: string[], nodes: Node[]): Node => ({
  t: "Div",
  c: [[id, classes, []], nodes],
});
function fakeAst(): Ast {
  return {
    "pandoc-api-version": [1, 23, 1],
    meta: {},
    blocks: [
      div("rich", [], [div("", ["cell"], [div("", ["cell-output-display"], [
        {
          t: "RawBlock",
          c: [
            "html",
            '<div id="gtid"><style>#gtid table { font-size:16px; }</style>',
          ],
        },
        { t: "Table", c: [["", ["gt_table"], []]] },
        { t: "RawBlock", c: ["html", "</div>"] },
      ])])]),
    ],
  } as unknown as Ast;
}
function nodes(node: Node): Node[] {
  return (node.c as [unknown, Node[]])[1];
}
function edited(
  candidate: RichTableCandidate,
  change: (copy: RichTableCandidate) => void,
) {
  const copy = structuredClone(candidate);
  change(copy);
  copy.source.outputHash = hashSource(canonical(copy.blocks));
  return copy;
}
function withCss(candidate: RichTableCandidate, css: string) {
  return edited(candidate, (copy) => {
    const raw = copy.blocks[0].c as string[];
    const id = raw[1].match(/<div id="([^"]+)"/)![1];
    raw[1] = raw[1].replace("</style>", `#${id} ${css}</style>`);
  });
}
Deno.test("rich table provenance rescans exact source and rejects ambiguous output or borrowed identity", async () => {
  const ast = fakeAst(), doc = scanSource(source);
  const candidate = collectRichTableCandidates(ast, doc)[0];
  eq(candidate.source.sourceId, "rich");
  eq(candidate.source.producerId, "rich-maker");
  eq(candidate.source.slideId, "results");
  const forged = { ...doc, blocks: [], slides: [] };
  eq(collectRichTableCandidates(ast, forged), [candidate]);
  await refuses(
    () => collectRichTableCandidates(ast, { ...doc, text: source + "changed" }),
    "source snapshot hash",
  );
  await refuses(
    () =>
      collectRichTableCandidates(
        ast,
        scanSource(
          source.replace(
            "gt::gt(data.frame(N=1))",
            "gt::gt(data.frame(N=1))\n```\nextra\n```{r}\n#| label: other",
          ),
        ),
      ),
    "UNMAPPED_TABLE_SOURCE",
  );
  const literal = source.replace(
    /```\{r\}[\s\S]*?```/,
    '<div class="gt_table">authored HTML</div>',
  );
  await refuses(
    () => collectRichTableCandidates(ast, scanSource(literal)),
    "UNMAPPED_TABLE_SOURCE",
  );
  for (
    const mutate of [
      (copy: Ast) => copy.blocks.push(structuredClone(copy.blocks[0])),
      (copy: Ast) => nodes(copy.blocks[0]).push({ t: "Para", c: [] }),
      (copy: Ast) =>
        (nodes(copy.blocks[0])[0].c as unknown[][])[0][0] = "borrowed",
      (copy: Ast) =>
        ((nodes(copy.blocks[0])[0].c as unknown[][])[0][1] as string[]).push(
          "extra-style",
        ),
      (copy: Ast) =>
        (nodes(nodes(copy.blocks[0])[0])[0].c as unknown[][])[0][2] = [[
          "style",
          "display:none",
        ]],
    ]
  ) {
    const copy = structuredClone(ast);
    mutate(copy);
    await refuses(
      () => collectRichTableCandidates(copy, doc),
      "UNSUPPORTED_RICH_TABLE",
    );
  }
  await refuses(
    () =>
      collectRichTableCandidates(
        ast,
        scanSource(source.replace("::: {#rich}", "::: {#rich .bento-card}")),
      ),
    "standalone wrapper",
  );
  await refuses(
    () =>
      collectRichTableCandidates(
        ast,
        scanSource(source.replace("{#results}", "")),
      ),
    "explicit stable slide",
  );
  const tampered = structuredClone(candidate);
  tampered.blocks[0].c = ["html", "bad"];
  await refuses(() => richTableHtml(tampered), "receipt mismatch");
});
Deno.test("optional Chromium fails clearly and bounds a stalled capture", async () => {
  await refuses(
    () =>
      withHeadlessChromium(
        { chromium: "/nonexistent/qbento-chromium" },
        () => Promise.resolve(0),
      ),
    "CHROMIUM_REQUIRED",
  );
  const started = performance.now();
  await refuses(
    () =>
      withHeadlessChromium(
        { timeoutMs: 1500 },
        async () => await new Promise(() => {}),
      ),
    "CHROMIUM_TIMEOUT",
  );
  ok(performance.now() - started < 6000, "capture deadline was not bounded");
});
Deno.test("actual gt and gtsummary execute once and capture complete scoped offline PNGs with safe refusal", async (t) => {
  const dir = await Deno.makeTempDir({ prefix: "qbento-rich-test-" });
  try {
    const gt = qmd(
      "rich",
      `dat <- read.csv('data.csv', check.names=FALSE)\ngt::gt(dat) |>\n  gt::tab_header(title=gt::md('**Grouped results**'), subtitle='Measured offline') |>\n  gt::tab_spanner(label='Statistics', columns=c(N, Mean)) |>\n  gt::fmt_number(columns=Mean, decimals=2) |>\n  gt::tab_footnote(footnote='Observed values', locations=gt::cells_column_labels(columns=N)) |>\n  gt::tab_source_note(source_note='Source: local input')`,
    );
    await Deno.writeTextFile(`${dir}/gt.qmd`, gt);
    await Deno.writeTextFile(
      `${dir}/data.csv`,
      "Group,N,Mean\nAlpha,12,3.5\nBeta,5,4.2\n",
    );
    const ast = await executeQuarto(`${dir}/gt.qmd`, `${dir}/gt-build`);
    const [candidate] = collectRichTableCandidates(ast, scanSource(gt));
    let initialHash = "", initialTextHash = "";
    await t.step(
      "gt preserves title spanner footnote all rows and source bytes at 2x",
      async () => {
        const html = await richTableHtml(candidate);
        for (
          const text of [
            "<strong>Grouped results</strong>",
            "Statistics",
            "Observed values",
            "Source: local input",
            "3.50",
          ]
        ) ok(html.includes(text), `missing ${text}`);
        const { png, receipt } = await snapshotRichTable(candidate);
        eq([receipt.rows, receipt.cells], [8, 14]);
        eq(receipt.source.sourceId, "rich");
        eq(receipt.width, 1120);
        ok(receipt.height > 200 && receipt.height <= 534, "unexpected bounds");
        eq(receipt.pixelRatio, 2);
        ok(receipt.minBodyFontSize >= 10, "unreadable body");
        const pngView = new DataView(
          png.buffer,
          png.byteOffset,
          png.byteLength,
        );
        eq([pngView.getUint32(16), pngView.getUint32(20)], [
          receipt.width * 2,
          receipt.height * 2,
        ]);
        eq(receipt.kind, "gt-static-png");
        initialHash = receipt.pngHash;
        initialTextHash = receipt.textHash;
        eq(await Deno.readTextFile(`${dir}/rich-count.txt`), "executed\n");
        eq(await Deno.readTextFile(`${dir}/gt.qmd`), gt);
      },
    );
    await t.step(
      "data-only numeric and special-text changes regenerate from the same original producer",
      async () => {
        await Deno.writeTextFile(
          `${dir}/data.csv`,
          'Group,N,Mean\n"A < B & ""C""",-12,3.75\nMálaga,6,-4.2\n',
        );
        const next = collectRichTableCandidates(
          await executeQuarto(`${dir}/gt.qmd`, `${dir}/gt-build-next`),
          scanSource(gt),
        )[0];
        const html = await richTableHtml(next);
        ok(
          html.includes('A &lt; B &amp; "C"') ||
            html.includes("A &lt; B &amp; &quot;C&quot;"),
          "special characters lost",
        );
        ok(
          html.includes("Málaga") && html.includes("3.75"),
          "changed data missing",
        );
        const { receipt } = await snapshotRichTable(next);
        ok(
          receipt.pngHash !== initialHash &&
            receipt.textHash !== initialTextHash,
          "recompute froze data",
        );
        eq(receipt.source.sourceHash, candidate.source.sourceHash);
        eq(receipt.source.chunkHash, candidate.source.chunkHash);
        eq(
          await Deno.readTextFile(`${dir}/rich-count.txt`),
          "executed\nexecuted\n",
        );
        eq(await Deno.readTextFile(`${dir}/gt.qmd`), gt);
      },
    );
    await t.step(
      "gtsummary retains bold labels missing row groups and footnotes in full",
      async () => {
        const summary = qmd(
          "summary",
          `dat <- data.frame(arm=rep(c('A','B'), each=5), age=c(22,24,NA,26,29,21,27,23,30,32), response=c('Yes','Yes','No','No','Yes','Yes','No','Yes','No','No'))\ngtsummary::tbl_summary(dat, by=arm, missing='ifany') |> gtsummary::bold_labels()`,
        );
        await Deno.writeTextFile(`${dir}/summary.qmd`, summary);
        const summaryCandidate = collectRichTableCandidates(
          await executeQuarto(`${dir}/summary.qmd`, `${dir}/summary-build`),
          scanSource(summary),
        )[0];
        const html = await richTableHtml(summaryCandidate);
        for (
          const text of [
            'style="font-weight: bold">age',
            'style="font-weight: bold">response',
            "Unknown",
            "n (%)",
          ]
        ) ok(html.includes(text), `missing ${text}`);
        const { receipt } = await snapshotRichTable(summaryCandidate);
        eq([receipt.rows, receipt.cells], [14, 40]);
        ok(receipt.height <= 534, "summary clipped");
        eq(await Deno.readTextFile(`${dir}/summary-count.txt`), "executed\n");
        eq(await Deno.readTextFile(`${dir}/summary.qmd`), summary);
      },
    );
    await t.step(
      "external CSS script resources hidden text and clipping are refused instead of stripped",
      async () => {
        const attacks = [
          withCss(
            candidate,
            "table { background-image:url(https://example.invalid/private); }",
          ),
          withCss(
            candidate,
            'table { background-image:url("data:image/svg+xml,<svg onload=alert(1) />"); }',
          ),
          withCss(
            candidate,
            'table { font-family:evil; } @import url("https://fonts.googleapis.com/css?family=Roboto");',
          ),
          withCss(candidate, "table { color: \\72 ed; }"),
          withCss(candidate, "td { display:none; }"),
          withCss(candidate, "td { visibility:hidden; }"),
          withCss(candidate, "td { font-size:8px!important; }"),
          withCss(candidate, "sup { font-size:1px!important; }"),
          withCss(candidate, "table { transform:scale(.1); }"),
          withCss(
            candidate,
            "table { scale:0.01; transform-origin:top left; }",
          ),
          withCss(candidate, "table { rotate:15deg; }"),
          withCss(candidate, "table { translate:10px; }"),
          withCss(candidate, "table { zoom:0.01; }"),
          withCss(candidate, "td { color:transparent!important; }"),
          withCss(candidate, "td { -webkit-text-fill-color:transparent; }"),
          withCss(candidate, "table { font-size:90px!important; }"),
          withCss(candidate, 'table::after { content:"unmeasured"; }'),
          edited(candidate, (c) => {
            const r = c.blocks[0].c as string[];
            r[1] = r[1].replace("</style>", "body {display:none}</style>");
          }),
          edited(candidate, (c) => {
            const r = c.blocks[0].c as string[];
            r[1] += '<script>throw new Error("never execute");</script>';
          }),
          edited(candidate, (c) => {
            const r = c.blocks[0].c as string[];
            r[1] += '<img src="https://example.invalid/private">';
          }),
        ];
        for (const [index, attack] of attacks.entries()) {
          try {
            await refuses(
              () => snapshotRichTable(attack),
              "UNSUPPORTED_RICH_TABLE",
            );
          } catch (error) {
            throw new Error(`Attack ${index}: ${String(error)}`);
          }
        }
        for (const maxHeight of [NaN, Infinity, -1, 0, 535, 200.5]) {
          await refuses(
            () => snapshotRichTable(candidate, { maxHeight }),
            "capture frame height",
          );
        }
        await refuses(
          () => snapshotRichTable(candidate, { maxHeight: 50 }),
          "complete table exceeds",
        );
        const tall = withCss(
          candidate,
          "td { padding-top:100px!important; padding-bottom:100px!important; }",
        );
        await refuses(() => snapshotRichTable(tall), "complete table exceeds");
        const clipped = edited(candidate, (c) => {
          const r = c.blocks[0].c as string[];
          r[1] = r[1].replace("height:auto", "height:40px");
        });
        await refuses(
          () => snapshotRichTable(clipped),
          "UNSUPPORTED_RICH_TABLE",
        );
        eq(
          await Deno.readTextFile(`${dir}/rich-count.txt`),
          "executed\nexecuted\n",
        );
      },
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
