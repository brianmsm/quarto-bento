import { loadDesignRegistry } from "../src/render/registry.ts";
import {
  applyAnnotations,
  previewAnnotations,
} from "../src/source/annotations.ts";
import {
  annotationRegistry,
  annotationRequests,
  originalAnnotationLevel,
} from "../src/core/annotations.ts";
import { canonical, createState } from "../src/state/mod.ts";
import { scanSource } from "../src/source/mod.ts";
function eq(a: unknown, b: unknown) {
  if (canonical(a) !== canonical(b)) {
    throw new Error(`${canonical(a)} != ${canonical(b)}`);
  }
}
async function refuses(fn: () => unknown, code: string) {
  try {
    await fn();
  } catch (e) {
    if (String(e).includes(code) || (e as { code?: string }).code === code) {
      return;
    }
    throw e;
  }
  throw new Error(`Expected ${code}`);
}
const request = {
  slideId: "result",
  features: ["overrides" as const],
  references: [".qbento/state.json" as const],
};
Deno.test("optional annotation patches preserve CRLF Unicode IDs original attributes and semantic content", () => {
  const text =
    '## Resultados β 😀 {#result .original x="10" font-family="Noto Sans"}\r\n\r\n::: {#body}\r\nTexto β.\r\n:::\r\n';
  const plan = previewAnnotations(scanSource(text), "minimal", [request]);
  eq(plan.patches.length, 1);
  eq(plan.patches[0].expected, "");
  eq(plan.patches[0].replacement, " .qbento-design");
  eq(
    applyAnnotations(text, plan),
    text.replace(
      'font-family="Noto Sans"}',
      'font-family="Noto Sans" .qbento-design}',
    ),
  );
  eq(plan.diagnostics, []);
  eq(
    scanSource(plan.result).blocks.map((b) => b.id),
    scanSource(text).blocks.map((b) => b.id),
  );
});
Deno.test("detailed traces reference sidecars without values and none removes only optional traces", () => {
  const text =
    "## Título {#result .custom}\r\n\r\n<!-- qb:body -->\r\nTexto.\r\n";
  const detailed = previewAnnotations(scanSource(text), "detailed", [request]);
  eq(detailed.patches.length, 2);
  const expected = text.replace(".custom}", ".custom .qbento-design}").replace(
    "}\r\n",
    '}\r\n<!-- qbento-design: {"features":["overrides"],"references":[".qbento/state.json"],"slideId":"result","version":1} -->\r\n',
  );
  eq(detailed.result, expected);
  const minimal = previewAnnotations(scanSource(expected), "minimal", [
    request,
  ]);
  eq(minimal.patches.length, 1);
  eq(minimal.result, text.replace(".custom}", ".custom .qbento-design}"));
  eq(previewAnnotations(scanSource(expected), "none", [request]).result, text);
  eq(previewAnnotations(scanSource(expected), "detailed", []).result, text);
});
Deno.test("reserved malformed conflicting and duplicate traces refuse without normalization", async () => {
  for (
    const text of [
      "## T {#result}\n<!-- qbento-design: broken -->\n",
      "## T {#result .qbento-design .qbento-design}\n",
      '## T {#result}\n<!-- qbento-design: {"version":1,"slideId":"wrong","features":["overrides"],"references":[".qbento/state.json"]} -->\n',
      '## T {#result}\nText.\n<!-- qbento-design: {"version":1,"slideId":"result","features":["overrides"],"references":[".qbento/state.json"]} -->\n',
    ]
  ) {
    await refuses(
      () => previewAnnotations(scanSource(text), "none", []),
      "invalid-annotation",
    );
  }
  const literal =
    "## T {#result}\n\n```text\n<!-- qbento-design: broken -->\n```\n";
  eq(previewAnnotations(scanSource(literal), "none", []).result, literal);
});
Deno.test("technical marker identity is retained and optional traces require an existing heading attribute ID", () => {
  const text = "<!-- qb:result -->\n## T\n\n<!-- qb:body -->\nText.\n";
  const plan = previewAnnotations(scanSource(text), "detailed", [request]);
  eq(plan.result, text);
  eq(plan.patches, []);
  eq(plan.diagnostics[0].code, "ANNOTATION_UNPINNED_SLIDE");
});
Deno.test("annotation proof rejects altered patches and stale source", async () => {
  const text = "## T {#result}\n";
  const plan = previewAnnotations(scanSource(text), "minimal", [request]);
  await refuses(() => applyAnnotations(text + "\n", plan), "stale-document");
  const forged = structuredClone(plan);
  forged.patches[0].replacement = " x=900";
  await refuses(() => applyAnnotations(text, forged), "invalid-preview");
});
Deno.test("original YAML configuration is scalar bounded duplicate-safe and isolated from body metadata", async () => {
  const meta = (level: string) => () =>
    Promise.resolve({
      "qbento-annotations": { t: "MetaInlines", c: [{ t: "Str", c: level }] },
    });
  eq(
    await originalAnnotationLevel(
      '---\r\n"qbento-annotations": "detailed" # elección β\r\n---\r\nBody',
      meta("detailed"),
    ),
    "detailed",
  );
  eq(
    await originalAnnotationLevel(
      "---\n'qbento-annotations': 'none'\n---\n",
      meta("none"),
    ),
    "none",
  );
  eq(
    await originalAnnotationLevel(
      "Body\n---\nqbento-annotations: detailed\n---\n",
      () => Promise.reject(new Error("Body metadata must not be parsed")),
    ),
    "minimal",
  );
  let input = "";
  eq(
    await originalAnnotationLevel(
      '---\nqbento-annotations: minimal\n---\n```{r}\nstop("not executed")\n```',
      async (frontmatter) => {
        input = frontmatter;
        return await meta("minimal")();
      },
    ),
    "minimal",
  );
  if (input.includes("stop(")) throw new Error("Body reached metadata parser");
  for (
    const config of [
      "qbento-annotations: none\nqbento-annotations: none",
      '"qbento-annotations": none\nqbento-annotations: none',
      "qbento-annotations: mínimo",
      "qbento-annotations: [none]",
      "qbento-annotations: &choice none",
      "qbento-annotations: |\n  none",
    ]
  ) {
    await refuses(
      () => originalAnnotationLevel(`---\n${config}\n---\n`, meta("none")),
      "INVALID_ANNOTATION_CONFIG",
    );
  }
  await refuses(
    () => originalAnnotationLevel("---\nqbento-annotations: none\n"),
    "INVALID_ANNOTATION_CONFIG",
  );
});
Deno.test("external decorations and global applied theme signal appropriate source slides only", () => {
  const doc = scanSource("## A {#a}\n\n## B {#b}\n");
  const state = createState({
    docId: "d",
    slides: [{ id: "a", elements: [] }, { id: "b", elements: [] }],
  }, {});
  state.bentoOnly.push({
    slideId: "a",
    element: { id: "shape", type: "shape" },
  });
  const result = annotationRequests(doc, state, [], {
    hash: "h",
    activeTheme: "local",
    layouts: [],
  });
  eq(result.map((r) => r.slideId), ["a", "b"]);
  eq(result[0].features, ["decorations", "theme"]);
  eq(result[1].features, ["theme"]);
  eq(
    annotationRequests(doc, createState(state.generatedBaseline, {}), [], {
      hash: "h",
      layouts: ["unused"],
    }),
    [],
  );
});

