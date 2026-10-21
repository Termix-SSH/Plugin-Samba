import { useState } from "react";
import { Share2 } from "lucide-react";
import { useToast, useTranslation } from "@termix-ssh/plugin-sdk/frontend";
import {
  BackButton,
  Facts,
  FormFooter,
  PanelShell,
  Segmented,
  SwitchRow,
  TextField,
  useConfirm,
} from "@termix-ssh/plugin-sdk/ui";
import type { CreateShareBody, SambaStatus, ShareView } from "../shared/types";
import { createShare, deleteShare, errorMessage, updateShare } from "./api";
import { PermissionsForm } from "./PermissionsForm";

interface FormState {
  name: string;
  path: string;
  comment: string;
  browseable: boolean;
  readOnly: boolean;
  guestOk: boolean;
  validUsers: string;
  writeList: string;
  forceUser: string;
  forceGroup: string;
  createMask: string;
  directoryMask: string;
  hideDotFiles: boolean;
  recycleBin: boolean;
  inheritPermissions: boolean;
  makeFolder: boolean;
  owner: string;
  group: string;
  mode: string;
}

type Section = "general" | "access" | "permissions";

const words = (text: string) => text.split(/[\s,]+/).filter(Boolean);

function initial(share: ShareView | null): FormState {
  return {
    name: share?.name ?? "",
    path: share?.path ?? "",
    comment: share?.comment ?? "",
    browseable: share?.browseable ?? true,
    readOnly: share?.readOnly ?? false,
    guestOk: share?.guestOk ?? false,
    validUsers: (share?.validUsers ?? []).join(" "),
    writeList: (share?.writeList ?? []).join(" "),
    forceUser: share?.forceUser ?? "",
    forceGroup: share?.forceGroup ?? "",
    createMask: share?.createMask ?? "",
    directoryMask: share?.directoryMask ?? "",
    hideDotFiles: share?.hideDotFiles ?? false,
    recycleBin: share?.recycleBin ?? false,
    inheritPermissions: share?.inheritPermissions ?? false,
    makeFolder: !share,
    owner: "",
    group: "",
    mode: "",
  };
}

function toBody(form: FormState): CreateShareBody {
  return {
    name: form.name.trim(),
    path: form.path.trim(),
    comment: form.comment.trim(),
    browseable: form.browseable,
    readOnly: form.readOnly,
    guestOk: form.guestOk,
    validUsers: words(form.validUsers),
    writeList: words(form.writeList),
    forceUser: form.forceUser.trim(),
    forceGroup: form.forceGroup.trim(),
    createMask: form.createMask.trim(),
    directoryMask: form.directoryMask.trim(),
    hideDotFiles: form.hideDotFiles,
    recycleBin: form.recycleBin,
    inheritPermissions: form.inheritPermissions,
    makeFolder: form.makeFolder,
    owner: form.owner.trim(),
    group: form.group.trim(),
    mode: form.mode.trim(),
  };
}

