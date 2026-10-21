import type { ConfigView, SambaStatus, TestResult } from "../shared/types.js";
import { MAIN_FILE, MANAGED_FILE } from "./config.js";
import { SambaError } from "./errors.js";
import { parseKeys, type Remote } from "./remote.js";
import { DETECT, ENSURE_INCLUDE } from "./scripts.js";
import { b64 } from "./validate.js";

export const SERVICE_ACTIONS = [
  "start",
  "stop",
  "restart",
  "enable",
  "disable",
  "reload",
] as const;
export type ServiceAction = (typeof SERVICE_ACTIONS)[number];

const MAX_CONFIG_BYTES = 200_000;

const STATUS_SCRIPT = `
KERNEL=$(uname -s 2>/dev/null)
echo "kernel=$KERNEL"
if { [ "$(id -u)" = 0 ] || sudo -n true 2>/dev/null; }; then echo root=1; else echo root=0; fi
. /etc/os-release 2>/dev/null
echo "os=$PRETTY_NAME"
pm=none
for c in apt-get dnf yum pacman apk zypper; do
  if command -v $c >/dev/null 2>&1; then pm=$c; break; fi
done
echo "pm=$pm"
if command -v smbd >/dev/null 2>&1; then
  echo installed=1
  echo "version=$(smbd --version 2>/dev/null | head -n1)"
else
  echo installed=0
fi
${DETECT}
echo "init=$INIT"
echo "svc=$SVC"
active=0; enabled=0
if [ "$INIT" = systemd ] && [ -n "$SVC" ]; then
  systemctl is-active "$SVC.service" 2>/dev/null | grep -qx active && active=1
  systemctl is-enabled "$SVC.service" 2>/dev/null | grep -qx enabled && enabled=1
elif [ "$INIT" = openrc ]; then
  rc-service samba status 2>/dev/null | grep -q started && active=1
  rc-update show 2>/dev/null | grep -q '^ *samba ' && enabled=1
else
  pgrep -x smbd >/dev/null 2>&1 && active=1
fi
echo "active=$active"
echo "enabled=$enabled"
fw=none
if command -v ufw >/dev/null 2>&1; then fw=ufw
elif command -v firewall-cmd >/dev/null 2>&1; then fw=firewalld; fi
echo "firewall=$fw"
se=none
command -v getenforce >/dev/null 2>&1 && se=$(getenforce 2>/dev/null | tr 'A-Z' 'a-z')
echo "selinux=$se"
if grep -qE '^[[:space:]]*include[[:space:]]*=[[:space:]]*${MANAGED_FILE}[[:space:]]*$' ${MAIN_FILE} 2>/dev/null; then echo included=1; else echo included=0; fi
command -v setfacl >/dev/null 2>&1 && echo acl=1 || echo acl=0
`;

const INSTALL_SCRIPT = `
set -e
pm=none
for c in apt-get dnf yum pacman apk zypper; do
  if command -v $c >/dev/null 2>&1; then pm=$c; break; fi
done
case "$pm" in
  apt-get) export DEBIAN_FRONTEND=noninteractive; apt-get update -qq; apt-get install -y samba acl ;;
  dnf) dnf install -y samba samba-client acl ;;
  yum) yum install -y samba samba-client acl ;;
  pacman) pacman -S --noconfirm --needed samba acl ;;
  apk) apk add samba acl ;;
  zypper) zypper --non-interactive install samba acl ;;
  *) echo "SAMBA_ERR:No supported package manager found on this host"; exit 5 ;;
esac
${ENSURE_INCLUDE}
${DETECT}
if [ "$INIT" = systemd ]; then
  for u in $UNITS; do systemctl enable --now "$u.service" || true; done
elif [ "$INIT" = openrc ]; then
  rc-update add samba default || true
  rc-service samba start || true
fi
echo done
`;

function serviceScript(action: ServiceAction): string {
  if (action === "reload") {
    return `smbcontrol all reload-config\necho done`;
  }
  return `
set -e
${DETECT}
if [ -z "$SVC" ]; then echo "SAMBA_ERR:No Samba service was found on this host"; exit 6; fi
if [ "$INIT" = systemd ]; then
  for u in $UNITS; do systemctl ${action} "$u.service"; done
else
  case "${action}" in
    enable) rc-update add samba default ;;
    disable) rc-update del samba default ;;
    *) rc-service samba ${action} ;;
  esac
fi
echo done
`;
}

