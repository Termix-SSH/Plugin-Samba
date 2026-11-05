import { useCallback, useEffect, useState } from "react";
import { Share2 } from "lucide-react";
import {
  useToast,
  useTranslation,
  type TabProps,
} from "@termix-ssh/plugin-sdk/frontend";
import {
  AddButton,
  Alert,
  AlertDescription,
  Button,
  PanelShell,
  useConfirm,
  EmptyState,
  PanelFrame,
  RefreshButton,
  TabStrip,
  NoticePanel,
} from "@termix-ssh/plugin-sdk/ui";
import type { SambaStatus, ShareView } from "../shared/types";
import { errorCode, errorMessage, getStatus, installSamba } from "./api";
import { ConfigView } from "./ConfigView";
import { Loading } from "./Loading";
import { LogsView } from "./LogsView";
import { ServiceView } from "./ServiceView";
import { SessionsView } from "./SessionsView";
import { ShareEditor } from "./ShareEditor";
import { SharesView } from "./SharesView";
import { UsersView } from "./UsersView";

type View = "shares" | "users" | "sessions" | "config" | "logs" | "service";

// A fixed height box, so the panel body inside it can scroll.
/** Samba for one host: shares, users, sessions, config, logs and service. */
export function SambaTab({ isVisible, host, label }: TabProps) {
  const { t } = useTranslation();
  const toast = useToast();
  const confirm = useConfirm();
  const hostId = Number(host?.id);
  const [status, setStatus] = useState<SambaStatus | null>(null);
  const [error, setError] = useState("");
  const [view, setView] = useState<View>("shares");
  const [editing, setEditing] = useState<ShareView | "new" | null>(null);
  const [loading, setLoading] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [tick, setTick] = useState(0);

  const load = useCallback(async () => {
    if (!hostId) return;
    setLoading(true);
    try {
      setStatus(await getStatus(hostId));
      setError("");
    } catch (e) {
      setError(
        errorCode(e) === "sudo"
          ? t("tab.sudo")
          : errorMessage(e, t("tab.error")),
      );
    } finally {
      setLoading(false);
    }
  }, [hostId, t]);

  useEffect(() => {
    if (!isVisible) return;
    void load();
  }, [isVisible, load]);

  const refresh = () => {
    void load();
    setTick((n) => n + 1);
  };

  const install = async () => {
    const ok = await confirm({
      title: t("install.title"),
      description: t("install.desc"),
      confirmLabel: t("install.confirm"),
    });
    if (!ok) return;
    setInstalling(true);
    try {
      await installSamba(hostId);
      toast.success(t("install.done"));
      await load();
    } catch (e) {
      toast.error(errorMessage(e, t("install.failed")));
    } finally {
      setInstalling(false);
    }
  };

  if (!host) {
    return <EmptyState title={t("tab.noHost")} />;
  }

  const title = label || host.name || t("tab.title");

  if (!status) {
    return (
      <PanelFrame>
        <PanelShell icon={<Share2 className="size-4" />} title={title}>
          {error ? (
            <p className="px-3 py-2 text-xs text-destructive">{error}</p>
          ) : (
            <Loading />
          )}
        </PanelShell>
      </PanelFrame>
    );
  }

  if (editing) {
    return (
      <PanelFrame>
        <ShareEditor
          // A fresh editor per share so old form state never carries over.
          key={editing === "new" ? "new" : editing.name}
          hostId={hostId}
          share={editing === "new" ? null : editing}
          status={status}
          onClose={() => setEditing(null)}
          reload={refresh}
        />
      </PanelFrame>
    );
  }

  const running = status.installed && status.active;

  return (
    <PanelFrame>
      <PanelShell
        icon={<Share2 className="size-4" />}
        title={title}
        status={
          status.installed
            ? `${running ? t("tab.running") : t("tab.stopped")}${
                status.version ? ` | ${status.version}` : ""
              }`
            : t("tab.notInstalled")
        }
        actions={
          <>
            <RefreshButton
              onClick={refresh}
              loading={loading}
              label={t("tab.refresh")}
            />
            {status.installed && view === "shares" && (
              <AddButton
                label={t("shares.add")}
                onClick={() => setEditing("new")}
              />
            )}
          </>
        }
        tabs={
          status.installed ? (
            <TabStrip
              tabs={[
                { id: "shares", label: t("tab.viewShares") },
                { id: "users", label: t("tab.viewUsers") },
                { id: "sessions", label: t("tab.viewSessions") },
                { id: "config", label: t("tab.viewConfig") },
                { id: "logs", label: t("tab.viewLogs") },
                { id: "service", label: t("tab.viewService") },
              ]}
              activeTab={view}
              onTabChange={(id) => setView(id as View)}
            />
          ) : undefined
        }
        scroll={view !== "logs"}
      >
        <div
          className={`flex flex-col ${view === "logs" ? "min-h-0 flex-1" : "shrink-0"}`}
        >
          {!status.root && (
            <Alert className="border-x-0 border-t-0">
              <AlertDescription className="text-xs">
                {t("tab.sudo")}
              </AlertDescription>
            </Alert>
          )}
          {!status.installed ? (
            <NoticePanel
              icon={Share2}
              title={t("install.empty")}
              action={
                <Button
                  onClick={() => void install()}
                  disabled={
                    installing ||
                    !status.root ||
                    status.packageManager === "none"
                  }
                >
                  {installing ? t("install.working") : t("install.button")}
                </Button>
              }
            >
              {status.packageManager === "none"
                ? t("install.noManager")
                : t("install.hint", {
                    os: status.os || t("install.thisHost"),
                  })}
            </NoticePanel>
          ) : view === "shares" ? (
            <SharesView
              key={tick}
              hostId={hostId}
              onOpen={setEditing}
              isVisible={isVisible}
            />
          ) : view === "users" ? (
            <UsersView key={tick} hostId={hostId} />
          ) : view === "sessions" ? (
            <SessionsView key={tick} hostId={hostId} isVisible={isVisible} />
          ) : view === "config" ? (
            <ConfigView key={tick} hostId={hostId} />
          ) : view === "logs" ? (
            <LogsView key={tick} hostId={hostId} />
          ) : (
            <ServiceView status={status} hostId={hostId} reload={refresh} />
          )}
        </div>
      </PanelShell>
    </PanelFrame>
  );
}
