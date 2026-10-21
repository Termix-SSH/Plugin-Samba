import { afterEach, describe, expect, it } from "vitest";
import { startServer, type TestServer } from "./helpers";

let server: TestServer | null = null;

afterEach(async () => {
  await server?.close();
  server = null;
});

const MANAGED = `# Managed by Termix.

# termix:share
[docs]
   path = /srv/docs
   read only = no
`;

/** Replies for reading the config files and the effective config. */
function seed(s: TestServer, effective = "") {
  s.ssh.replies.push(
    {
      match: "@@MANAGED@@",
      stdout: `@@MANAGED@@\n${MANAGED}@@MAIN@@\n[global]\n`,
    },
    { match: "testparm -s 2>/dev/null", stdout: effective },
  );
}

describe("samba routes", () => {
  it("reports status from the probe", async () => {
    server = await startServer();
    server.ssh.replies.push({
      match: "kernel=",
      stdout:
        "kernel=Linux\nroot=1\nos=Debian\npm=apt-get\ninstalled=1\nversion=Version 4.19\ninit=systemd\nsvc=smbd\nactive=1\nenabled=1\nfirewall=ufw\nselinux=none\nincluded=1\nacl=1\n",
    });
    const res = await server.request("GET", "/1/status");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      root: true,
      installed: true,
      active: true,
      service: "smbd",
      packageManager: "apt-get",
    });
  });

  it("maps a sudo failure to a code", async () => {
    server = await startServer();
    server.ssh.replies.push({
      match: "kernel=",
      stderr: "sudo: a password is required",
      code: 1,
    });
    const res = await server.request("GET", "/1/status");
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("sudo");
  });

  it("lists managed and external shares", async () => {
    server = await startServer();
    seed(server, "[docs]\n\tpath = /srv/docs\n[media]\n\tpath = /srv/media\n");
    const res = await server.request("GET", "/1/shares");
    expect(res.status).toBe(200);
    expect(
      res.body.map((s: { name: string; managed: boolean }) => [
        s.name,
        s.managed,
      ]),
    ).toEqual([
      ["docs", true],
      ["media", false],
    ]);
  });

  it("creates a share through a tested config write", async () => {
    server = await startServer();
    seed(server);
    const res = await server.request("POST", "/1/shares", {
      name: "photos",
      path: "/srv/photos",
      makeFolder: true,
      owner: "alice",
      group: "staff",
      mode: "0770",
    });
    expect(res.status).toBe(200);
    const write = server.ssh.calls.find((c) =>
      c.stdin.includes('testparm -s "$CAND"'),
    );
    expect(write).toBeTruthy();
    const script = write!.stdin;
    const b64 = /echo '([A-Za-z0-9+/=]+)' \| base64 -d/.exec(script)![1]!;
    const text = Buffer.from(b64, "base64").toString();
    expect(text).toContain("[docs]");
    expect(text).toContain("[photos]");
    expect(script).toContain("mkdir -p '/srv/photos'");
    expect(script).toContain("chown 'alice:staff' '/srv/photos'");
    expect(script).toContain("chmod 0770 '/srv/photos'");
    // The folder step must run after the test passed.
    expect(script.indexOf("mkdir -p '/srv/photos'")).toBeGreaterThan(
      script.indexOf("testparm"),
    );
    expect(
      server.mock.audits.some(
        (a) => a.action === "samba.share.create" && a.success,
      ),
    ).toBe(true);
  });

  it("rejects a duplicate share name", async () => {
    server = await startServer();
    seed(server);
    const res = await server.request("POST", "/1/shares", {
      name: "DOCS",
      path: "/srv/other",
    });
    expect(res.status).toBe(409);
  });

  it("refuses unsafe input before touching the host", async () => {
    server = await startServer();
    for (const body of [
      { name: "x", path: "/etc/samba" },
      { name: "x", path: "/srv/a;rm -rf /" },
      { name: "x]\n[global", path: "/srv/x" },
      { name: "x", path: "/srv/x", validUsers: ["a b"] },
      { name: "x", path: "/srv/x", createMask: "9" },
    ]) {
      const res = await server.request("POST", "/1/shares", body);
      expect(res.status).toBe(400);
    }
    expect(server.ssh.calls).toHaveLength(0);
  });

  it("does not edit or delete shares from smb.conf", async () => {
    server = await startServer();
    seed(server, "[media]\n\tpath = /srv/media\n");
    const put = await server.request("PUT", "/1/shares/media", {
      name: "media",
      path: "/srv/media",
    });
    expect(put.status).toBe(400);
    expect(put.body.code).toBe("unmanaged");
    const del = await server.request("DELETE", "/1/shares/media");
    expect(del.status).toBe(400);
  });

  it("deletes a managed share and keeps the others", async () => {
    server = await startServer();
    seed(server);
    const res = await server.request("DELETE", "/1/shares/docs");
    expect(res.status).toBe(200);
    const write = server.ssh.calls.find((c) => c.stdin.includes("base64 -d"))!;
    const b64 = /echo '([A-Za-z0-9+/=]+)' \| base64 -d/.exec(write.stdin)![1]!;
    expect(Buffer.from(b64, "base64").toString()).not.toContain("[docs]");
  });

  it("keeps passwords out of the command line", async () => {
    server = await startServer();
    const res = await server.request("POST", "/1/users", {
      name: "alice",
      password: "s3cret'pw",
    });
    expect(res.status).toBe(200);
    const call = server.ssh.calls[0]!;
    expect(call.command).not.toContain("s3cret");
    expect(call.stdin).not.toContain("s3cret");
    expect(call.stdin).toContain("smbpasswd -a -s");
    const b64 = /PW=\$\(echo '([A-Za-z0-9+/=]+)'/.exec(call.stdin)![1]!;
    expect(Buffer.from(b64, "base64").toString()).toBe("s3cret'pw");
  });

  it("reports a failed config test with the script message", async () => {
    server = await startServer();
    seed(server);
    server.ssh.replies.unshift({
      match: "base64 -d",
      stdout: "SAMBA_ERR:Unknown parameter\nSAMBA_ERR:bad line 3\n",
      code: 3,
    });
    const res = await server.request("PUT", "/1/config", { text: "[x]\nfoo" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Unknown parameter\nbad line 3");
  });

  it("only disconnects numeric process ids", async () => {
    server = await startServer();
    const bad = await server.request("POST", "/1/sessions/abc/disconnect");
    expect(bad.status).toBe(400);
    const ok = await server.request("POST", "/1/sessions/4242/disconnect");
    expect(ok.status).toBe(200);
    expect(server.ssh.calls[0]!.stdin).toContain("P=4242");
  });

  it("rejects unknown service actions", async () => {
    server = await startServer();
    const res = await server.request("POST", "/1/service/poweroff");
    expect(res.status).toBe(400);
    expect(server.ssh.calls).toHaveLength(0);
  });

  it("allows reads with connect access but not writes", async () => {
    server = await startServer({ level: "connect" });
    seed(server);
    const read = await server.request("GET", "/1/shares");
    expect(read.status).toBe(200);
    const write = await server.request("POST", "/1/shares", {
      name: "x",
      path: "/srv/x",
    });
    expect(write.status).toBe(403);
    expect(write.body.code).toBe("HOST_EDIT_REQUIRED");
  });

  it("hides hosts the caller cannot reach", async () => {
    server = await startServer({ level: "none" });
    const res = await server.request("GET", "/1/shares");
    expect(res.status).toBe(404);
    expect(server.ssh.calls).toHaveLength(0);
  });

  it("needs the samba.use permission", async () => {
    server = await startServer({ permissions: [] });
    const res = await server.request("GET", "/1/status");
    expect(res.status).toBe(403);
  });
});
