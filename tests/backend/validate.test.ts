import { describe, expect, it } from "vitest";
import {
  accessList,
  b64,
  linuxName,
  mask,
  parseAcl,
  parseShare,
  password,
  pid,
  q,
  shareName,
  sharePath,
} from "../../src/backend/validate";

describe("validate", () => {
  it("quotes single quotes for a shell", () => {
    expect(q("a'b")).toBe(`'a'"'"'b'`);
    expect(q("$(rm -rf /)")).toBe("'$(rm -rf /)'");
  });

  it("encodes text as base64", () => {
    expect(Buffer.from(b64("p'w\n"), "base64").toString()).toBe("p'w\n");
  });

  it("accepts normal share names and rejects bad ones", () => {
    expect(shareName("docs")).toBe("docs");
    expect(shareName(" My Files ")).toBe("My Files");
    for (const bad of ["", "[x]", "a\nb", "global", "IPC$", "x;y", "-a", 5]) {
      expect(() => shareName(bad)).toThrow();
    }
  });

  it("accepts safe paths and rejects tricks and system folders", () => {
    expect(sharePath("/srv/docs/")).toBe("/srv/docs");
    expect(sharePath("/data/my files")).toBe("/data/my files");
    for (const bad of [
      "relative",
      "/",
      "/srv/../etc",
      "/srv//x",
      "/etc",
      "/etc/samba",
      "/usr/local",
      "/proc/1",
      "/srv/a;b",
      "/srv/$(id)",
      "/srv/a\nb",
      "/srv/`id`",
      "/srv/a'b",
    ]) {
      expect(() => sharePath(bad)).toThrow();
    }
  });

  it("checks linux names", () => {
    expect(linuxName("alice", "x")).toBe("alice");
    for (const bad of ["Alice", "a b", "-x", "a;b", "", "a".repeat(40)]) {
      expect(() => linuxName(bad, "x")).toThrow();
    }
  });

  it("checks access lists with groups", () => {
    expect(accessList(["alice", "@staff", "alice"], "x")).toEqual([
      "alice",
      "@staff",
    ]);
    expect(accessList(undefined, "x")).toEqual([]);
    expect(() => accessList(["a b"], "x")).toThrow();
    expect(() => accessList("alice", "x")).toThrow();
  });

  it("checks octal masks", () => {
    expect(mask("0664", "x")).toBe("0664");
    expect(mask("", "x")).toBe("");
    expect(() => mask("0888", "x")).toThrow();
    expect(() => mask("6; id", "x")).toThrow();
  });

  it("checks ACL entries", () => {
    expect(
      parseAcl([{ type: "user", name: "bob", perms: "rwx" }]),
    ).toHaveLength(1);
    expect(() =>
      parseAcl([{ type: "other", name: "bob", perms: "rwx" }]),
    ).toThrow();
    expect(() =>
      parseAcl([{ type: "user", name: "bob", perms: "rwxx" }]),
    ).toThrow();
    expect(() => parseAcl("x")).toThrow();
  });

  it("checks passwords and process ids", () => {
    expect(password("pa ss'word")).toBe("pa ss'word");
    expect(() => password("")).toThrow();
    expect(() => password("a\nb")).toThrow();
    expect(pid("1234")).toBe(1234);
    expect(() => pid("1; kill")).toThrow();
    expect(() => pid(1)).toThrow();
  });

  it("parses a full share", () => {
    const share = parseShare({
      name: "docs",
      path: "/srv/docs",
      comment: "Team files",
      readOnly: true,
      validUsers: ["alice"],
    });
    expect(share).toMatchObject({
      name: "docs",
      readOnly: true,
      browseable: true,
      guestOk: false,
      validUsers: ["alice"],
    });
    expect(() =>
      parseShare({ name: "x", path: "/srv/x", comment: "a\nb" }),
    ).toThrow();
  });
});
