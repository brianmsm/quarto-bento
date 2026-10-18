import {
  adaptRevealDesign,
  MAX_REVEAL_REFERENCE_BYTES,
  readRevealReferenceFile,
  validateRevealDesignMapping,
} from "../src/core/design-adaptation.ts";

function assert(value: unknown, message = "assertion failed"): asserts value {
  if (!value) throw new Error(message);
}
async function rejects(fn: () => unknown | Promise<unknown>, message: string) {
  try {
    await fn();
  } catch (error) {
    assert(
      String(error).includes(message),
      `Expected ${message}, got ${String(error)}`,
    );
    return;
  }
  throw new Error(`Expected failure containing ${message}`);
}
const mapping = {
  version: 1,
  name: "course-bifactor",
  canvas: ".reveal",
  title: "#title",
  body: "#body",
  code: "#code",
  namedStyles: {
    question: { selector: "#question", target: "text" },
    card: { selector: "#card", target: "card" },
  },
  variants: {
    section: {
      selector: "#section",
      title: "#section-title",
      titleFrame: { x: 60, y: 240, w: 1160, h: 160 },
      contentFrame: { x: 60, y: 420, w: 1160, h: 200 },
      decorations: [{
        id: "rule",
        x: 60,
        y: 410,
        w: 1160,
        h: 3,
        fill: "#ffffff",
      }],
    },
  },
};
const fixture = `<!doctype html><html><head>
<style>
:root{--brand:#b42b5c}.reveal{background:#f6f6f6;font:20px/1.5 Arial,sans-serif;color:#172a35}
.reveal h2{font-size:2em;color:var(--brand);font-weight:600;letter-spacing:1px}
#title{color:red}#title{color:var(--brand)!important}
#body{font-size:24px;line-height:36px}#code{font:18px/1.4 monospace;color:#123456}
#question{font-size:28px;color:teal;font-weight:700}
#card{background:rgba(1,2,3,.5);border:2px solid #123456;border-radius:8px;padding:16px;opacity:.9}
#section{background:#b42b5c}#section-title{color:#fff;font-size:48px}
</style>
</head><body><div class="reveal"><div class="slides"><section>
<h2 id="title">A title</h2><p id="body">Body</p><pre id="code">print(1)</pre>
<p id="question">Why?</p><div id="card">Card</div>
</section><section id="section"><h2 id="section-title">Section</h2></section></div></div></body></html>`;

Deno.test("Reveal mapping is strict, explicit, bounded and has no arbitrary selector fallback", async () => {
  assert(validateRevealDesignMapping(mapping).name === "course-bifactor");
  await rejects(
    () => validateRevealDesignMapping({ ...mapping, unexpected: true }),
    "Unexpected mapping field",
  );
  await rejects(
    () => validateRevealDesignMapping({ ...mapping, name: "../bad" }),
    "safe design name",
  );
  await rejects(
    () => validateRevealDesignMapping({ ...mapping, title: "" }),
    "Selectors",
  );
  await rejects(
    () =>
      validateRevealDesignMapping({
        ...mapping,
        accent: "url(https://bad.invalid/)",
      }),
    "INVALID_DESIGN_VALUE",
  );
  await rejects(
    () =>
      validateRevealDesignMapping({ ...mapping, defaultVariant: "missing" }),
    "defaultVariant",
  );
  await rejects(
    () =>
      validateRevealDesignMapping({
        ...mapping,
        variants: {
          bad: {
            selector: "#section",
            titleFrame: { x: 0, y: 0, w: -2, h: 1 },
          },
        },
      }),
    "INVALID_DESIGN_VALUE",
  );
});