/** One share in full. Shares from smb.conf open read only. */
export function ShareEditor({
  hostId,
  share,
  status,
  onClose,
  reload,
}: {
  hostId: number;
  share: ShareView | null;
  status: SambaStatus;
  onClose: () => void;
  reload: () => void;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const confirm = useConfirm();
  const [form, setForm] = useState<FormState>(() => initial(share));
  const [section, setSection] = useState<Section>("general");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const set = (patch: Partial<FormState>) =>
    setForm((current) => ({ ...current, ...patch }));
  const external = share !== null && !share.managed;

  const save = async () => {
    setSaving(true);
    setError("");
    try {
      const body = toBody(form);
      if (share) await updateShare(hostId, share.name, body);
      else await createShare(hostId, body);
      reload();
      onClose();
    } catch (e) {
      setError(errorMessage(e, t("shares.saveFailed")));
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!share) return;
    const ok = await confirm({
      title: t("shares.deleteTitle", { name: share.name }),
      description: t("shares.deleteDesc"),
      confirmLabel: t("common.delete"),
    });
    if (!ok) return;
    try {
      await deleteShare(hostId, share.name);
      reload();
      onClose();
    } catch (e) {
      toast.error(errorMessage(e, t("shares.deleteFailed")));
    }
  };

  return (
    <PanelShell
      icon={<Share2 className="size-4" />}
      leading={<BackButton onClick={onClose} />}
      title={share ? share.name : t("shares.addTitle")}
      status={share?.path}
      className="gap-2 p-2.5"
    >
      <div className="flex shrink-0 flex-col gap-3">
        {external && (
          <div className="flex flex-col gap-1 border border-border p-3 text-xs">
            <p>{t("shares.externalNote")}</p>
            <Facts>
              <span className="font-mono">{share.path}</span>
              <span>
                {share.readOnly ? t("shares.readOnly") : t("shares.readWrite")}
              </span>
              {share.guestOk && <span>{t("shares.guest")}</span>}
              {share.validUsers.length > 0 && (
                <span>
                  {t("shares.validUsers")}: {share.validUsers.join(", ")}
                </span>
              )}
            </Facts>
          </div>
        )}
        {!external && (
          <>
            <Segmented<Section>
              className="self-start"
              value={section}
              onChange={setSection}
              options={[
                { value: "general", label: t("shares.sectionGeneral") },
                { value: "access", label: t("shares.sectionAccess") },
                ...(share
                  ? [
                      {
                        value: "permissions" as const,
                        label: t("shares.sectionPermissions"),
                      },
                    ]
                  : []),
              ]}
            />
            {section === "general" && (
              <>
                <TextField
                  label={t("shares.name")}
                  value={form.name}
                  onChange={(name) => set({ name })}
                  placeholder="documents"
                />
                <TextField
                  label={t("shares.path")}
                  value={form.path}
                  onChange={(path) => set({ path })}
                  placeholder="/srv/documents"
                  mono
                />
                <TextField
                  label={t("shares.comment")}
                  value={form.comment}
                  onChange={(comment) => set({ comment })}
                />
                {!share && (
                  <>
                    <SwitchRow
                      label={t("shares.makeFolder")}
                      description={t("shares.makeFolderDesc")}
                      checked={form.makeFolder}
                      onChange={(makeFolder) => set({ makeFolder })}
                    />
                    {form.makeFolder && (
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                        <TextField
                          label={t("shares.owner")}
                          value={form.owner}
                          onChange={(owner) => set({ owner })}
                        />
                        <TextField
                          label={t("shares.group")}
                          value={form.group}
                          onChange={(group) => set({ group })}
                        />
                        <TextField
                          label={t("shares.mode")}
                          value={form.mode}
                          onChange={(mode) => set({ mode })}
                          placeholder="0770"
                          mono
                        />
                      </div>
                    )}
                  </>
                )}
              </>
            )}
            {section === "access" && (
              <>
                <SwitchRow
                  label={t("shares.browseable")}
                  description={t("shares.browseableDesc")}
                  checked={form.browseable}
                  onChange={(browseable) => set({ browseable })}
                />
                <SwitchRow
                  label={t("shares.readOnly")}
                  description={t("shares.readOnlyDesc")}
                  checked={form.readOnly}
                  onChange={(readOnly) => set({ readOnly })}
                />
                <SwitchRow
                  label={t("shares.guest")}
                  description={t("shares.guestDesc")}
                  checked={form.guestOk}
                  onChange={(guestOk) => set({ guestOk })}
                />
                <TextField
                  label={t("shares.validUsers")}
                  hint={t("shares.listHint")}
                  value={form.validUsers}
                  onChange={(validUsers) => set({ validUsers })}
                  placeholder="alice @staff"
                  mono
                />
                <TextField
                  label={t("shares.writeList")}
                  hint={t("shares.writeListHint")}
                  value={form.writeList}
                  onChange={(writeList) => set({ writeList })}
                  mono
                />
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <TextField
                    label={t("shares.forceUser")}
                    value={form.forceUser}
                    onChange={(forceUser) => set({ forceUser })}
                  />
                  <TextField
                    label={t("shares.forceGroup")}
                    value={form.forceGroup}
                    onChange={(forceGroup) => set({ forceGroup })}
                  />
                  <TextField
                    label={t("shares.createMask")}
                    value={form.createMask}
                    onChange={(createMask) => set({ createMask })}
                    placeholder="0664"
                    mono
                  />
                  <TextField
                    label={t("shares.directoryMask")}
                    value={form.directoryMask}
                    onChange={(directoryMask) => set({ directoryMask })}
                    placeholder="0775"
                    mono
                  />
                </div>
                <SwitchRow
                  label={t("shares.inherit")}
                  description={t("shares.inheritDesc")}
                  checked={form.inheritPermissions}
                  onChange={(inheritPermissions) => set({ inheritPermissions })}
                />
                <SwitchRow
                  label={t("shares.hideDot")}
                  checked={form.hideDotFiles}
                  onChange={(hideDotFiles) => set({ hideDotFiles })}
                />
                <SwitchRow
                  label={t("shares.recycle")}
                  description={t("shares.recycleDesc")}
                  checked={form.recycleBin}
                  onChange={(recycleBin) => set({ recycleBin })}
                />
              </>
            )}
            {section === "permissions" && share && (
              <PermissionsForm
                hostId={hostId}
                name={share.name}
                aclReady={status.acl}
              />
            )}
            {error && <p className="text-xs text-destructive">{error}</p>}
            {section !== "permissions" && (
              <FormFooter
                onCancel={onClose}
                onSave={() => void save()}
                saving={saving}
                saveLabel={t("common.save")}
                cancelLabel={t("common.cancel")}
                onDelete={share ? () => void remove() : undefined}
                deleteLabel={t("common.delete")}
                disabled={!form.name.trim() || !form.path.trim()}
              />
            )}
          </>
        )}
      </div>
    </PanelShell>
  );
}
