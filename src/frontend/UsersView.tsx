import { useCallback, useEffect, useState } from "react";
import { KeyRound, Power, Trash2, User, Users } from "lucide-react";
import { useToast, useTranslation } from "@termix-ssh/plugin-sdk/frontend";
import {
  Button,
  FormFooter,
  ListBadge,
  ListRow,
  ListRowAction,
  PanelList,
  SecretField,
  SelectField,
  SwitchRow,
  TextField,
  useConfirm,
} from "@termix-ssh/plugin-sdk/ui";
import type { SambaGroup, SambaUser, UsersView as Data } from "../shared/types";
import {
  addGroup,
  addUser,
  errorMessage,
  listUsers,
  removeUser,
  setMember,
  setUserDisabled,
  setUserPassword,
} from "./api";

type Mode =
  | { kind: "list" }
  | { kind: "addUser" }
  | { kind: "password"; name: string }
  | { kind: "addGroup" }
  | { kind: "group"; name: string };

export function UsersView({ hostId }: { hostId: number }) {
  const { t } = useTranslation();
  const toast = useToast();
  const confirm = useConfirm();
  const [data, setData] = useState<Data | null>(null);
  const [failed, setFailed] = useState("");
  const [mode, setMode] = useState<Mode>({ kind: "list" });
  const [text, setText] = useState("");
  const [pass, setPass] = useState("");
  const [createSystem, setCreateSystem] = useState(true);
  const [pick, setPick] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await listUsers(hostId));
      setFailed("");
    } catch (e) {
      setFailed(errorMessage(e, t("users.loadFailed")));
    }
  }, [hostId, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const go = (next: Mode) => {
    setText("");
    setPass("");
    setPick("");
    setCreateSystem(true);
    setMode(next);
  };

  const run = async (job: () => Promise<void>, fallback: string) => {
    setSaving(true);
    try {
      await job();
      await load();
      return true;
    } catch (e) {
      toast.error(errorMessage(e, fallback));
      return false;
    } finally {
      setSaving(false);
    }
  };

  if (failed) return <p className="p-2 text-sm text-destructive">{failed}</p>;
  if (!data) return null;

  if (mode.kind === "addUser") {
    const known = data.system.includes(text.trim());
    return (
      <div className="flex flex-col gap-3">
        <TextField
          label={t("users.name")}
          value={text}
          onChange={setText}
          hint={known ? t("users.existsHint") : undefined}
        />
        <SecretField
          label={t("users.password")}
          value={pass}
          onChange={setPass}
        />
        <SwitchRow
          label={t("users.createSystem")}
          description={t("users.createSystemDesc")}
          checked={createSystem || !known}
          onChange={setCreateSystem}
          disabled={!known}
        />
        <FormFooter
          onCancel={() => go({ kind: "list" })}
          onSave={() =>
            void run(
              () =>
                addUser(hostId, {
                  name: text.trim(),
                  password: pass,
                  createSystem: createSystem || !known,
                }),
              t("users.saveFailed"),
            ).then((ok) => ok && go({ kind: "list" }))
          }
          saving={saving}
          disabled={!text.trim() || !pass}
          saveLabel={t("common.save")}
          cancelLabel={t("common.cancel")}
        />
      </div>
    );
  }

  if (mode.kind === "password") {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-xs text-muted-foreground">
          {t("users.passwordFor", { name: mode.name })}
        </p>
        <SecretField
          label={t("users.password")}
          value={pass}
          onChange={setPass}
        />
        <FormFooter
          onCancel={() => go({ kind: "list" })}
          onSave={() =>
            void run(
              () => setUserPassword(hostId, mode.name, pass),
              t("users.saveFailed"),
            ).then((ok) => ok && go({ kind: "list" }))
          }
          saving={saving}
          disabled={!pass}
          saveLabel={t("common.save")}
          cancelLabel={t("common.cancel")}
        />
      </div>
    );
  }

  if (mode.kind === "addGroup") {
    return (
      <div className="flex flex-col gap-3">
        <TextField
          label={t("users.groupName")}
          value={text}
          onChange={setText}
        />
        <FormFooter
          onCancel={() => go({ kind: "list" })}
          onSave={() =>
            void run(
              () => addGroup(hostId, text.trim()),
              t("users.saveFailed"),
            ).then((ok) => ok && go({ kind: "list" }))
          }
          saving={saving}
          disabled={!text.trim()}
          saveLabel={t("common.save")}
          cancelLabel={t("common.cancel")}
        />
      </div>
    );
  }

  if (mode.kind === "group") {
    const group = data.groups.find((g) => g.name === mode.name);
    const free = data.system.filter((u) => !group?.members.includes(u));
    return (
      <div className="flex flex-col gap-3">
        <p className="text-sm font-medium">{mode.name}</p>
        {group?.members.length ? (
          <PanelList>
            {group.members.map((member, index) => (
              <ListRow
                key={member}
                stripe={index}
                icon={<User className="size-4" />}
                title={member}
                actions={
                  <ListRowAction
                    label={t("users.removeMember")}
                    tone="destructive"
                    onClick={() =>
                      void run(
                        () => setMember(hostId, mode.name, member, false),
                        t("users.saveFailed"),
                      )
                    }
                  >
                    <Trash2 className="size-4" />
                  </ListRowAction>
                }
              />
            ))}
          </PanelList>
        ) : (
          <p className="text-xs text-muted-foreground">
            {t("users.noMembers")}
          </p>
        )}
        {free.length > 0 && (
          <div className="grid grid-cols-1 items-end gap-2 sm:grid-cols-2">
            <SelectField<string>
              label={t("users.addMember")}
              value={pick}
              onChange={setPick}
              placeholder={t("users.pickUser")}
              options={free.map((u) => ({ value: u, label: u }))}
            />
            <Button
              variant="outline"
              disabled={!pick || saving}
              onClick={() =>
                void run(
                  () => setMember(hostId, mode.name, pick, true),
                  t("users.saveFailed"),
                ).then(() => setPick(""))
              }
            >
              {t("users.addMemberButton")}
            </Button>
          </div>
        )}
        <FormFooter
          onCancel={() => go({ kind: "list" })}
          cancelLabel={t("common.back")}
        />
      </div>
    );
  }

  const toggle = (user: SambaUser) =>
    void run(
      () => setUserDisabled(hostId, user.name, !user.disabled),
      t("users.saveFailed"),
    );

  const remove = async (user: SambaUser) => {
    const ok = await confirm({
      title: t("users.deleteTitle", { name: user.name }),
      description: t("users.deleteDesc"),
      confirmLabel: t("common.delete"),
    });
    if (ok) {
      await run(
        () => removeUser(hostId, user.name, false),
        t("users.deleteFailed"),
      );
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" onClick={() => go({ kind: "addUser" })}>
          {t("users.add")}
        </Button>
        <Button variant="outline" onClick={() => go({ kind: "addGroup" })}>
          {t("users.addGroup")}
        </Button>
      </div>
      <div className="flex flex-col gap-1">
        <p className="text-xs font-medium">{t("users.title")}</p>
        {data.samba.length === 0 ? (
          <p className="px-1 py-4 text-center text-xs text-muted-foreground/60">
            {t("users.empty")}
          </p>
        ) : (
          <PanelList>
            {data.samba.map((user, index) => (
              <ListRow
                key={user.name}
                stripe={index}
                icon={<User className="size-4" />}
                title={user.name}
                dimmed={user.disabled}
                badges={
                  user.disabled ? (
                    <ListBadge>{t("users.disabled")}</ListBadge>
                  ) : undefined
                }
                meta={user.fullName || undefined}
                actions={
                  <>
                    <ListRowAction
                      label={t("users.setPassword")}
                      onClick={() => go({ kind: "password", name: user.name })}
                    >
                      <KeyRound className="size-4" />
                    </ListRowAction>
                    <ListRowAction
                      label={
                        user.disabled ? t("users.enable") : t("users.disable")
                      }
                      onClick={() => toggle(user)}
                    >
                      <Power className="size-4" />
                    </ListRowAction>
                    <ListRowAction
                      label={t("common.delete")}
                      tone="destructive"
                      onClick={() => void remove(user)}
                    >
                      <Trash2 className="size-4" />
                    </ListRowAction>
                  </>
                }
              />
            ))}
          </PanelList>
        )}
      </div>
      <div className="flex flex-col gap-1">
        <p className="text-xs font-medium">{t("users.groups")}</p>
        {data.groups.length === 0 ? (
          <p className="px-1 py-4 text-center text-xs text-muted-foreground/60">
            {t("users.noGroups")}
          </p>
        ) : (
          <PanelList>
            {data.groups.map((group: SambaGroup, index) => (
              <ListRow
                key={group.name}
                stripe={index}
                icon={<Users className="size-4" />}
                title={group.name}
                meta={group.members.join(", ") || t("users.noMembers")}
                onClick={() => go({ kind: "group", name: group.name })}
              />
            ))}
          </PanelList>
        )}
      </div>
    </div>
  );
}
