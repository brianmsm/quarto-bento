import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Evaluate startup environment files with R's parser, without profiles,
 * default packages or QMD. Only file-induced changes reach the real child.
 */
export async function producerEnvironment(options: {
  cwd: string;
  env?: Record<string, string>;
  command?: string;
  args?: string[];
}) {
  const inherited = { ...Deno.env.toObject(), ...options.env };
  let command = options.command ?? "Rscript";
  if (!options.command) {
    const selected = inherited.QUARTO_R;
    if (selected) {
      try {
        const info = await Deno.stat(selected);
        command = resolve(
          info.isDirectory ? selected : dirname(selected),
          "Rscript",
        );
      } catch { /* Quarto also falls back for a missing QUARTO_R. */ }
    } else if (inherited.R_HOME) {
      const candidate = resolve(inherited.R_HOME, "bin", "Rscript");
      try {
        await Deno.stat(candidate);
        command = candidate;
      } catch { /* PATH. */ }
    }
  }
  const args = options.args ?? (inherited.QUARTO_KNITR_RSCRIPT_ARGS ?? "")
    .split(",").filter((arg) => arg.trim());
  const directory = await Deno.makeTempDir({ prefix: "qbento-r-environment-" });
  const output = resolve(directory, "changes.bin");
  const originalPackages = inherited.R_DEFAULT_PACKAGES;
  const explicitPackages = args.filter((arg) =>
    arg.startsWith("--default-packages=")
  ).at(-1)?.slice("--default-packages=".length);
  const startupSelection: Record<string, string> = {};
  for (
    const name of ["R_ENVIRON", "R_ENVIRON_USER", "R_PROFILE", "R_PROFILE_USER"]
  ) {
    startupSelection[`QBENTO_STARTUP_${name}_SET`] =
      inherited[name] === undefined ? "0" : "1";
    startupSelection[`QBENTO_STARTUP_${name}_VALUE`] = inherited[name] ?? "";
  }
  try {
    const result = await new Deno.Command(command, {
      cwd: options.cwd,
      args: [
        "--vanilla",
        "--default-packages=NULL",
        fileURLToPath(new URL("./producer-environment.R", import.meta.url)),
        output,
        args.includes("--no-environ") ? "skip" : "read",
      ],
      clearEnv: true,
      env: {
        ...inherited,
        ...startupSelection,
        QBENTO_STARTUP_PACKAGES: explicitPackages ?? originalPackages ??
          "datasets,utils,grDevices,graphics,stats,methods",
      },
      stdout: "piped",
      stderr: "piped",
    }).output();
    if (!result.success) {
      // Do not expose environment values, including in errors from malformed files.
      throw new Error(
        "R_ENVIRONMENT_PROBE_FAILED: cannot resolve startup environment without executing source",
      );
    }
    const values = new TextDecoder().decode(await Deno.readFile(output)).split(
      "\0",
    );
    values.pop();
    if (values.length % 2) {
      throw new Error(
        "INVALID_R_ENVIRONMENT_PROBE: malformed environment changes",
      );
    }
    const effective = { ...inherited };
    for (let i = 0; i < values.length; i += 2) {
      effective[values[i]] = values[i + 1];
    }
    return {
      effective,
      originalProfile: effective.R_PROFILE_USER,
      args: args.filter((arg) => !arg.startsWith("--default-packages=")),
    };
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
}
