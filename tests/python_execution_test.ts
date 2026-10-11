import { renderProject, saveProject } from "../src/core/project.ts";
import { applySync, previewSync } from "../src/core/sync.ts";
import { applyReconcile, previewReconcile } from "../src/core/reconcile.ts";
import { targetKey } from "../src/state/mod.ts";
function assert(value: unknown, message = "assertion failed"): asserts value {
  if (!value) throw new Error(message);
}
const canRun =
  (await Deno.permissions.query({ name: "run" })).state === "granted";
const enabled = canRun && Deno.env.get("QBENTO_PYTHON_EXECUTION_TEST") === "1";
Deno.test({
  name:
    "installed Python via knitr recomputes real SVG and stdout while reviewed authored sync retains design",
  ignore: !enabled,
  fn: async () => {
    const dir = await Deno.makeTempDir({ prefix: "qbento-python-test-" });
    const previous = Object.fromEntries(
      ["RETICULATE_PYTHON", "RETICULATE_USE_MANAGED_VENV", "MPLCONFIGDIR"].map(
        (k) => [k, Deno.env.get(k)],
      ),
    );
    try {
      const python = Deno.env.get("QBENTO_TEST_PYTHON") ?? "python3";
      const deps = await new Deno.Command(python, {
        args: ["-B", "-c", "import sys, matplotlib; print(sys.executable)"],
        stdout: "piped",
        stderr: "piped",
      }).output();
      assert(
        deps.success,
        "Python with installed matplotlib is required for this opt-in test",
      );
      const r = await new Deno.Command("Rscript", {
        args: [
          "-e",
          'stopifnot(requireNamespace("reticulate",quietly=TRUE),requireNamespace("knitr",quietly=TRUE))',
        ],
        stdout: "piped",
        stderr: "piped",
      }).output();
      assert(
        r.success,
        "Installed R knitr and reticulate are required; this test never installs them",
      );
      Deno.env.set(
        "RETICULATE_PYTHON",
        new TextDecoder().decode(deps.stdout).trim(),
      );
      Deno.env.set("RETICULATE_USE_MANAGED_VENV", "no");
      Deno.env.set("MPLCONFIGDIR", dir + "/mpl");
      const source = dir + "/deck.qmd";
      const original =
        '---\ntitle: Python proof\nengine: knitr\n---\n\n## Results {#results}\n\n```{r}\n#| include: false\nstopifnot(getwd() == dirname(normalizePath("deck.qmd")))\n```\n\n::: {#finding}\nAuthored result β.\n:::\n\n```{python}\n#| label: fig-values\n#| echo: false\n#| dev: svg\nimport csv\nimport os\nimport matplotlib.pyplot as plt\nsvg_epoch = os.environ.setdefault("SOURCE_DATE_EPOCH", "0")\nplt.rcParams["svg.hashsalt"] = "qbento-python-computation"\nwith open("data.csv", newline="") as f:\n    values = [float(row["value"]) for row in csv.DictReader(f)]\nlines = plt.plot(values, marker="o")\nplt.show()\n```\n\n## Summary {#summary}\n\n```{python}\n#| label: python-total\n#| echo: true\nprint("Computed sum:", sum(values))\n```\n';
      await Deno.writeTextFile(source, original);
      await Deno.writeTextFile(dir + "/data.csv", "value\n1\n2\n3\n");
      const first = (await renderProject(source)).state;
      const figure = (state: typeof first) =>
        state.emitted.slides[0].elements.find((e) => e.id === "fig-values")!;
      const output = (state: typeof first) =>
        state.emitted.slides[1].elements.find((e) =>
          e.id === "python-total/code:2"
        )!;
      assert(output(first).content === "Computed sum: 6.0");
      const edited = structuredClone(first.emitted),
        text = edited.slides[0].elements.find((e) =>
          e.id === "finding/paragraph:1"
        )!;
      text.html = "Python result revised β.";
      text.x = 96;
      text.fontSize = 28;
      Object.assign(
        edited.slides[0].elements.find((e) => e.id === "fig-values")!,
        { x: 252, y: 288, w: 790, h: 365, rotation: 4 },
      );
      edited.slides[1].elements.find((e) => e.id === "python-total/code:2")!
        .fontSize = 26;
      await saveProject(source, edited, first.revision);
      assert(await Deno.readTextFile(source) === original, "Save rewrote QMD");
      const plan = await previewSync(source);
      assert(
        plan.result ===
          original.replace("Authored result β.", "Python result revised β.")
            .replace("{#results}", "{#results .qbento-design}").replace(
              "{#summary}",
              "{#summary .qbento-design}",
            ),
        "Unexpected source patch",
      );
      assert(plan.patch.patches.length === 1);
      await applySync(source, plan);
      await Deno.writeTextFile(dir + "/data.csv", "value\n1\n20\n30\n");
      const next = (await renderProject(source)).state;
      assert(next.pending.length === 0 && next.docId === first.docId);
      assert(
        output(next).content === "Computed sum: 51.0" &&
          output(next).fontSize === 26,
      );
      const decode = (src: unknown) =>
        new TextDecoder().decode(
          Uint8Array.from(atob(String(src).split(",")[1]), (c) =>
            c.charCodeAt(0)),
        );
      const path = (svg: string) =>
        svg.match(
          /<g id="line2d_\d+">\s*<path d="([^"]+)"[^>]*style="[^"]*#1f77b4/,
        )?.[1];
      const before = path(decode(figure(first).src)),
        after = path(decode(figure(next).src));
      assert(
        before && after && before !== after,
        "Computed plotted path did not change",
      );
      for (
        const [key, value] of Object.entries({
          x: 252,
          y: 288,
          w: 790,
          h: 365,
          rotation: 4,
        })
      ) {
        assert(figure(next)[key] === value);
      }
      const kept = next.emitted.slides[0].elements.find((e) =>
        e.id === text.id
      )!;
      assert(kept.html === text.html && kept.x === 96 && kept.fontSize === 28);
      assert(
        next
          .provenance[
            targetKey({ slideId: "summary", elementId: output(next).id })
          ].producer === "python-total",
      );
      const fake = structuredClone(next.emitted);
      fake.slides[1].elements.find((e) => e.id === output(next).id)!.content =
        "Computed sum: 999";
      await saveProject(source, fake, next.revision);
      try {
        await previewSync(source);
        throw new Error("Computed stdout reverse-written");
      } catch (e) {
        assert((e as { code?: string }).code === "SYNC_CONFLICT", String(e));
      }
      assert(await Deno.readTextFile(source) === plan.result);
      const reconcile = await previewReconcile(source),
        item = reconcile.changes.find((c) =>
          c.change.target.elementId === output(next).id
        )!;
      await applyReconcile(source, reconcile, [{
        changeId: item.change.id,
        action: "keep-source",
      }]);
      const restored = (await renderProject(source)).state;
      assert(
        output(restored).content === "Computed sum: 51.0" &&
          restored.pending.length === 0,
      );
      const clone = dir + "/source-only-clone";
      await Deno.mkdir(clone + "/.qbento", { recursive: true });
      for (
        const name of [
          "deck.qmd",
          "data.csv",
          ".qbento/project.json",
          ".qbento/state.json",
        ]
      ) {
        await Deno.copyFile(dir + "/" + name, clone + "/" + name);
      }
      const rebuilt = (await renderProject(clone + "/deck.qmd")).state;
      assert(rebuilt.docId === first.docId && rebuilt.pending.length === 0);
      assert(
        output(rebuilt).content === "Computed sum: 51.0" &&
          output(rebuilt).fontSize === 26,
      );
      for (
        const [key, value] of Object.entries({
          x: 252,
          y: 288,
          w: 790,
          h: 365,
          rotation: 4,
        })
      ) assert(figure(rebuilt)[key] === value);
    } finally {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) Deno.env.delete(key);
        else Deno.env.set(key, value);
      }
      await Deno.remove(dir, { recursive: true });
    }
  },
});
