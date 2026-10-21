import type { ShareInput, ShareView } from "../shared/types.js";

export const MANAGED_FILE = "/etc/samba/termix.conf";
export const MAIN_FILE = "/etc/samba/smb.conf";
const MARKER = "# termix:share";
const HEADER = "# Managed by Termix. Shares below are rewritten by the plugin.";
const SKIP = new Set(["global", "homes", "printers", "print$"]);

const yn = (value: boolean) => (value ? "yes" : "no");

/** One share as a block of smb.conf lines. */
export function renderShare(share: ShareInput): string {
  const lines = [MARKER, `[${share.name}]`, `   path = ${share.path}`];
  const add = (key: string, value: string) => {
    if (value) lines.push(`   ${key} = ${value}`);
  };
  add("comment", share.comment);
  add("browseable", yn(share.browseable));
  add("read only", yn(share.readOnly));
  add("guest ok", yn(share.guestOk));
  add("valid users", share.validUsers.join(" "));
  add("write list", share.writeList.join(" "));
  add("force user", share.forceUser);
  add("force group", share.forceGroup);
  add("create mask", share.createMask);
  add("directory mask", share.directoryMask);
  if (share.hideDotFiles) add("hide dot files", "yes");
  if (share.inheritPermissions) add("inherit permissions", "yes");
  if (share.recycleBin) {
    add("vfs objects", "recycle");
    add("recycle:repository", ".recycle");
    add("recycle:keeptree", "yes");
    add("recycle:versions", "yes");
  }
  return lines.join("\n");
}

export function renderConfig(shares: ShareInput[]): string {
  return [HEADER, ...shares.map(renderShare)].join("\n\n") + "\n";
}

type Section = { name: string; options: Map<string, string> };

/** Reads smb.conf style text into sections. Keys are lower case. */
export function parseSections(text: string): Section[] {
  const sections: Section[] = [];
  let current: Section | null = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || line.startsWith(";")) continue;
    const head = /^\[(.+)\]$/.exec(line);
    if (head) {
      current = { name: head[1]!.trim(), options: new Map() };
      sections.push(current);
      continue;
    }
    const eq = line.indexOf("=");
    if (!current || eq < 1) continue;
    const key = line.slice(0, eq).trim().toLowerCase().replace(/\s+/g, " ");
    current.options.set(key, line.slice(eq + 1).trim());
  }
  return sections;
}

function flag(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  return /^(yes|true|1|on)$/i.test(value.trim());
}

function list(value: string | undefined): string[] {
  return (value ?? "").split(/[\s,]+/).filter(Boolean);
}

function pick(options: Map<string, string>, ...keys: string[]): string {
  for (const key of keys) {
    const value = options.get(key);
    if (value !== undefined) return value;
  }
  return "";
}

function fromSection(section: Section, managed: boolean): ShareView {
  const o = section.options;
  const readOnly = o.has("read only")
    ? flag(o.get("read only"), true)
    : o.has("writable") || o.has("writeable") || o.has("write ok")
      ? !flag(pick(o, "writable", "writeable", "write ok"), false)
      : true;
  const guest = pick(o, "guest ok", "public");
  const browse = pick(o, "browseable", "browsable");
  return {
    managed,
    name: section.name,
    path: pick(o, "path"),
    comment: pick(o, "comment"),
    browseable: flag(browse || undefined, true),
    readOnly,
    guestOk: flag(guest || undefined, false),
    validUsers: list(pick(o, "valid users")),
    writeList: list(pick(o, "write list")),
    forceUser: pick(o, "force user"),
    forceGroup: pick(o, "force group"),
    createMask: pick(o, "create mask", "create mode"),
    directoryMask: pick(o, "directory mask", "directory mode"),
    hideDotFiles: flag(pick(o, "hide dot files") || undefined, false),
    recycleBin: /\brecycle\b/.test(pick(o, "vfs objects")),
    inheritPermissions: flag(
      pick(o, "inherit permissions") || undefined,
      false,
    ),
  };
}

/** The shares in the managed drop-in file. */
export function parseManaged(text: string): ShareView[] {
  return parseSections(text)
    .filter((s) => !SKIP.has(s.name.toLowerCase()))
    .map((s) => fromSection(s, true));
}

/** Every other share in the effective config, as read only entries. */
export function parseOthers(effective: string, managed: string[]): ShareView[] {
  const own = new Set(managed.map((name) => name.toLowerCase()));
  return parseSections(effective)
    .filter((s) => {
      const lower = s.name.toLowerCase();
      return !SKIP.has(lower) && !own.has(lower);
    })
    .map((s) => fromSection(s, false));
}