Deno.test("Reveal adaptation samples cascade, vars, important, roles, cards and audited variants", async () => {
  const result = await adaptRevealDesign(fixture, mapping);
  const theme = result.package.registry.themes![mapping.name];
  assert(theme.background === "#f6f6f6");
  assert(theme.accent === "#b42b5c");
  assert(theme.styles!.title!.color === "#b42b5c");
  assert(theme.styles!.title!.fontSize === 40);
  assert(theme.styles!.body!.lineHeight === 1.5);
  assert(theme.styles!.code!.fontSize === 18);
  assert(theme.namedStyles!.question.properties.fontSize === 28);
  assert(theme.namedStyles!.card.target === "card");
  assert(theme.namedStyles!.card.properties.fill === "#01020380");
  assert(theme.namedStyles!.card.properties.radius === 8);
  assert(theme.namedStyles!.card.properties.strokeWidth === 2);
  assert(theme.variants!.section.background === "#b42b5c");
  assert(theme.variants!.section.title!.color === "#ffffff");
  assert(theme.variants!.section.titleFrame!.y === 240);
  assert(theme.variants!.section.decorations![0].id === "rule");
  assert(result.report.sourceSha256.length === 64);
  assert(result.report.samples.length === 8);
  assert(result.report.fonts.every((font) => font.embeddedInPackage === false));
  assert(result.report.warnings.some((warning) => warning.includes("Accent")));
  const serialized = JSON.stringify(result.package);
  for (const excluded of ["selector", "<style", "#question", "sourceSha256"]) {
    assert(!serialized.includes(excluded));
  }
});

Deno.test("Quarto embedded percent and base64 CSS retains hierarchy, typography and cascade", async () => {
  const css =
    `:root{--spp-ink:#253b44;--spp-pink:#d51c67}.reveal{font-size:32px;font-family:"Fira Sans",sans-serif;line-height:1.3;color:var(--spp-ink);background:#fafafa}.reveal .slides > section h2{font-size:1.5em;color:white!important;background:var(--spp-ink);font-weight:650}.reveal .slides > section p{font-size:1em}/* </style><script>throw new Error('must remain CSS text')</script> */`;
  const override = `.reveal .slides > section p{color:#116f76!important}`;
  const reference =
    `<!doctype html><html><head><link rel="stylesheet" href="data:text/css,${
      encodeURIComponent(css)
    }"><link rel="stylesheet" href="data:text/css;charset=utf-8;base64,${
      btoa(override)
    }"></head><body><div class="reveal"><div class="slides"><section id="intro"><h2>Title</h2><p>Body text</p></section></div></div></body></html>`;
  const result = await adaptRevealDesign(reference, {
    version: 1,
    name: "quarto-embedded",
    canvas: ".reveal",
    title: "#intro h2",
    body: "#intro p",
    accent: "#d51c67",
  });
  const theme = result.package.registry.themes!["quarto-embedded"];
  assert(theme.fontFamily === "Fira Sans, sans-serif");
  assert(
    theme.styles!.body!.fontSize === 32,
    "Embedded CSS must replace the browser's 16px fallback",
  );
  assert(theme.styles!.title!.fontSize === 48);
  assert(theme.styles!.title!.color === "#ffffff");
  assert(theme.styles!.body!.color === "#116f76");
  assert(theme.background === "#fafafa");
  assert(result.report.excluded.inlinedDataStylesheets === 2);
  assert(result.report.excluded.externalStylesheets === 0);
  assert(
    result.report.excluded.scripts === 0,
    "Decoded CSS must not be reparsed as HTML",
  );
});

Deno.test("Malformed, wrong-MIME and non-UTF8 embedded CSS fail explicitly", async () => {
  for (
    const href of [
      "data:text/css,%GG",
      "data:text/css;base64,!!!",
      "data:text/css;base64,/w==",
      "data:text/javascript,alert(1)",
      "data:text/css;charset=latin1,a{}",
      "data:text/css;charset=us-ascii,%C3%B1{}",
    ]
  ) {
    await rejects(
      () =>
        adaptRevealDesign(
          fixture.replace(
            "</head>",
            `<link rel="stylesheet" href="${href}"></head>`,
          ),
          mapping,
        ),
      "INVALID_EMBEDDED_REVEAL_CSS",
    );
  }
});