Deno.test("weak source requests produce omission diagnostics rather than rejecting the plan", () => {
  const doc = scanSource("## T\n\nBody.\n");
  const state = createState({ docId: "d", slides: [] }, {});
  const requests = annotationRequests(doc, state, [], {
    hash: "h",
    activeTheme: "local",
    layouts: [],
  });
  const plan = previewAnnotations(doc, "minimal", requests);
  eq(plan.patches, []);
  eq(plan.result, doc.text);
  eq(plan.diagnostics[0].code, "ANNOTATION_UNPINNED_SLIDE");
});
Deno.test("YAML block text containing the namespace never becomes configuration", async () => {
  eq(
    await originalAnnotationLevel(
      "---\ntitle: |\n  qbento-annotations: none\n---\n",
      () =>
        Promise.resolve({
          title: {
            t: "MetaInlines",
            c: [{ t: "Str", c: "qbento-annotations:" }],
          },
        }),
    ),
    "minimal",
  );
  await refuses(
    () =>
      originalAnnotationLevel(
        "---\nnested:\n  qbento-annotations: none\n---\n",
        () =>
          Promise.resolve({
            nested: {
              t: "MetaMap",
              c: {
                "qbento-annotations": {
                  t: "MetaInlines",
                  c: [{ t: "Str", c: "none" }],
                },
              },
            },
          }),
      ),
    "INVALID_ANNOTATION_CONFIG",
  );
});

