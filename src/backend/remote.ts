import type { PluginContext } from "@termix-ssh/plugin-sdk/backend";
import { SambaError } from "./errors.js";

// smbd, testparm and friends often live in sbin, which a normal login skips.
const SBIN = 'export PATH="$PATH:/usr/sbin:/sbin:/usr/local/sbin"; ';
const ROOT_SHELL =
  SBIN +
  'if [ "$(id -u)" = "0" ]; then exec bash -s; else exec sudo -n env PATH="$PATH" bash -s; fi';
const PLAIN_SHELL = SBIN + "exec bash -s";

/** Trims output and keeps it short enough to show. */
export function scrub(text: string, max = 600): string {
  return text.trim().slice(0, max);
}

const SUDO_HINT = /password is required|a terminal is required|no tty present/i;

/** Scripts print SAMBA_ERR: lines before a non zero exit to explain a failure. */
function scriptError(stdout: string): string {
  return stdout
    .split("\n")
    .filter((line) => line.startsWith("SAMBA_ERR:"))
    .map((line) => line.slice("SAMBA_ERR:".length))
    .join("\n")
    .trim();
}

export interface Remote {
  /** Runs a script as root, or with passwordless sudo. */
  root: (hostId: number, script: string, timeoutMs?: number) => Promise<string>;
  /** Runs a read only script as the login user. */
  plain: (
    hostId: number,
    script: string,
    timeoutMs?: number,
  ) => Promise<string>;
}

export function createRemote(ctx: PluginContext): Remote {
  async function run(
    hostId: number,
    shell: string,
    script: string,
    timeoutMs: number,
  ) {
    const result = await ctx.ssh.exec(hostId, shell, {
      stdin: script,
      timeoutMs,
      purpose: "samba",
    });
    if (result.timedOut) throw new SambaError("The host took too long", 504);
    if (result.code !== 0) {
      if (SUDO_HINT.test(result.stderr)) {
        throw new SambaError(
          "This host needs passwordless sudo, or a root login",
          400,
          { code: "sudo" },
        );
      }
      const own = scriptError(result.stdout);
      throw new SambaError(
        scrub(own || result.stderr || result.stdout || "Command failed", 1500),
      );
    }
    return result.stdout;
  }

  return {
    root: (hostId, script, timeoutMs = 60_000) =>
      run(hostId, ROOT_SHELL, script, timeoutMs),
    plain: (hostId, script, timeoutMs = 20_000) =>
      run(hostId, PLAIN_SHELL, script, timeoutMs),
  };
}

/** Reads key=value lines. Only the first = splits a line. */
export function parseKeys(output: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of output.split("\n")) {
    const eq = line.indexOf("=");
    if (eq > 0) out[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
  }
  return out;
}
