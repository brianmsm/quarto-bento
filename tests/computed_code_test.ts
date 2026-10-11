import {
  projectAst,
  validateProjectionOrigins,
} from "../src/render/project.ts";
import { scanSource } from "../src/source/mod.ts";
import type { Ast, Node } from "../src/render/types.ts";
function assert(value: unknown, message = "assertion failed"): asserts value {
  if (!value) throw new Error(message);
}
const header = (id: string): Node => ({
  t: "Header",
  c: [2, [id, [], []], [{ t: "Str", c: id }]],
});
const code = (content: string): Node => ({
  t: "CodeBlock",
  c: [["", [], []], content],
});
const div = (id: string, classes: string[], children: Node[]): Node => ({
  t: "Div",
  c: [[id, classes, []], children],
});
const ast = (blocks: Node[]): Ast => ({
  meta: {},
  blocks,
});
Deno.test("computed code IDs count across nested execution wrappers and retain each producer identity", async () => {
  const source = scanSource(
    "## One {#one}\n\n```{r}\n#| label: first\nprint(1)\n```\n\n```{r}\n#| label: second\nprint(2)\n```\n",
  );
  const cell = (id: string) =>
    div(id, ["cell"], [
      code("echo"),
      div("", ["cell-output", "cell-output-stdout"], [
        code("result"),
        div("", ["cell-output"], [code("nested")]),
      ]),
    ]);
  const projected = await projectAst(
    ast([header("one"), cell("first"), cell("second")]),
    "doc",
    [],
    source,
  );
  validateProjectionOrigins(source, projected);
  const ids = projected.document.slides[0].elements.filter((e) =>
    e.type === "code"
  ).map((e) => e.id);
  assert(
    JSON.stringify(ids) ===
      JSON.stringify([
        "first/code:1",
        "first/code:2",
        "first/code:3",
        "second/code:1",
        "second/code:2",
        "second/code:3",
      ]),
  );
  for (const id of ids) {
    assert(projected.origins.one[id].producer === id.split("/")[0]);
  }
});
Deno.test("computed code cannot borrow a producer from another source slide", async () => {
  const source = scanSource(
    "## One {#one}\n\n```{r}\n#| label: first\nprint(1)\n```\n\n## Two {#two}\n\nLiteral.\n",
  );
  const projected = await projectAst(
    ast([
      header("one"),
      header("two"),
      div("first", ["cell"], [code("result")]),
    ]),
    "doc",
    [],
    source,
  );
  try {
    validateProjectionOrigins(source, projected);
  } catch (e) {
    assert(String(e).includes("UNMAPPED_PROVENANCE"));
    return;
  }
  throw new Error("Cross-slide producer was accepted");
});
Deno.test("ambiguous echoed bodies refuse a guessed producer", async () => {
  const source = scanSource(
    "## One {#one}\n\n```{r}\n#| label: first\nprint(1)\n```\n\n```{r}\n#| label: second\nprint(1)\n```\n",
  );
  try {
    const result = await projectAst(
      ast([
        header("one"),
        div("", ["cell"], [{
          t: "CodeBlock",
          c: [["", ["r", "cell-code"], []], "print(1)"],
        }, div("", ["cell-output"], [code("[1] 1")])]),
      ]),
      "doc",
      [],
      source,
    );
    validateProjectionOrigins(source, result);
  } catch (e) {
    assert(String(e).includes("UNMAPPED_PROVENANCE"));
    return;
  }
  throw new Error("Ambiguous source body was accepted");
});
Deno.test("even complete unique or reordered echoes cannot prove an execution producer", async () => {
  const source = scanSource(
    "## One {#one}\n\n```{r}\n#| label: first\nprint(1)\nprint(2)\n```\n",
  );
  for (
    const parts of [["print(1)", "print(2)"], ["print(1)"], [
      "print(2)",
      "print(1)",
    ], ["print(1)", "print(999)"]]
  ) {
    const cell = div(
      "",
      ["cell"],
      parts.flatMap(
        (part) => [code(part), div("", ["cell-output"], [code("result")])],
      ),
    );
    try {
      const result = await projectAst(
        ast([header("one"), cell]),
        "doc",
        [],
        source,
      );
      validateProjectionOrigins(source, result);
    } catch (e) {
      assert(String(e).includes("UNMAPPED_PROVENANCE"));
      continue;
    }
    throw new Error("Displayed code was accepted as a producer proof");
  }
});
