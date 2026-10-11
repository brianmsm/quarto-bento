import { basename, resolve } from "node:path";
import { ppid } from "node:process";

export async function processStartTime(pid: number): Promise<string | null> {
  const result = await new Deno.Command("ps", {
    args: ["-p", String(pid), "-o", "lstart="],
    stdout: "piped",
    stderr: "piped",
    env: { LC_ALL: "C" },
  }).output();
  const value = new TextDecoder().decode(result.stdout).trim();
  if (result.success && value) return value;
  if (result.code === 1 && !value && result.stderr.length === 0) return null;
  throw new Error(
    "QUARTO_PROCESS_UNVERIFIED: cannot verify whether the original render is still active",
  );
}

/** Quarto 1.10 does not expose effective output CLI options to project hooks. */
export function assertSafeQuartoArguments(
  args: string[],
  source: string,
  cwd: string,
): void {
  if (args[0] !== "render") {
    throw new Error(
      "UNVERIFIED_QUARTO_INVOCATION: supported invocation is quarto render [source.qmd] [--to qbento-html] [--quiet]",
    );
  }
  let sawSource = false;
  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--quiet" || arg === "--to=qbento-html") continue;
    if (arg === "--to" && args[i + 1] === "qbento-html") {
      i++;
      continue;
    }
    if (
      !arg.startsWith("-") && !sawSource &&
      (resolve(cwd, arg) === source || arg === ".")
    ) {
      sawSource = true;
      continue;
    }
    throw new Error(
      `UNSAFE_QUARTO_ARGUMENT: ${arg}; only render [${
        basename(source)
      }] [--to qbento-html] [--quiet] is verified; use qbento render for the guarded CLI pipeline`,
    );
  }
}

/** Bounded Linux ancestry inspection; fail closed on unverified platforms/launchers. */
export async function assertSafeQuartoInvocation(
  source: string,
): Promise<{ pid: number; startTime: string }> {
  if (Deno.build.os !== "linux") {
    throw new Error(
      "QUARTO_EXTENSION_PLATFORM: ordinary Quarto integration is currently verified on Linux only; use qbento render on other platforms pending native validation",
    );
  }
  const bin = Deno.env.get("QUARTO_BIN_PATH");
  if (!bin) {
    throw new Error(
      "UNVERIFIED_QUARTO_INVOCATION: missing Quarto installation identity",
    );
  }
  const script = await Deno.realPath(resolve(bin, "quarto.js"));
  let pid = ppid;
  for (let depth = 0; depth < 8 && pid > 1; depth++) {
    let args: string[];
    let status: string;
    try {
      args = (await Deno.readTextFile(`/proc/${pid}/cmdline`)).split("\0")
        .filter(Boolean);
      status = await Deno.readTextFile(`/proc/${pid}/status`);
    } catch (e) {
      throw new Error(
        `UNVERIFIED_QUARTO_INVOCATION: cannot inspect Quarto ancestry (${
          String(e)
        })`,
      );
    }
    const at = args.indexOf(script);
    if (at !== -1) {
      assertSafeQuartoArguments(args.slice(at + 1), source, Deno.cwd());
      const startTime = await processStartTime(pid);
      if (!startTime) {
        throw new Error(
          "UNVERIFIED_QUARTO_INVOCATION: render process ended during preflight",
        );
      }
      return { pid, startTime };
    }
    pid = Number(status.match(/^PPid:\s+(\d+)$/m)?.[1]);
  }
  throw new Error(
    "UNVERIFIED_QUARTO_INVOCATION: trusted Quarto render ancestor was not found; refusing output writes",
  );
}
