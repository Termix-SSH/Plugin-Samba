function settingsOf(
  host: object | null | undefined,
): Record<string, unknown> | undefined {
  const all = (host as { pluginSettings?: unknown } | null | undefined)
    ?.pluginSettings as
    Record<string, Record<string, unknown> | undefined> | undefined;
  return all?.samba;
}

export function sambaEnabled(host: object | null | undefined): boolean {
  return settingsOf(host)?.enableSamba === true;
}

/** Samba is on and the host allows its panel beside terminals. */
export function sambaPanelEnabled(host: object | null | undefined): boolean {
  return sambaEnabled(host) && settingsOf(host)?.showPanel !== false;
}
