import { useCallback, useEffect, useState } from "react";
import { Folder, FolderOpen, Lock } from "lucide-react";
import {
  invokeAction,
  useToast,
  useTranslation,
  type PluginHostRecord,
} from "@termix-ssh/plugin-sdk/frontend";
import {
  ListBadge,
  ListRow,
  ListRowAction,
  PanelList,
  PanelSearch,
  Switch,
  LoadingState,
  TOOLBAR_FIT,
} from "@termix-ssh/plugin-sdk/ui";
import type { ShareView } from "../shared/types";
import { errorMessage, listShares, updateShare } from "./api";

export function SharesView({
  host,
  hostId,
  onOpen,
  isVisible,
}: {
  /** Lets a share open in File Manager. */
  host?: PluginHostRecord;
  hostId: number;
  onOpen: (share: ShareView) => void;
  isVisible: boolean;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const [shares, setShares] = useState<ShareView[] | null>(null);
  const [failed, setFailed] = useState("");
  const [search, setSearch] = useState("");

  const load = useCallback(async () => {
    try {
      setShares(await listShares(hostId));
      setFailed("");
    } catch (e) {
      setFailed(errorMessage(e, t("shares.loadFailed")));
    }
  }, [hostId, t]);

  useEffect(() => {
    if (isVisible) void load();
  }, [isVisible, load]);

  const toggle = async (share: ShareView, browseable: boolean) => {
    const { managed: _managed, ...input } = share;
    void _managed;
    try {
      await updateShare(hostId, share.name, { ...input, browseable });
      await load();
    } catch (e) {
      toast.error(errorMessage(e, t("shares.saveFailed")));
    }
  };

  if (failed)
    return <p className="px-3 py-2 text-xs text-destructive">{failed}</p>;
  if (!shares) return <LoadingState />;

  const needle = search.trim().toLowerCase();
  const visible = shares.filter(
    (s) =>
      !needle ||
      s.name.toLowerCase().includes(needle) ||
      s.path.toLowerCase().includes(needle),
  );

  return (
    <div className="flex flex-col">
      <div className={`border-b border-border px-3 py-2 ${TOOLBAR_FIT}`}>
        <PanelSearch
          value={search}
          onChange={setSearch}
          placeholder={t("shares.search")}
        />
      </div>
      {visible.length === 0 ? (
        <p className="px-3 py-6 text-center text-xs text-muted-foreground/60">
          {t("shares.empty")}
        </p>
      ) : (
        <PanelList>
          {visible.map((share, index) => (
            <ListRow
              key={`${share.managed}-${share.name}`}
              stripe={index}
              icon={
                share.managed ? (
                  <Folder className="size-4" />
                ) : (
                  <Lock className="size-4" />
                )
              }
              title={share.name}
              tone={share.managed ? "brand" : undefined}
              onClick={() => onOpen(share)}
              badges={
                <>
                  <ListBadge>
                    {share.readOnly
                      ? t("shares.readOnly")
                      : t("shares.readWrite")}
                  </ListBadge>
                  {share.guestOk && <ListBadge>{t("shares.guest")}</ListBadge>}
                  {!share.managed && (
                    <ListBadge>{t("shares.external")}</ListBadge>
                  )}
                </>
              }
              meta={
                <span className="font-mono">
                  {share.path}
                  {share.comment ? ` | ${share.comment}` : ""}
                </span>
              }
              actions={
                host && share.path ? (
                  <ListRowAction
                    label={t("shares.browse")}
                    onClick={(event) => {
                      event.stopPropagation();
                      invokeAction("files.openHost", host, share.path).catch(
                        () => toast.error(t("shares.browseFailed")),
                      );
                    }}
                  >
                    <FolderOpen />
                  </ListRowAction>
                ) : undefined
              }
              trailing={
                share.managed ? (
                  <span onClick={(event) => event.stopPropagation()}>
                    <Switch
                      checked={share.browseable}
                      onCheckedChange={(value: boolean) =>
                        void toggle(share, value)
                      }
                      aria-label={t("shares.browseable")}
                    />
                  </span>
                ) : undefined
              }
            />
          ))}
        </PanelList>
      )}
    </div>
  );
}
