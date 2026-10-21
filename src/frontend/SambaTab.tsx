import { useCallback, useEffect, useState, type ReactNode } from "react";
import { RefreshCw, Share2 } from "lucide-react";
import {
  useToast,
  useTranslation,
  type TabProps,
} from "@termix-ssh/plugin-sdk/frontend";
import {
  AddButton,
  Alert,
  Button,
  PanelShell,
  Segmented,
  useConfirm,
} from "@termix-ssh/plugin-sdk/ui";
import type { SambaStatus, ShareView } from "../shared/types";
import { errorCode, errorMessage, getStatus, installSamba } from "./api";
import { ConfigView } from "./ConfigView";
import { LogsView } from "./LogsView";
import { ServiceView } from "./ServiceView";
import { SessionsView } from "./SessionsView";
import { ShareEditor } from "./ShareEditor";
import { SharesView } from "./SharesView";
import { UsersView } from "./UsersView";

type View = "shares" | "users" | "sessions" | "config" | "logs" | "service";

// A fixed height box, so the panel body inside it can scroll.
function Frame({ children }: { children: ReactNode }) {
  return (
    <div className="h-full w-full overflow-hidden">
      <div className="flex h-full w-full min-h-0 flex-1 flex-col overflow-hidden">
        {children}
      </div>
    </div>
  );
}

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
    return (
      <p className="p-4 text-sm text-muted-foreground">{t("tab.noHost")}</p>
    );
  }

  const title = label || host.name || t("tab.title");

  if (!status) {
    return (
      <Frame>
        <PanelShell
          icon={<Share2 className="size-4" />}
          title={title}
          className="gap-2 p-2.5"
        >
          {error ? (
            <p className="p-2 text-sm text-destructive">{error}</p>
          ) : null}
        </PanelShell>
      </Frame>
    );
  }

  if (editing) {
    return (
      <Frame>
        <ShareEditor
          // A fresh editor per share so old form state never carries over.
          key={editing === "new" ? "new" : editing.name}
          hostId={hostId}
          share={editing === "new" ? null : editing}
          status={status}
          onClose={() => setEditing(null)}
          reload={refresh}
        />
      </Frame>
    );
  }

  const running = status.installed && status.active;

  return (
    <Frame>
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
            <Button
              variant="ghost"
              size="icon"
              onClick={refresh}
              disabled={loading}
              title={t("tab.refresh")}
              className="text-accent-brand"
            >
              <RefreshCw
                className={`size-4 ${loading ? "animate-spin" : ""}`}
              />
            </Button>
            {status.installed && view === "shares" && (
              <AddButton
                label={t("shares.add")}
                onClick={() => setEditing("new")}
              />
            )}
          </>
        }
        toolbar={
          status.installed ? (
            <Segmented<View>
              value={view}
              onChange={setView}
              options={[
                { value: "shares", label: t("tab.viewShares") },
                { value: "users", label: t("tab.viewUsers") },
                { value: "sessions", label: t("tab.viewSessions") },
                { value: "config", label: t("tab.viewConfig") },
                { value: "logs", label: t("tab.viewLogs") },
                { value: "service", label: t("tab.viewService") },
              ]}
            />
          ) : undefined
        }
        className="gap-2 p-2.5"
      >
        <div className="flex shrink-0 flex-col gap-2">
          {!status.root && (
            <Alert className="rounded-none text-xs">{t("tab.sudo")}</Alert>
          )}
          {!status.installed ? (
            <div className="flex flex-col items-start gap-3 border border-border p-4">
              <Share2 className="size-5 text-muted-foreground" />
              <p className="text-sm font-medium">{t("install.empty")}</p>
              <p className="text-xs text-muted-foreground">
                {status.packageManager === "none"
                  ? t("install.noManager")
                  : t("install.hint", {
                      os: status.os || t("install.thisHost"),
                    })}
              </p>
              <Button
                onClick={() => void install()}
                disabled={
                  installing || !status.root || status.packageManager === "none"
                }
              >
                {installing ? t("install.working") : t("install.button")}
              </Button>
            </div>
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
    </Frame>
  );
}
