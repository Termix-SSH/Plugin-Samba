import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "@termix-ssh/plugin-sdk/frontend";
import {
  Button,
  Segmented,
  ToolbarBand,
  LoadingState,
} from "@termix-ssh/plugin-sdk/ui";
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
    <div className="flex min-h-0 flex-1 flex-col">
      <ToolbarBand>
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
      </ToolbarBand>
      {failed ? (
        <p className="px-3 py-2 text-xs text-destructive">{failed}</p>
      ) : text === null ? (
        <LoadingState />
      ) : (
        <pre className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap p-3 font-mono text-xs thin-scrollbar">
          {text.trim() || t("logs.empty")}
        </pre>
      )}
    </div>
  );
}
