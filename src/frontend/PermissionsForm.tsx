import { useCallback, useEffect, useState } from "react";
import { X } from "lucide-react";
import { useToast, useTranslation } from "@termix-ssh/plugin-sdk/frontend";
import {
  Button,
  FormFooter,
  SelectField,
  SwitchRow,
  TextField,
} from "@termix-ssh/plugin-sdk/ui";
import type { AclEntry, PermissionsView } from "../shared/types";
import { errorMessage, getPermissions, savePermissions } from "./api";

const PERMS = ["r--", "r-x", "rw-", "rwx", "---"] as const;

const same = (a: AclEntry, b: AclEntry) =>
  a.type === b.type && a.name === b.name;

/** Owner, mode and ACL entries of a share's folder. */
export function PermissionsForm({
  hostId,
  name,
  aclReady,
}: {
  hostId: number;
  name: string;
  aclReady: boolean;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const [view, setView] = useState<PermissionsView | null>(null);
  const [owner, setOwner] = useState("");
  const [group, setGroup] = useState("");
  const [mode, setMode] = useState("");
  const [recursive, setRecursive] = useState(false);
  const [entries, setEntries] = useState<AclEntry[]>([]);
  const [draft, setDraft] = useState<AclEntry>({
    type: "user",
    name: "",
    perms: "rwx",
  });
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState("");

  const load = useCallback(async () => {
    try {
      const next = await getPermissions(hostId, name);
      setView(next);
      setOwner(next.owner);
      setGroup(next.group);
      setMode(next.mode);
      setEntries(next.acl);
      setFailed("");
    } catch (e) {
      setFailed(errorMessage(e, t("permissions.loadFailed")));
    }
  }, [hostId, name, t]);

  useEffect(() => {
    void load();
  }, [load]);

  if (failed) return <p className="text-xs text-destructive">{failed}</p>;
  if (!view) return null;
  if (!view.exists) {
    return (
      <p className="text-xs text-muted-foreground">
        {t("permissions.missing", { path: view.path })}
      </p>
    );
  }

  const addEntry = () => {
    const entryName = draft.name.trim();
    if (!entryName) return;
    const next = { ...draft, name: entryName };
    setEntries((list) => [...list.filter((e) => !same(e, next)), next]);
    setDraft({ ...draft, name: "" });
  };

  const save = async () => {
    setSaving(true);
    try {
      const original = view.acl;
      await savePermissions(hostId, name, {
        owner: owner !== view.owner ? owner : "",
        group: group !== view.group ? group : "",
        mode: mode !== view.mode ? mode : "",
        recursive,
        setAcl: entries.filter(
          (e) => !original.some((o) => same(o, e) && o.perms === e.perms),
        ),
        removeAcl: original.filter((o) => !entries.some((e) => same(o, e))),
      });
      toast.success(t("permissions.saved"));
      await load();
    } catch (e) {
      toast.error(errorMessage(e, t("permissions.saveFailed")));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <p className="font-mono text-xs text-muted-foreground">{view.path}</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <TextField
          label={t("shares.owner")}
          value={owner}
          onChange={setOwner}
        />
        <TextField
          label={t("shares.group")}
          value={group}
          onChange={setGroup}
        />
        <TextField
          label={t("shares.mode")}
          value={mode}
          onChange={setMode}
          mono
        />
      </div>
      <SwitchRow
        label={t("permissions.recursive")}
        description={t("permissions.recursiveDesc")}
        checked={recursive}
        onChange={setRecursive}
      />
      <div className="flex flex-col gap-2">
        <p className="text-xs font-medium">{t("permissions.acl")}</p>
        {!aclReady && (
          <p className="text-xs text-muted-foreground">
            {t("permissions.noAcl")}
          </p>
        )}
        {entries.length === 0 && aclReady && (
          <p className="text-xs text-muted-foreground">
            {t("permissions.noEntries")}
          </p>
        )}
        {entries.map((entry) => (
          <div
            key={`${entry.type}:${entry.name}`}
            className="flex items-center justify-between border border-border px-2 py-1 text-xs"
          >
            <span className="font-mono">
              {entry.type === "user" ? "u" : "g"}:{entry.name}:{entry.perms}
            </span>
            <Button
              variant="ghost"
              size="icon"
              title={t("common.delete")}
              onClick={() =>
                setEntries((list) => list.filter((e) => !same(e, entry)))
              }
            >
              <X className="size-4" />
            </Button>
          </div>
        ))}
        {aclReady && (
          <div className="grid grid-cols-1 items-end gap-2 sm:grid-cols-4">
            <SelectField<"user" | "group">
              label={t("permissions.type")}
              value={draft.type}
              onChange={(type) => setDraft({ ...draft, type })}
              options={[
                { value: "user", label: t("permissions.user") },
                { value: "group", label: t("permissions.group") },
              ]}
            />
            <TextField
              label={t("permissions.name")}
              value={draft.name}
              onChange={(entryName) => setDraft({ ...draft, name: entryName })}
            />
            <SelectField<string>
              label={t("permissions.access")}
              value={draft.perms}
              onChange={(perms) => setDraft({ ...draft, perms })}
              options={PERMS.map((p) => ({ value: p, label: p }))}
            />
            <Button variant="outline" onClick={addEntry}>
              {t("permissions.addEntry")}
            </Button>
          </div>
        )}
      </div>
      <FormFooter
        onSave={() => void save()}
        saving={saving}
        saveLabel={t("common.save")}
      />
    </div>
  );
}
