import { installQuartoProject } from "../src/integration/install.ts";
import { saveProject } from "../src/core/project.ts";
import { StateStore, targetKey } from "../src/state/mod.ts";
function assert(v: unknown, m = "assertion failed"): asserts v {
  if (!v) throw new Error(m);
}
const enabled = Deno.env.get("QBENTO_PYTHON_EXECUTION_TEST") === "1";
Deno.test({
  name:
    "ordinary installed Quarto executes genuine Python and preserves native design through changed-data recomputation",
  ignore: !enabled,
  async fn() {
    const dir = await Deno.makeTempDir({ prefix: "qbento-python-quarto-" });
    try {
      const python = await new Deno.Command(
        Deno.env.get("QBENTO_TEST_PYTHON") ?? "python3",
        {
          args: ["-c", "import sys, matplotlib; print(sys.executable)"],
          stdout: "piped",
          stderr: "piped",
        },
      ).output();
      assert(
        python.success,
        "Existing compatible Python and Matplotlib required; no installation is attempted",
      );
      const source = dir + "/deck.qmd",
        original = await Deno.readTextFile(
          new URL("../examples/python-computation/deck.qmd", import.meta.url),
        );
      await Deno.writeTextFile(source, original);
      await Deno.copyFile(
        new URL("../examples/python-computation/data.csv", import.meta.url),
        dir + "/data.csv",
      );
      await installQuartoProject(source);
      const execute = async () => {
        const result = await new Deno.Command("quarto", {
          cwd: dir,
          args: ["render", "deck.qmd"],
          env: {
            RETICULATE_PYTHON: new TextDecoder().decode(python.stdout).trim(),
            RETICULATE_USE_MANAGED_VENV: "no",
            MPLCONFIGDIR: dir + "/mpl",
            XDG_CACHE_HOME: dir + "/cache",
            QUARTO_RUN_NO_NETWORK: "true",
          },
          stdout: "piped",
          stderr: "piped",
        }).output();
        assert(
          result.success,
          new TextDecoder().decode(result.stdout) +
            new TextDecoder().decode(result.stderr),
        );
        const state = await new StateStore(dir + "/.qbento").load();
        assert(state);
        return state;
      };
      const first = await execute();
      const figure = (s: typeof first) =>
        s.emitted.slides[0].elements.find((e) => e.id === "fig-values")!;
      const stdout = (s: typeof first) =>
        s.emitted.slides[1].elements.find((e) =>
          e.id === "python-total/code:2"
        )!;
      assert(stdout(first).content === "Computed sum: 6.0");
      const edited = structuredClone(first.emitted);
      Object.assign(
        edited.slides[0].elements.find((e) => e.id === "fig-values")!,
        { x: 222, y: 277, w: 700, h: 365, rotation: 3 },
      );
      edited.slides[1].elements.find((e) => e.id === "python-total/code:2")!
        .fontSize = 25;
      await saveProject(source, edited, first.revision);
      await Deno.writeTextFile(dir + "/data.csv", "value\n1\n20\n30\n");
      const next = await execute();
      assert(next.docId === first.docId && next.pending.length === 0);
      assert(
        stdout(next).content === "Computed sum: 51.0" &&
          stdout(next).fontSize === 25,
      );
      assert(
        figure(next).x === 222 && figure(next).rotation === 3 &&
          figure(next).w === 700,
      );
      const svg = (src: unknown) =>
        new TextDecoder().decode(
          Uint8Array.from(
            atob(String(src).split(",")[1]),
            (c) => c.charCodeAt(0),
          ),
        );
      const line = (s: string) =>
        s.match(
          /<g id="line2d_\d+">\s*<path d="([^"]+)"[^>]*style="[^"]*#1f77b4/,
        )?.[1];
      assert(
        line(svg(figure(first).src)) &&
          line(svg(figure(first).src)) !== line(svg(figure(next).src)),
        "Actual plotted data did not change",
      );
      assert(
        next
          .provenance[
            targetKey({ slideId: "summary", elementId: "python-total/code:2" })
          ].producer === "python-total",
      );
      assert(
        await Deno.readTextFile(source) === original,
        "Ordinary render rewrote QMD",
      );
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  },
});