export interface SambaService {
  status: (hostId: number) => Promise<SambaStatus>;
  install: (hostId: number) => Promise<void>;
  act: (hostId: number, action: ServiceAction) => Promise<void>;
  logs: (hostId: number, lines: number) => Promise<string>;
  readConfig: (hostId: number) => Promise<ConfigView>;
  readState: (hostId: number) => Promise<{ managed: string; main: string }>;
  effective: (hostId: number) => Promise<string>;
  applyConfig: (hostId: number, text: string, before?: string) => Promise<void>;
  testConfig: (hostId: number) => Promise<TestResult>;
}

export function createService(remote: Remote): SambaService {
  async function readState(hostId: number) {
    const out = await remote.root(
      hostId,
      `
echo '@@MANAGED@@'
cat ${MANAGED_FILE} 2>/dev/null || true
echo '@@MAIN@@'
cat ${MAIN_FILE} 2>/dev/null || true
`,
    );
    const [, rest = ""] = out.split("@@MANAGED@@\n");
    const [managed = "", main = ""] = rest.split("@@MAIN@@\n");
    return { managed, main };
  }

  async function applyConfig(hostId: number, text: string, before = "") {
    if (Buffer.byteLength(text) > MAX_CONFIG_BYTES || text.includes("\0")) {
      throw new SambaError("The config is too large or not valid");
    }
    await remote.root(
      hostId,
      `
set -e
${ENSURE_INCLUDE}
TMP=$(mktemp /etc/samba/termix.conf.XXXXXX)
CAND=$(mktemp /etc/samba/smb.cand.XXXXXX)
trap 'rm -f "$TMP" "$CAND"' EXIT
echo '${b64(text)}' | base64 -d > "$TMP"
sed "s#${MANAGED_FILE}#$TMP#" "$MAIN" > "$CAND"
if ! OUT=$(testparm -s "$CAND" 2>&1 >/dev/null); then
  echo "$OUT" | sed 's/^/SAMBA_ERR:/'
  exit 3
fi
${before}
install -m 644 "$TMP" "$CONF"
smbcontrol all reload-config >/dev/null 2>&1 || true
echo done
`,
      120_000,
    );
  }

  return {
    async status(hostId) {
      const k = parseKeys(await remote.plain(hostId, STATUS_SCRIPT));
      if (k.kernel && k.kernel !== "Linux") {
        throw new SambaError("Samba can only be managed on Linux hosts");
      }
      return {
        root: k.root === "1",
        os: k.os ?? "",
        packageManager: k.pm ?? "none",
        installed: k.installed === "1",
        version: k.version ?? "",
        init: k.init ?? "none",
        service: k.svc ?? "",
        active: k.active === "1",
        enabled: k.enabled === "1",
        firewall: k.firewall ?? "none",
        selinux: k.selinux ?? "none",
        included: k.included === "1",
        acl: k.acl === "1",
      };
    },

    async install(hostId) {
      await remote.root(hostId, INSTALL_SCRIPT, 600_000);
    },

    async act(hostId, action) {
      await remote.root(hostId, serviceScript(action), 90_000);
    },

    async logs(hostId, lines) {
      const n = Math.min(Math.max(Math.floor(lines) || 200, 20), 1000);
      return remote.root(
        hostId,
        `
${DETECT}
if [ "$INIT" = systemd ] && command -v journalctl >/dev/null 2>&1 && [ -n "$SVC" ]; then
  journalctl -u "$SVC.service" -n ${n} --no-pager 2>/dev/null
else
  tail -n ${n} /var/log/samba/log.smbd 2>/dev/null || true
fi
`,
      );
    },

    readState,

    async readConfig(hostId) {
      const { managed, main } = await readState(hostId);
      return { managed, main };
    },

    async effective(hostId) {
      return remote.root(hostId, "testparm -s 2>/dev/null || true");
    },

    applyConfig,

    async testConfig(hostId) {
      const out = await remote.root(
        hostId,
        `
if OUT=$(testparm -s 2>&1 >/dev/null); then echo ok=1; else echo ok=0; fi
echo '---'
echo "$OUT"
`,
      );
      const [head = "", ...rest] = out.split("\n---\n");
      return {
        ok: head.trim() === "ok=1",
        output: rest.join("\n---\n").trim(),
      };
    },
  };
}
