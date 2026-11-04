import { useTranslation } from "@termix-ssh/plugin-sdk/frontend";

export function Loading() {
  const { t } = useTranslation();
  return (
    <p className="p-2 text-xs text-muted-foreground">{t("common.loading")}</p>
  );
}
