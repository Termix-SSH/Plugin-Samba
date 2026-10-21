import { useCallback, useEffect, useState } from "react";
import { Plug, Unplug } from "lucide-react";
import { useToast, useTranslation } from "@termix-ssh/plugin-sdk/frontend";
import {
  ListRow,
  ListRowAction,
  PanelList,
  useConfirm,
} from "@termix-ssh/plugin-sdk/ui";
import type { SessionsView as Data } from "../shared/types";
import { disconnectSession, errorMessage, getSessions } from "./api";

export function SessionsView({
  hostId,
  isVisible,
}: {
  hostId: number;
  isVisible: boolean;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const confirm = useConfirm();
  const [data, setData] = useState<Data | null>(null);
  const [failed, setFailed] = useState("");

  const load = useCallback(async () => {
    try {
      setData(await getSessions(hostId));
      setFailed("");
    } catch (e) {
      setFailed(errorMessage(e, t("sessions.loadFailed")));
    }
  }, [hostId, t]);

  useEffect(() => {
    if (!isVisible) return;
    void load();
    const timer = setInterval(() => void load(), 5000);
    return () => clearInterval(timer);
  }, [isVisible, load]);

  if (failed) return <p className="p-2 text-sm text-destructive">{failed}</p>;
  if (!data) return null;

  const disconnect = async (pid: number, user: string) => {
    const ok = await confirm({
      title: t("sessions.disconnectTitle", { name: user || String(pid) }),
      description: t("sessions.disconnectDesc"),
      confirmLabel: t("sessions.disconnect"),
    });
    if (!ok) return;
    try {
      await disconnectSession(hostId, pid);
      await load();
    } catch (e) {
      toast.error(errorMessage(e, t("sessions.disconnectFailed")));
    }
  };

  if (!data.json) {
    return (
      <pre className="overflow-auto border border-border p-2 font-mono text-xs">
        {data.raw || t("sessions.none")}
      </pre>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <p className="text-xs font-medium">{t("sessions.users")}</p>
        {data.sessions.length === 0 ? (
          <p className="px-1 py-4 text-center text-xs text-muted-foreground/60">
            {t("sessions.none")}
          </p>
        ) : (
          <PanelList>
            {data.sessions.map((s, index) => (
              <ListRow
                key={`${s.pid}-${index}`}
                stripe={index}
                icon={<Plug className="size-4" />}
                title={s.user || String(s.pid)}
                meta={[s.machine, s.protocol, `pid ${s.pid}`]
                  .filter(Boolean)
                  .join(" | ")}
                actions={
                  <ListRowAction
                    label={t("sessions.disconnect")}
                    tone="destructive"
                    onClick={() => void disconnect(s.pid, s.user)}
                  >
                    <Unplug className="size-4" />
                  </ListRowAction>
                }
              />
            ))}
          </PanelList>
        )}
      </div>
      {data.connections.length > 0 && (
        <div className="flex flex-col gap-1">
          <p className="text-xs font-medium">{t("sessions.shares")}</p>
          <PanelList>
            {data.connections.map((c, index) => (
              <ListRow
                key={`${c.pid}-${c.share}-${index}`}
                stripe={index}
                title={c.share}
                meta={[c.machine, c.since].filter(Boolean).join(" | ")}
              />
            ))}
          </PanelList>
        </div>
      )}
      <div className="flex flex-col gap-1">
        <p className="text-xs font-medium">{t("sessions.files")}</p>
        {data.files.length === 0 ? (
          <p className="px-1 py-4 text-center text-xs text-muted-foreground/60">
            {t("sessions.noFiles")}
          </p>
        ) : (
          <PanelList>
            {data.files.map((f, index) => (
              <ListRow
                key={`${f.pid}-${f.file}-${index}`}
                stripe={index}
                title={<span className="font-mono">{f.file}</span>}
                meta={[f.user, f.share].filter(Boolean).join(" | ")}
              />
            ))}
          </PanelList>
        )}
      </div>
    </div>
  );
}
