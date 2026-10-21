import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "@termix-ssh/plugin-sdk/frontend";
import { Button, Segmented } from "@termix-ssh/plugin-sdk/ui";
import { errorMessage, getLogs } from "./api";

type Lines = "100" | "300" | "1000";

export function LogsView({ hostId }: { hostId: number }) {
  const { t } = useTranslation();
  const [lines, setLines] = useState<Lines>("100");
  const [text, setText] = useState<string | null>(null);
  const [failed, setFailed] = useState("");

  const load = useCallback(async () => {
    try {
      setText(await getLogs(hostId, Number(lines)));
      setFailed("");
    } catch (e) {
      setFailed(errorMessage(e, t("logs.loadFailed")));
    }
  }, [hostId, lines, t]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Segmented<Lines>
          value={lines}
          onChange={setLines}
          options={[
            { value: "100", label: t("logs.lines", { count: 100 }) },
            { value: "300", label: t("logs.lines", { count: 300 }) },
            { value: "1000", label: t("logs.lines", { count: 1000 }) },
          ]}
        />
        <Button variant="outline" onClick={() => void load()}>
          {t("tab.refresh")}
        </Button>
      </div>
      {failed ? (
        <p className="text-sm text-destructive">{failed}</p>
      ) : (
        <pre className="max-h-[60vh] overflow-auto whitespace-pre-wrap border border-border p-2 font-mono text-xs">
          {text === null ? "" : text.trim() || t("logs.empty")}
        </pre>
      )}
    </div>
  );
}
