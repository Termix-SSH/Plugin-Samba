import { Share2 } from "lucide-react";
import type { TermixApp } from "@termix-ssh/plugin-sdk/frontend";
import { initApi } from "./api";
import { sambaEnabled, sambaPanelEnabled } from "./enabled";
import { SambaHostsCard } from "./SambaHostsCard";
import { SambaTab } from "./SambaTab";
import { SambaCompanion, useSambaCompanionDefaults } from "./SambaCompanion";

const TAB_ID = "samba";

export function activate(app: TermixApp): void {
  initApi(app.api);
  // Host actions filter synchronously, so the permission is read once here.
  let canUse = true;
  void app.hasPermission("use").then((allowed) => {
    canUse = allowed;
  });

  app.registerTab(TAB_ID, SambaTab, {
    icon: Share2,
    titleKey: "tab.title",
    requiresHost: true,
    noHostMessageKey: "tab.noHost",
    persistent: true,
  });
  app.registerHostAction({
    id: TAB_ID,
    titleKey: "tab.title",
    icon: Share2,
    kind: "open",
    order: 46,
    tabType: TAB_ID,
    when: (host) => canUse && !!host.enableSsh && sambaEnabled(host),
  });

  app.registerDashboardCard({
    id: "samba-hosts",
    titleKey: "card.title",
    defaultPanel: "side",
    defaultHeight: 220,
    frame: "framed",
    component: SambaHostsCard,
  });

  if (typeof app.registerCompanion === "function") {
    app.registerCompanion(TAB_ID, SambaCompanion, {
      icon: Share2,
      titleKey: "tab.title",
      order: 46,
      tabTypes: ["terminal"],
      when: (_tab, host) =>
        canUse && !!host?.enableSsh && sambaPanelEnabled(host),
      useDefaults: useSambaCompanionDefaults,
    });
    app.registerAction("samba.togglePanel", ((_handle: unknown, tab: unknown) =>
      app.toggleCompanion(tab as never, TAB_ID)) as never);
    app.registerSlotContribution("tab.menu", {
      actionId: "samba.togglePanel",
      titleKey: "nav.togglePanel",
      icon: Share2,
      kind: "button",
      order: 46,
      when: (context) =>
        (context.tab as { type?: string } | null)?.type === "terminal",
    });
  }
}
