import type {
  ConnectionRow,
  OpenFileRow,
  SessionRow,
  SessionsView,
} from "../shared/types.js";
import type { Remote } from "./remote.js";
import { pid as checkPid } from "./validate.js";

type Obj = Record<string, unknown>;

const obj = (value: unknown): Obj =>
  value && typeof value === "object" ? (value as Obj) : {};
const str = (value: unknown): string =>
  typeof value === "string" ? value : value == null ? "" : String(value);
const num = (value: unknown): number => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};
const pidOf = (value: unknown): number => num(obj(obj(value).server_id).pid);

/** Reads smbstatus -j output. Unknown fields are skipped. */
export function parseStatusJson(text: string): Omit<SessionsView, "raw"> {
  const data = obj(JSON.parse(text));
  const sessions: SessionRow[] = Object.values(obj(data.sessions)).map((s) => {
    const o = obj(s);
    return {
      pid: pidOf(o),
      user: str(o.username),
      group: str(o.groupname),
      machine: str(o.remote_machine) || str(o.hostname),
      protocol: str(o.session_dialect),
    };
  });
  const connections: ConnectionRow[] = Object.values(obj(data.tcons)).map(
    (t) => {
      const o = obj(t);
      return {
        pid: pidOf(o),
        share: str(o.service),
        machine: str(o.machine),
        since: str(o.connected_at),
      };
    },
  );
  const files: OpenFileRow[] = [];
  for (const entry of Object.values(obj(data.open_files))) {
    const f = obj(entry);
    for (const open of Object.values(obj(f.opens))) {
      const o = obj(open);
      files.push({
        pid: pidOf(o),
        share: str(f.service_path),
        user: str(o.username) || str(o.uid),
        file: str(f.filename),
      });
    }
  }
  return { json: true, sessions, connections, files };
}

export interface SessionManager {
  list: (hostId: number) => Promise<SessionsView>;
  disconnect: (hostId: number, pid: unknown) => Promise<void>;
}

export function createSessions(remote: Remote): SessionManager {
  return {
    async list(hostId) {
      const out = await remote.root(
        hostId,
        `
if OUT=$(smbstatus -j 2>/dev/null) && [ -n "$OUT" ]; then
  echo '@@JSON@@'
  echo "$OUT"
else
  echo '@@TEXT@@'
  smbstatus 2>&1 || true
fi
`,
      );
      const empty = { json: false, sessions: [], connections: [], files: [] };
      if (out.startsWith("@@JSON@@\n")) {
        try {
          return {
            ...parseStatusJson(out.slice("@@JSON@@\n".length)),
            raw: "",
          };
        } catch {
          return { ...empty, raw: out.slice("@@JSON@@\n".length).trim() };
        }
      }
      return { ...empty, raw: out.replace(/^@@TEXT@@\n/, "").trim() };
    },

    async disconnect(hostId, value) {
      const pid = checkPid(value);
      await remote.root(
        hostId,
        `
P=${pid}
if [ "$(ps -o comm= -p "$P" 2>/dev/null | tr -d ' ')" != smbd ]; then
  echo "SAMBA_ERR:That session is no longer running"
  exit 9
fi
kill "$P"
echo done
`,
      );
    },
  };
}
