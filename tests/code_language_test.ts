import {
  readProject,
  renderProject,
  saveProject,
} from "../src/core/project.ts";
import { applySync, previewSync } from "../src/core/sync.ts";
import { canonical } from "../src/state/mod.ts";
import { hashSource, scanSource } from "../src/source/mod.ts";
import {
  applyCodeLanguages,
  codeLanguageSyntax,
  previewCodeLanguages,
} from "../src/source/code-language.ts";
function ok(v: unknown, m = "assertion failed"): asserts v {
  if (!v) throw new Error(m);
}
function eq(a: unknown, b: unknown) {
  ok(canonical(a) === canonical(b), canonical(a) + " != " + canonical(b));
}
async function rejects(fn: () => unknown, code: string) {
  try {
    await fn();
  } catch (e) {
    ok(
      String(e).includes(code) || (e as { code?: string }).code === code,
      String(e),
    );
    return;
  }
  throw new Error("Expected " + code);
}
Deno.test("language token codec preserves body, IDs, attributes, fence and CRLF without executable promotion", async () => {
  for (
    const opener of [
      "```r",
      "~~~r",
      "```{.r}",
      '```{#shown .r font-size="20"}',
      '```{.r #shown font-size="20"}',
    ]
  ) {
    const raw = opener + '\r\nfile.create("NEVER")\r\n' + opener.slice(0, 3) +
        "\r\n",
      doc = scanSource(raw),
      block = doc.blocks.find((b) => b.kind === "code")!;
    for (const language of ["py", null]) {
      const p = previewCodeLanguages(doc, [{
        blockId: block.id,
        expected: "r",
        language,
      }]);
      eq(applyCodeLanguages(raw, p), p.result);
      eq(scanSource(p.result).blocks[0].kind, "code");
      eq(scanSource(p.result).blocks[0].content, block.content);
      eq(codeLanguageSyntax(p.result).grammar, language);
      ok(p.result.includes('file.create("NEVER")\r\n'));
      if (opener.includes("#shown")) {
        ok(p.result.includes("#shown") && p.result.includes('font-size="20"'));
      }
    }
  }
  for (
    const bad of ["{r}", "r,eval=true", "r\n```{r}", "python", "R", " js", null]
  ) {
    if (bad === null) continue;
    await rejects(
      () =>
        previewCodeLanguages(scanSource("```r\nx\n```\n"), [{
          blockId: "code@0",
          expected: "r",
          language: bad,
        }]),
      "unsupported-code-language",
    );
  }
  await rejects(
    () =>
      previewCodeLanguages(scanSource("```{r}\nx\n```\n"), [{
        blockId: "chunk@0",
        expected: "r",
        language: "py",
      }]),
    "unsupported-code-language",
  );
});
Deno.test("weak displayed code language/body partial reviews retain pending edits and exact source-only rebuild", async () => {
  const dir = await Deno.makeTempDir({ prefix: "qbento-language-weak-" }),
    source = dir + "/deck.qmd";
  const original =
    '## Code β\r\n\r\n```r\r\nfile.create("NEVER")\r\nx <- 1\r\n```\r\n';
  try {
    await Deno.writeTextFile(source, original);
    const first = (await renderProject(source)).state,
      edited = structuredClone(first.emitted),
      code = edited.slides[0].elements.find((e) => e.type === "code")!;
    code.grammarName = "py";
    code.content = 'file.create("NEVER")\nx <- 2';
    code.x = 333;
    const saved = await saveProject(source, edited, first.revision);
    eq(await Deno.readTextFile(source), original);
    eq(saved.pending.length, 2);
    const onlyLanguage = saved.pending.filter((p) =>
        p.path[0] === "grammarName"
      ).map((p) => p.id),
      plan = await previewSync(source, onlyLanguage);
    ok(plan.identities && plan.languages);
    eq(plan.languages.patches.length, 1);
    ok(plan.result.includes('```py\r\nfile.create("NEVER")\r\nx <- 1\r\n'));
    eq(plan.excludedChangeIds.length, 1);
    const forged = structuredClone(plan);
    forged.languages!.patches[0].replacement = "{r}";
    forged.planHash = hashSource(
      canonical(Object.fromEntries(
        Object.entries(forged).filter(([k]) => k !== "planHash"),
      )),
    );
    await rejects(() => applySync(source, forged), "INVALID_PLAN");
    eq(await Deno.readTextFile(source), original);
    await applySync(source, plan);
    let state = (await renderProject(source)).state;
    eq(state.emitted, edited);
    eq(state.pending.length, 1);
    await applySync(source, await previewSync(source));
    state = (await renderProject(source)).state;
    eq(state.pending, []);
    eq(state.emitted, edited);
    eq(state.docId, first.docId);
    const clone = dir + "/clone";
    await Deno.mkdir(clone + "/.qbento", { recursive: true });
    for (
      const name of ["deck.qmd", ".qbento/state.json", ".qbento/project.json"]
    ) await Deno.copyFile(dir + "/" + name, clone + "/" + name);
    const cold = (await renderProject(clone + "/deck.qmd")).state;
    eq(cold.emitted, edited);
    eq(cold.docId, first.docId);
    eq(cold.pending, []);
    await rejects(() => Deno.stat(dir + "/NEVER"), "No such file");
    await rejects(() => Deno.stat(clone + "/NEVER"), "No such file");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
Deno.test("identified displayed code simultaneously syncs body/language and clears sole class with explicit empty normalization", async () => {
  const dir = await Deno.makeTempDir({ prefix: "qbento-language-attrs-" }),
    source = dir + "/deck.qmd";
  try {
    for (const opener of ['```{#shown .r font-size="20"}', "```{.r}"]) {
      const original = "## Code {#code}\r\n\r\n" + opener +
        "\r\nx <- 1\r\n```\r\n";
      await Deno.writeTextFile(source, original);
      await Deno.remove(dir + "/.qbento", { recursive: true }).catch(() => {});
      await Deno.remove(dir + "/deck.bento.html").catch(() => {});
      const first = (await renderProject(source)).state,
        edited = structuredClone(first.emitted),
        code = edited.slides[0].elements.find((e) => e.type === "code")!;
      code.content = "x <- 2";
      code.grammarName = "sql";
      const saved = await saveProject(source, edited, first.revision);
      eq(saved.pending.length, 2);
      const p = await previewSync(source);
      ok(p.result.includes(".sql") && p.result.includes("x <- 2\r\n"));
      if (opener.includes("#shown")) {
        ok(p.result.includes('{#shown .sql font-size="20"}'));
      }
      await applySync(source, p);
      let state = (await renderProject(source)).state;
      eq(state.emitted, edited);
      eq(state.pending, []);
      const clear = structuredClone(state.emitted);
      clear.slides[0].elements.find((e) => e.id === code.id)!.grammarName = "";
      await saveProject(source, clear, state.revision);
      const empty = await previewSync(source);
      eq(empty.normalizations.length, 1);
      eq(empty.normalizations[0].after, { present: false });
      ok(!empty.result.includes(".sql"));
      await applySync(source, empty);
      state = (await renderProject(source)).state;
      ok(
        !("grammarName" in
          state.emitted.slides[0].elements.find((e) => e.id === code.id)!),
      );
      eq(state.pending, []);
      ok(
        scanSource(await Deno.readTextFile(source)).blocks.every((b) =>
          b.kind !== "chunk"
        ),
      );
    }
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
Deno.test("displayed language source drift and stale/forged plans preserve saved pending edits", async () => {
  const dir = await Deno.makeTempDir({ prefix: "qbento-language-stale-" }),
    source = dir + "/deck.qmd",
    original = "## Code {#code}\n\n```{#shown .r}\nx <- 1\n```\n";
  try {
    await Deno.writeTextFile(source, original);
    const first = (await renderProject(source)).state,
      edit = structuredClone(first.emitted);
    edit.slides[0].elements.find((e) => e.type === "code")!.grammarName = "py";
    await saveProject(source, edit, first.revision);
    const p = await previewSync(source),
      stateBytes = await Deno.readFile(dir + "/.qbento/state.json");
    await Deno.writeTextFile(source, original.replace(".r", ".sql"));
    await rejects(() => previewSync(source), "SOURCE_CONFLICT");
    await rejects(() => applySync(source, p), "STALE_SOURCE");
    eq(await Deno.readFile(dir + "/.qbento/state.json"), stateBytes);
    eq((await readProject(source)).pending.length, 1);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

import { startStudio } from "../src/studio/server.ts";
import { withHeadlessChromium } from "../src/browser/chromium.ts";
import { DISPLAYED_CODE_LANGUAGES } from "../src/source/code-language.ts";
Deno.test("native pinned language selector saves, reviews its exact token and regenerates non-executable code", async () => {
  const dir = await Deno.makeTempDir({ prefix: "qbento-language-native-" }),
    source = dir + "/deck.qmd";
  const original =
    '## Code\n\n```r\nfile.create("NEVER")\ndef answer():\n    return 2\n```\n';
  await Deno.writeTextFile(source, original);
  const first = (await renderProject(source)).state,
    code = first.emitted.slides[0].elements.find((e) => e.type === "code")!,
    studio = await startStudio(source);
  try {
    await withHeadlessChromium({}, async (browser) => {
      const evaluate = async <T>(expression: string): Promise<T> => {
        const r = await browser.send<
          { result: { value: T }; exceptionDetails?: unknown }
        >("Runtime.evaluate", {
          expression,
          awaitPromise: true,
          returnByValue: true,
        });
        ok(!r.exceptionDetails, JSON.stringify(r.exceptionDetails));
        return r.result.value;
      };
      const wait = (condition: string) =>
        evaluate(
          `(async()=>{for(let n=0;n<300;n++){if(${condition})return true;await new Promise(r=>setTimeout(r,25));}throw new Error('native wait '+${
            JSON.stringify(condition)
          });})()`,
        );
      await browser.send("Emulation.setDeviceMetricsOverride", {
        width: 1440,
        height: 1000,
        deviceScaleFactor: 1,
        mobile: false,
      });
      await browser.send("Page.navigate", { url: studio.url });
      await wait(
        `!document.getElementById('save').disabled && document.getElementById('editor').contentWindow.bento?.doc && !document.getElementById('editor').contentDocument.getElementById('bento-splash')`,
      );
      const point = await evaluate<{ x: number; y: number }>(
        `(()=>{const f=document.getElementById('editor'),e=f.contentDocument.querySelector('.ed-stage-scale [data-el-id="${code.id}"]'),a=f.getBoundingClientRect(),b=e.getBoundingClientRect();return{x:a.left+b.left+b.width/2,y:a.top+b.top+b.height/2};})()`,
      );
      await browser.send("Input.dispatchMouseEvent", {
        type: "mousePressed",
        button: "left",
        clickCount: 1,
        ...point,
      });
      await browser.send("Input.dispatchMouseEvent", {
        type: "mouseReleased",
        button: "left",
        clickCount: 1,
        ...point,
      });
      const languageSelector =
        `[...document.getElementById('editor').contentDocument.querySelectorAll('.ed-props select')].find(s=>[...s.options].some(o=>o.value==='py')&&[...s.options].some(o=>o.value==='r'))`;
      await wait(`!!(${languageSelector})`);
      const names = await evaluate<string[]>(
        `[...(${languageSelector}).options].map(o=>o.value)`,
      );
      eq(
        names,
        [
          ...[...DISPLAYED_CODE_LANGUAGES].filter((n) =>
            n !== "diff" && n !== "md"
          ).sort(),
          "diff",
          "md",
        ],
      );
      await evaluate(
        `(()=>{const select=${languageSelector};select.value='py';select.dispatchEvent(new Event('change',{bubbles:true}));})()`,
      );
      await wait(
        `document.getElementById('editor').contentWindow.bento.doc.slides[0].elements.find(e=>e.id==='${code.id}').grammarName==='py'`,
      );
      await evaluate(`document.getElementById('save').click()`);
      await wait(
        `document.getElementById('status').textContent==='Proyecto guardado'`,
      );
      eq(await Deno.readTextFile(source), original);
      await evaluate(`document.getElementById('review').click()`);
      await wait(
        `document.getElementById('review-dialog').open && !document.getElementById('apply').disabled`,
      );
      const review = await evaluate<string>(
        `document.getElementById('patches').innerText`,
      );
      ok(
        review.includes("Lenguaje del código") &&
          review.includes("QMD completo propuesto") && review.includes("```py"),
      );
      await evaluate(`document.getElementById('apply').click()`);
      await wait(
        `document.getElementById('sync-note').textContent.startsWith('Cambios aplicados al QMD.')`,
      );
      await evaluate(`document.getElementById('close').click()`);
      await evaluate(`document.getElementById('render').click()`);
      await wait(
        `document.getElementById('status').textContent==='Proyecto abierto' && !document.getElementById('render').disabled`,
      );
      const state = await readProject(source);
      eq(state.pending, []);
      eq(state.docId, first.docId);
      eq(
        state.emitted.slides[0].elements.find((e) => e.id === code.id)!
          .grammarName,
        "py",
      );
      eq(
        state.emitted.slides[0].elements.find((e) => e.id === code.id)!.content,
        code.content,
      );
      ok((await Deno.readTextFile(source)).includes("```py\n"));
      await rejects(() => Deno.stat(dir + "/NEVER"), "No such file");
      await wait(
        "!document.getElementById('editor').contentDocument.getElementById('bento-splash')",
      );
      await evaluate(
        "document.getElementById('editor').contentDocument.fonts.ready.then(()=>true)",
      );
      const tokens = await evaluate<{ text: string; pythonKeyword: boolean }>(
        `(()=>{const node=document.getElementById('editor').contentDocument.querySelector('.ed-stage-scale [data-el-id="${code.id}"] pre');return {text:node.textContent,pythonKeyword:[...node.querySelectorAll('span')].some(span=>span.textContent==='def'&&span.style.fontWeight==='600')};})()`,
      );
      eq(tokens.text, code.content);
      ok(
        tokens.pythonKeyword,
        "native py tokenizer must highlight the def keyword",
      );
      const evidence = Deno.env.get("QBENTO_CODE_LANGUAGE_EVIDENCE");
      if (evidence) {
        await Deno.mkdir(evidence, { recursive: true });
        const shot = await browser.send<{ data: string }>(
          "Page.captureScreenshot",
          { format: "png" },
        );
        await Deno.writeFile(
          evidence + "/native-language.png",
          Uint8Array.from(atob(shot.data), (c) => c.charCodeAt(0)),
        );
        await Deno.writeTextFile(
          evidence + "/native-language.json",
          JSON.stringify(
            {
              browser: browser.version,
              selectorIds: names,
              docId: state.docId,
              pending: state.pending.length,
              grammarName: "py",
              bodyUnchanged: true,
            },
            null,
            2,
          ),
        );
      }
    });
  } finally {
    await studio.shutdown();
    await Deno.remove(dir, { recursive: true });
  }
});
Deno.test("identified bento-code permits body-first language review and explicit missing grammar without execution", async () => {
  const dir = await Deno.makeTempDir({ prefix: "qbento-language-wrapper-" }),
    source = dir + "/deck.qmd";
  const original =
    '## Code {#code}\r\n\r\n::: {#wrapper .bento-code font-size="20"}\r\n\r\n~~~{.r}\r\nfile.create("NEVER")\r\nx <- 1\r\n~~~\r\n\r\n:::\r\n';
  try {
    await Deno.writeTextFile(source, original);
    let state = (await renderProject(source)).state;
    const edit = structuredClone(state.emitted),
      code = edit.slides[0].elements.find((e) => e.type === "code")!;
    code.content = 'file.create("NEVER")\nx <- 2';
    code.grammarName = "sql";
    const saved = await saveProject(source, edit, state.revision);
    const plan = await previewSync(
      source,
      saved.pending.filter((c) => c.path[0] === "content").map((c) => c.id),
    );
    ok(!plan.languages);
    ok(plan.result.includes("~~~{.r}\r\n"));
    await applySync(source, plan);
    state = (await renderProject(source)).state;
    eq(state.emitted, edit);
    eq(state.pending.length, 1);
    await applySync(source, await previewSync(source));
    state = (await renderProject(source)).state;
    eq(state.pending, []);
    eq(state.emitted, edit);
    const clear = structuredClone(state.emitted);
    delete clear.slides[0].elements.find((e) => e.id === code.id)!.grammarName;
    await saveProject(source, clear, state.revision);
    const remove = await previewSync(source);
    eq(remove.normalizations, []);
    ok(remove.result.includes("~~~{}\r\n"));
    await applySync(source, remove);
    state = (await renderProject(source)).state;
    eq(state.emitted, clear);
    eq(state.pending, []);
    ok(
      (await Deno.readTextFile(source)).includes(
        '::: {#wrapper .bento-code font-size="20"}',
      ),
    );
    await rejects(() => Deno.stat(dir + "/NEVER"), "No such file");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
Deno.test("computed grammar remains forbidden and invalid literal grammar keeps authored pending recoverable", async () => {
  const dir = await Deno.makeTempDir({ prefix: "qbento-language-forbidden-" }),
    source = dir + "/deck.qmd";
  try {
    const runnable =
      "## Results {#results}\n\n```{r}\n#| label: maker\n#| echo: true\nx <- 1\n```\n";
    await Deno.writeTextFile(source, runnable);
    let state = (await renderProject(source)).state;
    let edit = structuredClone(state.emitted);
    edit.slides[0].elements.find((e) => e.type === "code")!.grammarName = "py";
    await saveProject(source, edit, state.revision);
    await rejects(() => previewSync(source), "SYNC_CONFLICT");
    eq(await Deno.readTextFile(source), runnable);
    await Deno.remove(dir + "/.qbento", { recursive: true });
    await Deno.remove(dir + "/deck.bento.html");
    const original = "## Code {#code}\n\n```r\nx <- 1\n```\n";
    await Deno.writeTextFile(source, original);
    state = (await renderProject(source)).state;
    edit = structuredClone(state.emitted);
    edit.slides[0].elements.find((e) => e.type === "code")!.grammarName =
      "r,eval=true";
    await saveProject(source, edit, state.revision);
    await rejects(() => previewSync(source), "unsupported-code-language");
    eq(await Deno.readTextFile(source), original);
    eq((await readProject(source)).pending.length, 1);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