Deno.test("Reveal adaptation refuses missing, ambiguous and invalid selectors", async () => {
  await rejects(
    () => adaptRevealDesign(fixture, { ...mapping, title: ".missing" }),
    "MISSING_REVEAL_SELECTOR",
  );
  await rejects(
    () => adaptRevealDesign(fixture, { ...mapping, title: "h2" }),
    "AMBIGUOUS_REVEAL_SELECTOR",
  );
  await rejects(
    () => adaptRevealDesign(fixture, { ...mapping, title: "[" }),
    "INVALID_REVEAL_SELECTOR",
  );
});

Deno.test("Reveal reference is inert: script, event handlers, external CSS and fetches never run", async () => {
  let requests = 0;
  const server = Deno.serve(
    { hostname: "127.0.0.1", port: 0, onListen() {} },
    () => {
      requests++;
      return new Response("body{color:red}");
    },
  );
  try {
    const url = `http://127.0.0.1:${server.addr.port}`;
    const malicious = fixture.replace(
      "</head>",
      `<link rel="stylesheet" href="${url}/external.css"><link rel="stylesheet" href="data:text/css,${
        encodeURIComponent(
          `@import url('${url}/embedded-import.css');#body{background-image:url('${url}/embedded-background.png')}`,
        )
      }"><style>@import url('${url}/import.css');#body{background-image:url('${url}/background.png')}</style><script>fetch('${url}/script');document.querySelector('#title').style.setProperty('color','red','important')</script></head>`,
    )
      .replace(
        '<p id="body">',
        `<img src="${url}/image.png" onerror="fetch('${url}/event')"><iframe src="${url}/frame"></iframe><p id="body" onclick="fetch('${url}/click')">`,
      );
    const result = await adaptRevealDesign(malicious, mapping);
    assert(
      requests === 0,
      `Untrusted reference caused ${requests} network requests`,
    );
    assert(
      result.package.registry.themes![mapping.name].styles!.title!.color ===
        "#b42b5c",
    );
    assert(result.report.excluded.scripts === 1);
    assert(result.report.excluded.externalStylesheets === 1);
    assert(result.report.excluded.cssImports === 2);
    assert(result.report.excluded.inlinedDataStylesheets === 1);
    assert(result.report.excluded.activeElements >= 4);
    assert(
      result.report.warnings.some((warning) =>
        warning.includes("External stylesheets")
      ),
    );
  } finally {
    await server.shutdown();
  }
});

Deno.test("Reveal local file reads are regular UTF-8 and bounded", async () => {
  const dir = await Deno.makeTempDir({ prefix: "qbento-reveal-test-" });
  try {
    const path = `${dir}/reference.html`;
    await Deno.writeTextFile(path, fixture);
    assert(await readRevealReferenceFile(path) === fixture);
    await Deno.symlink(path, `${dir}/link.html`);
    await rejects(
      () => readRevealReferenceFile(`${dir}/link.html`),
      "UNSAFE_REVEAL_REFERENCE",
    );
    await rejects(
      () => readRevealReferenceFile(dir),
      "UNSAFE_REVEAL_REFERENCE",
    );
    await Deno.writeFile(path, new Uint8Array([0xff]));
    await rejects(() => readRevealReferenceFile(path), "UTF-8");
    const oversized = await Deno.open(path, { write: true });
    try {
      await oversized.truncate(MAX_REVEAL_REFERENCE_BYTES + 1);
    } finally {
      oversized.close();
    }
    await rejects(
      () => readRevealReferenceFile(path),
      "UNSAFE_REVEAL_REFERENCE",
    );
    await rejects(
      () =>
        adaptRevealDesign(" ".repeat(MAX_REVEAL_REFERENCE_BYTES + 1), mapping),
      "REVEAL_REFERENCE_TOO_LARGE",
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
