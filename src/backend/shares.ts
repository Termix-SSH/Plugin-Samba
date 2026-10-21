import type {
  AclEntry,
  CreateShareBody,
  PermissionsView,
  ShareInput,
  ShareView,
} from "../shared/types.js";
import { parseManaged, parseOthers, renderConfig } from "./config.js";
import { SambaError } from "./errors.js";
import type { Remote } from "./remote.js";
import type { SambaService } from "./service.js";
import {
  mask,
  optionalName,
  parseAcl,
  parseShare,
  q,
  sharePath,
} from "./validate.js";

export interface ShareManager {
  list: (hostId: number) => Promise<ShareView[]>;
  create: (hostId: number, body: unknown) => Promise<void>;
  update: (hostId: number, name: string, body: unknown) => Promise<void>;
  remove: (hostId: number, name: string) => Promise<void>;
  permissions: (hostId: number, name: string) => Promise<PermissionsView>;
  setPermissions: (
    hostId: number,
    name: string,
    body: unknown,
  ) => Promise<void>;
}

function ownerSpec(owner: string, group: string): string {
  if (owner && group) return `${owner}:${group}`;
  return owner || `:${group}`;
}

function stripView(share: ShareView): ShareInput {
  const { managed: _managed, ...input } = share;
  void _managed;
  return input;
}

