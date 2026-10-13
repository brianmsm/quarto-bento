import { fileURLToPath } from "node:url";
/** Deno.env is process-global even across parallel test modules. Run startup
 * mutation cases in their own process rather than serializing the product suite.
 */
export function isolatedEnvironmentTest(
  name: string,
  moduleUrl: string,
  fn: () => Promise<void>,
) {
  Deno.test(name, async () => {
    if (Deno.env.get("QBENTO_ISOLATED_ENVIRONMENT_TEST") === name) {
      return await fn();
    }
    const result = await new Deno.Command(Deno.execPath(), {
      args: [
        "test",
        "--allow-read",
        "--allow-write",
        "--allow-env",
        "--allow-run",
        "--allow-net=127.0.0.1",
        "--filter",
        name,
        fileURLToPath(moduleUrl),
      ],
      env: { QBENTO_ISOLATED_ENVIRONMENT_TEST: name },
      stdout: "piped",
      stderr: "piped",
    }).output();
    if (!result.success) {
      throw new Error(
        new TextDecoder().decode(result.stdout) +
          new TextDecoder().decode(result.stderr),
      );
    }
  });
}
