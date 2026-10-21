import { useState } from "react";
import { useToast, useTranslation } from "@termix-ssh/plugin-sdk/frontend";
import { Button, Facts, SwitchRow } from "@termix-ssh/plugin-sdk/ui";
import type { SambaStatus } from "../shared/types";
import { errorMessage, serviceAction } from "./api";

export function ServiceView({
  status,
  hostId,
  reload,
}: {
  status: SambaStatus;
  hostId: number;
  reload: () => void;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  const run = async (action: string) => {
    setBusy(true);
    try {
      await serviceAction(hostId, action);
      reload();
    } catch (e) {
      toast.error(errorMessage(e, t("service.failed")));
    } finally {
      setBusy(false);
    }
  };

  const firewall =
    status.firewall === "ufw"
      ? "ufw allow samba"
      : status.firewall === "firewalld"
        ? "firewall-cmd --permanent --add-service=samba && firewall-cmd --reload"
        : "";

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1 border border-border p-3 text-xs">
        <Facts>
          <span>{status.active ? t("tab.running") : t("tab.stopped")}</span>
          {status.version && <span>{status.version}</span>}
          {status.service && (
            <span className="font-mono">{status.service}</span>
          )}
          <span>{status.init}</span>
          {status.os && <span>{status.os}</span>}
        </Facts>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          disabled={busy || status.active}
          onClick={() => void run("start")}
        >
          {t("service.start")}
        </Button>
        <Button
          variant="outline"
          disabled={busy || !status.active}
          onClick={() => void run("stop")}
        >
          {t("service.stop")}
        </Button>
        <Button
          variant="outline"
          disabled={busy}
          onClick={() => void run("restart")}
        >
          {t("service.restart")}
        </Button>
        <Button
          variant="outline"
          disabled={busy || !status.active}
          onClick={() => void run("reload")}
        >
          {t("service.reload")}
        </Button>
      </div>
      <SwitchRow
        label={t("service.autostart")}
        description={t("service.autostartDesc")}
        checked={status.enabled}
        disabled={busy}
        onChange={(value) => void run(value ? "enable" : "disable")}
      />
      {!status.included && (
        <p className="border border-border p-2 text-xs text-muted-foreground">
          {t("service.notIncluded")}
        </p>
      )}
      {firewall && (
        <div className="flex flex-col gap-1 border border-border p-3 text-xs">
          <p>{t("service.firewall")}</p>
          <code className="font-mono">{firewall}</code>
        </div>
      )}
      {status.selinux === "enforcing" && (
        <div className="flex flex-col gap-1 border border-border p-3 text-xs">
          <p>{t("service.selinux")}</p>
          <code className="font-mono">setsebool -P samba_export_all_rw on</code>
        </div>
      )}
    </div>
  );
}
