import { describe, expect, it } from "vitest";
import {
  parseManaged,
  parseOthers,
  renderConfig,
} from "../../src/backend/config";
import type { ShareInput } from "../../src/shared/types";
import { parsePdbedit, parseGroups } from "../../src/backend/users";
import { parseStatusJson } from "../../src/backend/sessions";

const share: ShareInput = {
  name: "docs",
  path: "/srv/docs",
  comment: "Team files",
  browseable: true,
  readOnly: false,
  guestOk: false,
  validUsers: ["alice", "@staff"],
  writeList: ["alice"],
  forceUser: "",
  forceGroup: "staff",
  createMask: "0664",
  directoryMask: "0775",
  hideDotFiles: true,
  recycleBin: true,
  inheritPermissions: false,
};

describe("config", () => {
  it("renders shares with a marker", () => {
    const text = renderConfig([share]);
    expect(text).toContain("# termix:share");
    expect(text).toContain("[docs]");
    expect(text).toContain("   path = /srv/docs");
    expect(text).toContain("   valid users = alice @staff");
    expect(text).toContain("   vfs objects = recycle");
  });

  it("round trips a share", () => {
    const [back] = parseManaged(renderConfig([share]));
    const { managed, ...rest } = back!;
    expect(managed).toBe(true);
    expect(rest).toEqual(share);
  });

  it("reads other shares from testparm output and skips managed ones", () => {
    const effective = `[global]
\tworkgroup = WORKGROUP

[docs]
\tpath = /srv/docs

[media]
\tpath = /srv/media
\tread only = No
\tguest ok = Yes
\tvalid users = bob, carol

[printers]
\tpath = /var/spool/samba
`;
    const others = parseOthers(effective, ["docs"]);
    expect(others.map((s) => s.name)).toEqual(["media"]);
    expect(others[0]).toMatchObject({
      managed: false,
      readOnly: false,
      guestOk: true,
      validUsers: ["bob", "carol"],
    });
  });

  it("understands writable and public aliases", () => {
    const [s] = parseManaged(
      "[x]\n path = /srv/x\n writable = yes\n public = yes\n",
    );
    expect(s).toMatchObject({ readOnly: false, guestOk: true });
  });

  it("parses pdbedit output", () => {
    const text = `Unix username:        alice
NT username:          alice
Account Flags:        [U          ]
Full Name:            Alice A
---------------
Unix username:        bob
Account Flags:        [DU         ]
`;
    expect(parsePdbedit(text)).toEqual([
      { name: "alice", fullName: "Alice A", disabled: false },
      { name: "bob", fullName: "", disabled: true },
    ]);
  });

  it("parses groups", () => {
    expect(parseGroups("staff:1001:alice,bob\nempty:1002:\nbad line")).toEqual([
      { name: "staff", gid: 1001, members: ["alice", "bob"] },
      { name: "empty", gid: 1002, members: [] },
    ]);
  });

  it("parses smbstatus json", () => {
    const view = parseStatusJson(
      JSON.stringify({
        sessions: {
          "1": {
            username: "alice",
            groupname: "staff",
            remote_machine: "pc1",
            session_dialect: "SMB3_11",
            server_id: { pid: "4242" },
          },
        },
        tcons: {
          "1": { service: "docs", machine: "pc1", server_id: { pid: "4242" } },
        },
        open_files: {
          "/srv/docs/a.txt": {
            service_path: "/srv/docs",
            filename: "a.txt",
            opens: { x: { username: "alice", server_id: { pid: "4242" } } },
          },
        },
      }),
    );
    expect(view.sessions[0]).toMatchObject({ pid: 4242, user: "alice" });
    expect(view.connections[0]).toMatchObject({ share: "docs" });
    expect(view.files[0]).toMatchObject({ file: "a.txt", user: "alice" });
  });
});
