import { resolve } from "node:path";
import { installQuartoProject } from "../src/integration/install.ts";
import { recoverQuartoRender } from "../src/integration/quarto.ts";
import { readProject } from "../src/core/project.ts";

function assert(value: unknown, message = "assertion failed"): asserts value {
  if (!value) throw new Error(message);
}
async function exists(path: string) {
  try {
    await Deno.lstat(path);
    return true;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return false;
    throw error;
  }
}
const base = `---
title: Ordinary producer receipts
engine: knitr
bento-annotations: none
---

## Results {#results}

::: {#authored}
Authored β text.
:::

\`\`\`{r}
#| label: count
#| include: false
cat('execution\\n', file='executions.txt', append=TRUE)
\`\`\`

\`\`\`{r}
#| label: actual
#| echo: !expr c(1,2)
print(1)
print(2)
print(3)
\`\`\`

\`\`\`{r}
#| label: decoy
#| include: false
print(1)
print(2)
\`\`\`

\`\`\`{r}
#| label: later
#| echo: false
print(99)
\`\`\`
`;
async function fixture(text = base) {
  const directory = await Deno.makeTempDir({
    prefix: "qbento ordinary producer ",
  });
  const source = resolve(directory, "deck.qmd");
  await Deno.writeTextFile(source, text);
  await installQuartoProject(source);
  return {
    directory,
    source,
    output: resolve(directory, "deck.bento.html"),
    receipt: resolve(directory, ".qbento/quarto-run.json"),
    manifest: resolve(
      directory,
      ".qbento/quarto-stage/producer-manifest.json",
    ),
    ledger: resolve(directory, ".qbento/quarto-stage/producer-output.jsonl"),
  };
}
async function quarto(
  directory: string,
  args = ["render", "deck.qmd", "--quiet"],
  profile?: string,
  startupArgs?: string,
) {
  const env = Deno.env.toObject();
  for (const name of Object.keys(env)) {
    if (
      name.startsWith("QBENTO_") || name === "R_PROFILE_USER" ||
      name === "QUARTO_KNITR_RSCRIPT_ARGS"
    ) {
      delete env[name];
    }
  }
  if (profile !== undefined) env.R_PROFILE_USER = profile;
  if (startupArgs !== undefined) env.QUARTO_KNITR_RSCRIPT_ARGS = startupArgs;
  env.XDG_CACHE_HOME = resolve(directory, "cache");
  env.QUARTO_RUN_NO_NETWORK = "true";
  const result = await new Deno.Command("quarto", {
    cwd: directory,
    args,
    clearEnv: true,
    env,
    stdout: "piped",
    stderr: "piped",
  }).output();
  return {
    success: result.success,
    stdout: new TextDecoder().decode(result.stdout),
    log: new TextDecoder().decode(result.stdout) +
      new TextDecoder().decode(result.stderr),
  };
}
async function count(directory: string) {
  const path = resolve(directory, "executions.txt");
  return await exists(path)
    ? (await Deno.readTextFile(path)).trim().split("\n").length
    : 0;
}
function test(name: string, fn: () => Promise<void>) {
  Deno.test({ name, ignore: Deno.build.os !== "linux", fn });
}
test("ordinary Quarto assigns partial echo and multiple outputs to their actual chunks once", async () => {
  const f = await fixture();
  try {
    const inspection = await quarto(f.directory, ["inspect", "deck.qmd"]);
    assert(inspection.success, inspection.log);
    assert(JSON.parse(inspection.stdout).engines.join() === "knitr");
    assert(await count(f.directory) === 0, "inspection executed source");
    const result = await quarto(f.directory);
    assert(result.success, result.log);
    assert(await count(f.directory) === 1, "source executed more than once");
    const state = await readProject(f.source);
    const elements = state.emitted.slides[0].elements;
    assert(
      elements.find((e) => e.id === "actual/code:5")?.content === "[1] 3",
      "partial echo falsely selected the hidden decoy",
    );
    assert(elements.find((e) => e.id === "later/code:1")?.content === "[1] 99");
    assert(!elements.some((e) => e.id.startsWith("decoy/")));
    assert(await Deno.readTextFile(f.source) === base);
    for (const path of [f.receipt, f.manifest, f.ledger]) {
      assert(!(await exists(path)), `successful execution retained ${path}`);
    }
  } finally {
    await Deno.remove(f.directory, { recursive: true });
  }
});
test("ordinary Quarto preserves unset, empty and relative user R profiles", async () => {
  const f = await fixture();
  const local = "cat('local\\n', file='profiles.txt', append=TRUE)\n" +
    "writeLines(Sys.getenv('R_PROFILE_USER', unset='<unset>'), 'selected.txt')\n";
  const relative = local.replace("'local\\n'", "'relative\\n'");
  try {
    await Deno.writeTextFile(resolve(f.directory, ".Rprofile"), local);
    await Deno.writeTextFile(resolve(f.directory, "custom.R"), relative);
    let result = await quarto(f.directory);
    assert(result.success, result.log);
    assert(await count(f.directory) === 1);
    assert(
      await Deno.readTextFile(resolve(f.directory, "profiles.txt")) ===
        "local\n",
    );
    assert(
      await Deno.readTextFile(resolve(f.directory, "selected.txt")) ===
        "<unset>\n",
    );
    result = await quarto(f.directory, undefined, "");
    assert(result.success, result.log);
    assert(await count(f.directory) === 2);
    assert(
      await Deno.readTextFile(resolve(f.directory, "profiles.txt")) ===
        "local\n",
    );
    result = await quarto(f.directory, undefined, "custom.R");
    assert(result.success, result.log);
    assert(await count(f.directory) === 3);
    assert(
      await Deno.readTextFile(resolve(f.directory, "profiles.txt")) ===
        "local\nrelative\n",
    );
    assert(
      await Deno.readTextFile(resolve(f.directory, "selected.txt")) ===
        "custom.R\n",
    );
    assert(
      await Deno.readTextFile(resolve(f.directory, ".Rprofile")) === local,
    );
    assert(
      await Deno.readTextFile(resolve(f.directory, "custom.R")) === relative,
    );
    assert(await Deno.readTextFile(f.source) === base);
  } finally {
    await Deno.remove(f.directory, { recursive: true });
  }
});
test("ordinary producer receipts preserve cache and cleanup stopped execution errors", async () => {
  const text = base.replace(
    "engine: knitr",
    "engine: knitr\nexecute:\n  cache: true",
  );
  const f = await fixture(text);
  try {
    let result = await quarto(f.directory);
    assert(result.success, result.log);
    assert(await count(f.directory) === 1);
    const first = await Deno.readTextFile(
      resolve(f.directory, ".qbento/quarto-stage/executed.json"),
    );
    const docId = (await readProject(f.source)).docId;
    result = await quarto(f.directory);
    assert(result.success, result.log);
    assert(
      await count(f.directory) === 1,
      "producer nonce invalidated knitr cache",
    );
    const second = await Deno.readTextFile(
      resolve(f.directory, ".qbento/quarto-stage/executed.json"),
    );
    assert(
      first !== second,
      "cached results reused an earlier execution receipt",
    );
    assert((await readProject(f.source)).docId === docId);
    const previous = await Deno.readTextFile(f.output);
    await Deno.writeTextFile(
      f.source,
      text.replace("print(99)", "stop('activation failure')"),
    );
    result = await quarto(f.directory, ["render", "deck.qmd"]);
    assert(
      !result.success && result.log.includes("activation failure"),
      result.log,
    );
    assert(
      await exists(f.receipt) && await exists(f.manifest) &&
        await exists(f.ledger),
    );
    assert(await Deno.readTextFile(f.output) === previous);
    await recoverQuartoRender(f.source);
    for (const path of [f.receipt, f.manifest, f.ledger]) {
      assert(!(await exists(path)));
    }
    assert(await Deno.readTextFile(f.output) === previous);
    await Deno.writeTextFile(f.source, text);
    result = await quarto(f.directory);
    assert(result.success, result.log);
    assert(await count(f.directory) === 1);
    assert(await Deno.readTextFile(f.source) === text);
  } finally {
    await Deno.remove(f.directory, { recursive: true });
  }
});
test("ordinary Quarto refuses effective user filters before computation and preserves the deck", async () => {
  const f = await fixture();
  try {
    let result = await quarto(f.directory);
    assert(result.success, result.log);
    const previous = await Deno.readTextFile(f.output);
    await Deno.writeTextFile(
      resolve(f.directory, "noop.lua"),
      "function Pandoc(doc) return doc end\n",
    );
    const text = base.replace(
      "engine: knitr",
      "engine: knitr\nfilters: [noop.lua]",
    );
    await Deno.writeTextFile(f.source, text);
    result = await quarto(f.directory);
    assert(
      !result.success && result.log.includes("UNSUPPORTED_COMPUTED_FILTER"),
      result.log,
    );
    assert(await count(f.directory) === 1, "unverified filter executed source");
    assert(!(await exists(f.receipt)));
    assert(await Deno.readTextFile(f.output) === previous);
    assert(await Deno.readTextFile(f.source) === text);
  } finally {
    await Deno.remove(f.directory, { recursive: true });
  }
});
test("ordinary Quarto refuses startup flags that disable producer capture before R", async () => {
  const f = await fixture();
  try {
    const baseline = await quarto(f.directory);
    assert(baseline.success, baseline.log);
    const previous = await Deno.readTextFile(f.output);
    for (
      const flags of ["--vanilla", "--no-init-file", "--no-save,--no-init-file"]
    ) {
      const result = await quarto(f.directory, undefined, undefined, flags);
      assert(
        !result.success && result.log.includes("UNSUPPORTED_PRODUCER_STARTUP"),
        result.log,
      );
      assert(
        await count(f.directory) === 1,
        "disabled adapter executed source",
      );
      assert(!(await exists(f.receipt)));
      assert(!(await exists(f.manifest)));
      assert(!(await exists(f.ledger)));
      assert(await Deno.readTextFile(f.output) === previous);
      assert(await Deno.readTextFile(f.source) === base);
    }
  } finally {
    await Deno.remove(f.directory, { recursive: true });
  }
});
test("ordinary producer staging refuses aliases before R and recovery leaves their targets intact", async () => {
  const f = await fixture();
  try {
    let result = await quarto(f.directory);
    assert(result.success, result.log);
    const previous = await Deno.readTextFile(f.output);
    const target = resolve(f.directory, "retained.json");
    await Deno.writeTextFile(target, "retained user content\n");
    for (const hard of [false, true]) {
      if (hard) await Deno.link(target, f.manifest);
      else await Deno.symlink(target, f.manifest);
      result = await quarto(f.directory);
      assert(
        !result.success && result.log.includes("UNSAFE_STAGE_PATH"),
        result.log,
      );
      assert(await count(f.directory) === 1);
      await recoverQuartoRender(f.source);
      assert(!(await exists(f.manifest)));
      assert(await Deno.readTextFile(target) === "retained user content\n");
      assert(await Deno.readTextFile(f.output) === previous);
    }
  } finally {
    await Deno.remove(f.directory, { recursive: true });
  }
});
test("producer activation leaves user pre/post R scripts in their original environment", async () => {
  const f = await fixture();
  try {
    const profile =
      "cat('profile\\n', file='profile-loads.txt', append=TRUE)\n";
    await Deno.writeTextFile(resolve(f.directory, "custom.R"), profile);
    const hook = (name: string) =>
      `const result = await new Deno.Command('Rscript', {
  args: ['-e', "writeLines(Sys.getenv('R_PROFILE_USER',unset='<unset>'),'${name}-profile.txt')"],
  stdout:'piped',stderr:'piped',
}).output();
if (!result.success) throw new Error(new TextDecoder().decode(result.stderr));\n`;
    await Deno.writeTextFile(resolve(f.directory, "user-pre.ts"), hook("pre"));
    await Deno.writeTextFile(
      resolve(f.directory, "user-post.ts"),
      hook("post"),
    );
    await Deno.writeTextFile(
      resolve(f.directory, "_quarto.yml"),
      `project:
  type: qbento
  render: [deck.qmd]
  pre-render:
    - _extensions/qbento/pre.ts
    - user-pre.ts
  post-render:
    - _extensions/qbento/post.ts
    - user-post.ts
`,
    );
    const result = await quarto(f.directory, undefined, "custom.R");
    assert(result.success, result.log);
    assert(await count(f.directory) === 1);
    for (const name of ["pre", "post"]) {
      assert(
        await Deno.readTextFile(resolve(f.directory, `${name}-profile.txt`)) ===
          "custom.R\n",
      );
    }
    assert(
      await Deno.readTextFile(resolve(f.directory, "profile-loads.txt")) ===
        "profile\nprofile\nprofile\n",
    );
    assert(
      await Deno.readTextFile(resolve(f.directory, "custom.R")) === profile,
    );
    assert(await Deno.readTextFile(f.source) === base);
  } finally {
    await Deno.remove(f.directory, { recursive: true });
  }
});
