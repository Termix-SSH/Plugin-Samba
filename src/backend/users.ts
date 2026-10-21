import type { SambaGroup, SambaUser, UsersView } from "../shared/types.js";
import type { Remote } from "./remote.js";
import { b64, linuxName, password, q } from "./validate.js";

export interface UserManager {
  list: (hostId: number) => Promise<UsersView>;
  add: (hostId: number, body: unknown) => Promise<void>;
  setPassword: (hostId: number, name: string, value: unknown) => Promise<void>;
  setDisabled: (
    hostId: number,
    name: string,
    disabled: boolean,
  ) => Promise<void>;
  remove: (
    hostId: number,
    name: string,
    removeSystem: boolean,
  ) => Promise<void>;
  addGroup: (hostId: number, name: string) => Promise<void>;
  member: (
    hostId: number,
    group: string,
    user: string,
    add: boolean,
  ) => Promise<void>;
}

/** Reads pdbedit -L -v output: blocks split by a dashed line. */
export function parsePdbedit(text: string): SambaUser[] {
  const users: SambaUser[] = [];
  for (const block of text.split(/^-{5,}\s*$/m)) {
    const field = (label: string) =>
      new RegExp(`^${label}:\\s*(.*)$`, "m").exec(block)?.[1]?.trim() ?? "";
    const name = field("Unix username");
    if (!name) continue;
    const flags = field("Account Flags");
    users.push({
      name,
      fullName: field("Full Name"),
      disabled: /\[[^\]]*D[^\]]*\]/.test(flags),
    });
  }
  return users;
}

export function parseGroups(text: string): SambaGroup[] {
  const groups: SambaGroup[] = [];
  for (const line of text.split("\n")) {
    const [name, gid, members = ""] = line.trim().split(":");
    if (!name || !/^\d+$/.test(gid ?? "")) continue;
    groups.push({
      name,
      gid: Number(gid),
      members: members.split(",").filter(Boolean),
    });
  }
  return groups;
}

export function createUsers(remote: Remote): UserManager {
  const pwLine = (value: string) =>
    `PW=$(echo '${b64(value)}' | base64 -d)\nprintf '%s\\n%s\\n' "$PW" "$PW"`;

  return {
    async list(hostId) {
      const out = await remote.root(
        hostId,
        `
echo '@@SAMBA@@'
pdbedit -L -v 2>/dev/null || true
echo '@@SYSTEM@@'
getent passwd | awk -F: '$3>=1000 && $3<60000 {print $1}'
echo '@@GROUPS@@'
getent group | awk -F: '$3>=1000 && $3<60000 {print $0}'
`,
      );
      const section = (name: string, next: string[]) => {
        const start = out.indexOf(`@@${name}@@\n`);
        if (start < 0) return "";
        const from = start + name.length + 5;
        const ends = next
          .map((n) => out.indexOf(`@@${n}@@\n`, from))
          .filter((i) => i >= 0);
        return out.slice(from, ends.length ? Math.min(...ends) : undefined);
      };
      return {
        samba: parsePdbedit(section("SAMBA", ["SYSTEM", "GROUPS"])),
        system: section("SYSTEM", ["GROUPS"])
          .split("\n")
          .map((l) => l.trim())
          .filter(Boolean),
        groups: parseGroups(section("GROUPS", [])),
      };
    },

    async add(hostId, body) {
      const b = (body ?? {}) as Record<string, unknown>;
      const name = linuxName(b.name, "The user name");
      const pw = password(b.password);
      const create = b.createSystem !== false;
      await remote.root(
        hostId,
        `
set -e
U=${q(name)}
if ! id -u "$U" >/dev/null 2>&1; then
  ${
    create
      ? `useradd -M -s "$(command -v nologin || echo /usr/sbin/nologin)" "$U" 2>/dev/null || adduser -S -H -D -s /sbin/nologin "$U"`
      : `echo "SAMBA_ERR:There is no Linux user with this name"; exit 4`
  }
fi
if pdbedit -L 2>/dev/null | cut -d: -f1 | grep -qx "$U"; then echo "SAMBA_ERR:This Samba user already exists"; exit 4; fi
{ ${pwLine(pw)}; } | smbpasswd -a -s "$U" >/dev/null
echo done
`,
      );
    },

    async setPassword(hostId, name, value) {
      const user = linuxName(name, "The user name");
      const pw = password(value);
      await remote.root(
        hostId,
        `
set -e
U=${q(user)}
{ ${pwLine(pw)}; } | smbpasswd -s "$U" >/dev/null
echo done
`,
      );
    },

    async setDisabled(hostId, name, disabled) {
      const user = linuxName(name, "The user name");
      await remote.root(
        hostId,
        `smbpasswd ${disabled ? "-d" : "-e"} ${q(user)} >/dev/null\necho done`,
      );
    },

    async remove(hostId, name, removeSystem) {
      const user = linuxName(name, "The user name");
      await remote.root(
        hostId,
        `
set -e
U=${q(user)}
smbpasswd -x "$U" >/dev/null
${
  removeSystem
    ? `UID_=$(id -u "$U" 2>/dev/null || echo 0)
if [ "$UID_" -ge 1000 ] && [ "$UID_" -lt 60000 ]; then userdel "$U" 2>/dev/null || deluser "$U" 2>/dev/null || true; fi`
    : ""
}
echo done
`,
      );
    },

    async addGroup(hostId, name) {
      const group = linuxName(name, "The group name");
      await remote.root(
        hostId,
        `groupadd ${q(group)} 2>/dev/null || addgroup ${q(group)}\necho done`,
      );
    },

    async member(hostId, groupName, userName, add) {
      const group = linuxName(groupName, "The group name");
      const user = linuxName(userName, "The user name");
      const g = q(group);
      const u = q(user);
      await remote.root(
        hostId,
        add
          ? `gpasswd -a ${u} ${g} >/dev/null 2>&1 || addgroup ${u} ${g}\necho done`
          : `gpasswd -d ${u} ${g} >/dev/null 2>&1 || delgroup ${u} ${g}\necho done`,
      );
    },
  };
}
