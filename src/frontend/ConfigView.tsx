import { useCallback, useEffect, useState } from "react";
import { useToast, useTranslation } from "@termix-ssh/plugin-sdk/frontend";
import { Button, FormFooter, TextAreaField } from "@termix-ssh/plugin-sdk/ui";
import type { ConfigView as Data, TestResult } from "../shared/types";
import { errorMessage, getConfig, saveConfig, testConfig } from "./api";

export function ConfigView({ hostId }: { hostId: number }) {
  const { t } = useTranslation();
  const toast = useToast();
  const [data, setData] = useState<Data | null>(null);
  const [text, setText] = useState("");
  const [failed, setFailed] = useState("");
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<TestResult | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const next = await getConfig(hostId);
      setData(next);
      setText(next.managed);
      setFailed("");
    } catch (e) {
      setFailed(errorMessage(e, t("config.loadFailed")));
    }
  }, [hostId, t]);

  useEffect(() => {
    void load();
  }, [load]);

  if (failed) return <p className="p-2 text-sm text-destructive">{failed}</p>;
  if (!data) return null;

  const save = async () => {
    setSaving(true);
    setError("");
    try {
      await saveConfig(hostId, text);
      toast.success(t("config.saved"));
      await load();
    } catch (e) {
      setError(errorMessage(e, t("config.saveFailed")));
    } finally {
      setSaving(false);
    }
  };

  const test = async () => {
    try {
      setResult(await testConfig(hostId));
    } catch (e) {
      toast.error(errorMessage(e, t("config.testFailed")));
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <TextAreaField
        label={t("config.managed")}
        hint={t("config.managedHint")}
        value={text}
        onChange={setText}
        rows={14}
        mono
      />
      {error && (
        <pre className="whitespace-pre-wrap border border-border p-2 font-mono text-xs text-destructive">
          {error}
        </pre>
      )}
      <FormFooter
        onSave={() => void save()}
        saving={saving}
        dirty={text !== data.managed}
        saveLabel={t("common.save")}
        extra={
          <Button variant="outline" onClick={() => void test()}>
            {t("config.test")}
          </Button>
        }
      />
      {result && (
        <div className="flex flex-col gap-1">
          <p
            className={`text-xs ${result.ok ? "text-accent-brand" : "text-destructive"}`}
          >
            {result.ok ? t("config.testOk") : t("config.testBad")}
          </p>
          {result.output && (
            <pre className="overflow-auto whitespace-pre-wrap border border-border p-2 font-mono text-xs">
              {result.output}
            </pre>
          )}
        </div>
      )}
      <TextAreaField
        label={t("config.main")}
        hint={t("config.mainHint")}
        value={data.main}
        onChange={() => undefined}
        rows={10}
        mono
        disabled
      />
    </div>
  );
}
