import type { AclEntry, ShareInput } from "../shared/types.js";
import { SambaError } from "./errors.js";

const SHARE_NAME = /^[A-Za-z0-9][A-Za-z0-9 ._-]{0,79}$/;
const RESERVED = new Set(["global", "homes", "printers", "print$", "ipc$"]);
const LINUX_NAME = /^[a-z_][a-z0-9_-]{0,31}$/;
const MASK = /^[0-7]{3,4}$/;
const ACL_PERMS = /^[r-][w-][x-]$/;
const BLOCKED = [
  "/etc",
  "/proc",
  "/sys",
  "/dev",
  "/boot",
  "/bin",
  "/sbin",
  "/lib",
  "/lib32",
  "/lib64",
  "/usr",
  "/run",
  "/root",
];

/** Single quotes a value for a shell. */
export function q(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

export function b64(value: string): string {
  return Buffer.from(value, "utf8").toString("base64");
}

export function isLinuxName(value: unknown): value is string {
  return typeof value === "string" && LINUX_NAME.test(value);
}

export function linuxName(value: unknown, label: string): string {
  if (!isLinuxName(value)) {
    throw new SambaError(`${label} is not a valid name`);
  }
  return value;
}

export function shareName(value: unknown): string {
  const name = typeof value === "string" ? value.trim() : "";
  if (!SHARE_NAME.test(name) || RESERVED.has(name.toLowerCase())) {
    throw new SambaError("The share name is not valid");
  }
  return name;
}

/** An absolute folder path with no tricks, outside the system folders. */
export function sharePath(value: unknown): string {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!/^\/[A-Za-z0-9._ /+@:,=-]*$/.test(raw)) {
    throw new SambaError("The folder path is not valid");
  }
  const path = raw.length > 1 ? raw.replace(/\/+$/, "") : raw;
  if (path.includes("//") || path.split("/").some((part) => part === "..")) {
    throw new SambaError("The folder path is not valid");
  }
  const blocked =
    path === "/" ||
    BLOCKED.some((root) => path === root || path.startsWith(`${root}/`));
  if (blocked) throw new SambaError("That folder cannot be shared");
  return path;
}

export function mask(value: unknown, label: string): string {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) return "";
  if (!MASK.test(text)) throw new SambaError(`${label} must be octal`);
  return text;
}

/** User and group names for access lists. A leading @ means a group. */
export function accessList(value: unknown, label: string): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > 200) {
    throw new SambaError(`${label} is not valid`);
  }
  const seen = new Set<string>();
  for (const item of value) {
    const text = typeof item === "string" ? item.trim() : "";
    const bare = text.startsWith("@") ? text.slice(1) : text;
    if (!LINUX_NAME.test(bare)) throw new SambaError(`${label} is not valid`);
    seen.add(text);
  }
  return [...seen];
}

export function comment(value: unknown): string {
  const text = typeof value === "string" ? value.trim() : "";
  // eslint-disable-next-line no-control-regex
  if (text.length > 200 || /[\u0000-\u001f\u007f]/.test(text)) {
    throw new SambaError("The comment is not valid");
  }
  return text;
}

export function optionalName(value: unknown, label: string): string {
  if (value === undefined || value === null || value === "") return "";
  return linuxName(value, label);
}

export function parseShare(body: unknown): ShareInput {
  const b = (body ?? {}) as Record<string, unknown>;
  return {
    name: shareName(b.name),
    path: sharePath(b.path),
    comment: comment(b.comment),
    browseable: b.browseable !== false,
    readOnly: b.readOnly === true,
    guestOk: b.guestOk === true,
    validUsers: accessList(b.validUsers, "Valid users"),
    writeList: accessList(b.writeList, "Write list"),
    forceUser: optionalName(b.forceUser, "Force user"),
    forceGroup: optionalName(b.forceGroup, "Force group"),
    createMask: mask(b.createMask, "Create mask"),
    directoryMask: mask(b.directoryMask, "Directory mask"),
    hideDotFiles: b.hideDotFiles === true,
    recycleBin: b.recycleBin === true,
    inheritPermissions: b.inheritPermissions === true,
  };
}

export function parseAcl(value: unknown): AclEntry[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > 100) {
    throw new SambaError("The ACL is not valid");
  }
  return value.map((item) => {
    const e = (item ?? {}) as Record<string, unknown>;
    if (e.type !== "user" && e.type !== "group") {
      throw new SambaError("The ACL is not valid");
    }
    const perms = typeof e.perms === "string" ? e.perms : "";
    if (!ACL_PERMS.test(perms)) throw new SambaError("The ACL is not valid");
    return { type: e.type, name: linuxName(e.name, "ACL name"), perms };
  });
}

export function password(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > 128 ||
    /[\r\n\0]/.test(value)
  ) {
    throw new SambaError("The password is not valid");
  }
  return value;
}

export function pid(value: unknown): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 2 || n > 4_194_304) {
    throw new SambaError("The process id is not valid");
  }
  return n;
}
