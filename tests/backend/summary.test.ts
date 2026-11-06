import { afterEach, describe, expect, it } from "vitest";
import { startServer, type TestServer } from "./helpers";

let server: TestServer | null = null;

afterEach(async () => {
  await server?.close();
  server = null;
});

const STATUS =
  "kernel=Linux\nroot=1\nos=Debian\npm=apt-get\ninstalled=1\nversion=Version 4.19\ninit=systemd\nsvc=smbd\nactive=1\nenabled=1\nfirewall=ufw\nselinux=none\nincluded=1\nacl=1\n";

const MANAGED = `# Managed by Termix.

# termix:share
[docs]
   path = /srv/docs
   read only = no
`;

const SESSIONS = JSON.stringify({
  sessions: {
    "1": { username: "alice", remote_machine: "pc", server_id: { pid: 7 } },
    "2": { username: "bob", remote_machine: "pc2", server_id: { pid: 8 } },
  },
});

describe("summary", () => {
  it("counts shares and sessions on hosts with Samba on", async () => {
    server = await startServer();
    server.mock.settings.set("host:1:enableSamba", true);
    Object.assign(server.mock.ctx.hosts, {
      list: async () => [{ id: 1 }, { id: 2 }],
    });
    server.ssh.replies.push(
      { match: "kernel=", stdout: STATUS },
      {
        match: "@@MANAGED@@",
        stdout: `@@MANAGED@@\n${MANAGED}@@MAIN@@\n[global]\n`,
      },
      { match: "smbstatus -j", stdout: `@@JSON@@\n${SESSIONS}\n` },
    );
    const res = await server.request("GET", "/summary");
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({
      hostId: 1,
      installed: true,
      active: true,
      shares: 1,
      sessions: 2,
    });
  });

  it("reports an unreachable host as an error row", async () => {
    server = await startServer();
    server.mock.settings.set("host:1:enableSamba", true);
    Object.assign(server.mock.ctx.hosts, { list: async () => [{ id: 1 }] });
    server.ssh.replies.push({ match: "kernel=", stderr: "boom", code: 255 });
    const res = await server.request("GET", "/summary?refresh=1");
    expect(res.body[0].error).toBeTruthy();
    expect(res.body[0].active).toBe(false);
  });
});