Deno.test("invalid UTF-8 registry bytes refuse rather than aliasing an exact source hash", async () => {
  const dir = await Deno.makeTempDir({ prefix: "qbento-annotation-registry-" });
  try {
    await Deno.mkdir(dir + "/.qbento");
    const bytes = new TextEncoder().encode('{"schemaVersion":1,"note":"@"}');
    bytes[bytes.indexOf(64)] = 255;
    await Deno.writeFile(dir + "/.qbento/design.json", bytes);
    await refuses(() => annotationRegistry(dir), "INVALID_DESIGN_REGISTRY");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("unmapped sidecar slide produces explicit omission and no trace with none", () => {
  const doc = scanSource("## T\n\nBody.\n");
  const state = createState(
    { docId: "d", slides: [{ id: "t", elements: [] }] },
    {},
  );
  state.overrides = [{
    target: { slideId: "t" },
    fields: [{ path: ["x"], value: { present: true, value: 100 } }],
  }];
  const requests = annotationRequests(doc, state, [], {
    hash: null,
    layouts: [],
  });
  eq(
    previewAnnotations(doc, "minimal", requests).diagnostics[0].code,
    "ANNOTATION_UNMAPPED_SLIDE",
  );
  eq(previewAnnotations(doc, "none", requests).diagnostics, []);
});
Deno.test("unrelated attributes and reserved text in YAML stay literal and bounded parser limitations are diagnostics", () => {
  const text =
    '---\ntitle: |\n  <!-- qbento-design: broken -->\n---\n\n## T {#result data-note="a\\b"}\n\nBody.\n';
  eq(previewAnnotations(scanSource(text), "none", []).result, text);
  const optional = previewAnnotations(scanSource(text), "minimal", [request]);
  eq(optional.result, text);
  eq(optional.diagnostics[0].code, "ANNOTATION_UNSUPPORTED_ATTRIBUTES");
});

Deno.test("unrelated escaped div attributes do not impose a new parser requirement", () => {
  const doc = scanSource(
    '## T {#result}\n\n::: {#body data-note="a\\b"}\nBody.\n:::\n',
  );
  eq(
    annotationRequests(doc, createState({ docId: "d", slides: [] }, {}), [], {
      hash: null,
      layouts: [],
    }),
    [],
  );
});

Deno.test("annotation registry matches native registry raw-byte hash including UTF-8 BOM", async () => {
  const dir = await Deno.makeTempDir({
    prefix: "qbento-annotation-registry-bom-",
  });
  try {
    await Deno.mkdir(dir + "/.qbento");
    await Deno.writeTextFile(
      dir + "/.qbento/design.json",
      '\uFEFF{"schemaVersion":1}',
    );
    const annotations = await annotationRegistry(dir),
      native = await loadDesignRegistry(dir);
    eq(annotations.hash, native.hash);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("namespace-looking attribute values are literal rather than optional classes", () => {
  const text = '## T {#result data-note="a\\b .qbento-design"}\n\nBody.\n';
  const plan = previewAnnotations(scanSource(text), "none", []);
  eq(plan.result, text);
  eq(plan.diagnostics, []);
});
