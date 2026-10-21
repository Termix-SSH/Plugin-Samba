import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import { startServer, type TestServer } from "./helpers";

let server: TestServer | null = null;

afterEach(async () => {
  await server?.close();
  server = null;
});

const hasBash = spawnSync("bash", ["--version"]).status === 0;

const MANAGED =
  "@@MANAGED@@\n# termix:share\n[docs]\n   path = /srv/docs\n@@MAIN@@\n";

describe.skipIf(!hasBash)("generated scripts", () => {
  it("are valid bash", async () => {
    server = await startServer();
    server.ssh.replies.push({ match: "@@MANAGED@@", stdout: MANAGED });
    const s = server;
    const calls: Array<[string, string, unknown?]> = [
      ["GET", "/1/status"],
      ["POST", "/1/install"],
      ["POST", "/1/service/start"],
      ["POST", "/1/service/enable"],
      ["POST", "/1/service/reload"],
      ["GET", "/1/shares"],
      [
        "POST",
        "/1/shares",
        {
          name: "a",
          path: "/srv/a",
          makeFolder: true,
          owner: "bob",
          mode: "0770",
        },
      ],
      ["PUT", "/1/shares/docs", { name: "docs", path: "/srv/docs" }],
      ["DELETE", "/1/shares/docs"],
      ["GET", "/1/shares/docs/permissions"],
      [
        "PUT",
        "/1/shares/docs/permissions",
        {
          owner: "bob",
          group: "staff",
          mode: "0775",
          recursive: true,
          setAcl: [{ type: "user", name: "al", perms: "rwx" }],
          removeAcl: [{ type: "group", name: "old", perms: "rwx" }],
        },
      ],
      ["GET", "/1/users"],
      ["POST", "/1/users", { name: "al", password: "p'w" }],
      ["POST", "/1/users/al/password", { password: "x" }],
      ["POST", "/1/users/al/state", { disabled: true }],
      ["DELETE", "/1/users/al?removeSystem=true"],
      ["POST", "/1/groups", { name: "staff" }],
      ["POST", "/1/groups/staff/members", { user: "al", add: true }],
      ["POST", "/1/groups/staff/members", { user: "al", add: false }],
      ["GET", "/1/sessions"],
      ["POST", "/1/sessions/4242/disconnect"],
      ["GET", "/1/config"],
      ["PUT", "/1/config", { text: "[x]\n path = /srv/x\n" }],
      ["POST", "/1/config/test"],
      ["GET", "/1/logs?lines=50"],
    ];
    for (const [method, path, body] of calls) {
      await s.request(method, path, body);
    }
    expect(s.ssh.calls.length).toBeGreaterThan(20);
    for (const call of s.ssh.calls) {
      const out = spawnSync("bash", ["-n"], { input: call.stdin });
      expect(out.stderr.toString(), call.stdin.slice(0, 200)).toBe("");
      expect(out.status).toBe(0);
    }
  });
});