export function createShares(
  remote: Remote,
  service: SambaService,
): ShareManager {
  async function managedShares(hostId: number): Promise<ShareView[]> {
    const { managed } = await service.readState(hostId);
    return parseManaged(managed);
  }

  async function others(hostId: number, own: ShareView[]) {
    const effective = await service.effective(hostId);
    return parseOthers(
      effective,
      own.map((s) => s.name),
    );
  }

  /** The folder step that runs once the new config passed testparm. */
  function folderStep(body: CreateShareBody, path: string): string {
    const p = q(path);
    if (!body.makeFolder) {
      return `[ -d ${p} ] || { echo "SAMBA_ERR:The folder does not exist on the host"; exit 7; }`;
    }
    const owner = optionalName(body.owner, "Owner");
    const group = optionalName(body.group, "Group");
    const mode = mask(body.mode, "Mode");
    const lines = [`mkdir -p ${p}`];
    if (owner || group) lines.push(`chown ${q(ownerSpec(owner, group))} ${p}`);
    if (mode) lines.push(`chmod ${mode} ${p}`);
    return lines.join("\n");
  }

  async function write(
    hostId: number,
    shares: ShareInput[],
    before: string,
  ): Promise<void> {
    await service.applyConfig(hostId, renderConfig(shares), before);
  }

  async function need(hostId: number, name: string): Promise<ShareView> {
    const own = await managedShares(hostId);
    const found = own.find((s) => s.name.toLowerCase() === name.toLowerCase());
    if (!found) {
      const external = (await others(hostId, own)).find(
        (s) => s.name.toLowerCase() === name.toLowerCase(),
      );
      if (external) {
        throw new SambaError(
          "This share is not managed here, so it is read only",
          400,
          { code: "unmanaged" },
        );
      }
      throw new SambaError("Share not found", 404);
    }
    return found;
  }

  return {
    async list(hostId) {
      const own = await managedShares(hostId);
      return [...own, ...(await others(hostId, own))];
    },

    async create(hostId, body) {
      const input = parseShare(body);
      const own = await managedShares(hostId);
      const all = [...own, ...(await others(hostId, own))];
      if (all.some((s) => s.name.toLowerCase() === input.name.toLowerCase())) {
        throw new SambaError("A share with this name already exists", 409);
      }
      await write(
        hostId,
        [...own.map(stripView), input],
        folderStep(body as CreateShareBody, input.path),
      );
    },

    async update(hostId, name, body) {
      const input = parseShare(body);
      const current = await need(hostId, name);
      const own = await managedShares(hostId);
      const renamed = input.name.toLowerCase() !== current.name.toLowerCase();
      if (renamed) {
        const all = [...own, ...(await others(hostId, own))];
        if (
          all.some((s) => s.name.toLowerCase() === input.name.toLowerCase())
        ) {
          throw new SambaError("A share with this name already exists", 409);
        }
      }
      const next = own.map((s) =>
        s.name === current.name ? input : stripView(s),
      );
      const p = q(input.path);
      await write(
        hostId,
        next,
        `[ -d ${p} ] || { echo "SAMBA_ERR:The folder does not exist on the host"; exit 7; }`,
      );
    },

    async remove(hostId, name) {
      const current = await need(hostId, name);
      const own = await managedShares(hostId);
      await write(
        hostId,
        own.filter((s) => s.name !== current.name).map(stripView),
        "",
      );
    },

    async permissions(hostId, name) {
      const share = await need(hostId, name);
      const p = q(sharePath(share.path));
      const out = await remote.root(
        hostId,
        `
P=${p}
if [ -e "$P" ]; then
  echo exists=1
  echo "owner=$(stat -c %U "$P")"
  echo "group=$(stat -c %G "$P")"
  echo "mode=$(stat -c %a "$P")"
  getfacl -p -c "$P" 2>/dev/null | grep -E '^(user|group):[^:]+:' | sed 's/^/acl=/' || true
else
  echo exists=0
fi
`,
      );
      const view: PermissionsView = {
        path: share.path,
        exists: false,
        owner: "",
        group: "",
        mode: "",
        acl: [],
      };
      for (const line of out.split("\n")) {
        const eq = line.indexOf("=");
        if (eq < 1) continue;
        const key = line.slice(0, eq);
        const value = line.slice(eq + 1).trim();
        if (key === "exists") view.exists = value === "1";
        else if (key === "owner") view.owner = value;
        else if (key === "group") view.group = value;
        else if (key === "mode") view.mode = value;
        else if (key === "acl") {
          const [type, aclName, perms] = value.split(":");
          if (
            (type === "user" || type === "group") &&
            aclName &&
            perms &&
            /^[r-][w-][x-]/.test(perms)
          ) {
            view.acl.push({ type, name: aclName, perms: perms.slice(0, 3) });
          }
        }
      }
      return view;
    },

    async setPermissions(hostId, name, body) {
      const b = (body ?? {}) as Record<string, unknown>;
      const share = await need(hostId, name);
      const owner = optionalName(b.owner, "Owner");
      const group = optionalName(b.group, "Group");
      const mode = mask(b.mode, "Mode");
      const set = parseAcl(b.setAcl);
      const clear = parseAcl(
        Array.isArray(b.removeAcl)
          ? (b.removeAcl as AclEntry[]).map((e) => ({ ...e, perms: "---" }))
          : [],
      );
      const flag = b.recursive === true ? "-R " : "";
      const p = q(sharePath(share.path));
      const lines = [
        "set -e",
        `P=${p}`,
        '[ -d "$P" ] || { echo "SAMBA_ERR:The folder does not exist on the host"; exit 7; }',
      ];
      if (owner || group) {
        lines.push(`chown ${flag}${q(ownerSpec(owner, group))} "$P"`);
      }
      if (mode) lines.push(`chmod ${flag}${mode} "$P"`);
      const prefix = (e: AclEntry) => (e.type === "user" ? "u" : "g");
      if (set.length || clear.length) {
        lines.push(
          'command -v setfacl >/dev/null 2>&1 || { echo "SAMBA_ERR:setfacl is not installed on the host"; exit 8; }',
        );
      }
      for (const e of set) {
        lines.push(
          `setfacl ${flag}-m ${q(`${prefix(e)}:${e.name}:${e.perms}`)} "$P"`,
        );
      }
      for (const e of clear) {
        lines.push(`setfacl ${flag}-x ${q(`${prefix(e)}:${e.name}`)} "$P"`);
      }
      lines.push("echo done");
      await remote.root(hostId, lines.join("\n"), 300_000);
    },
  };
}
