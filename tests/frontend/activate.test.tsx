import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import {
  renderWithApp,
  type RenderedPluginApp,
} from "@termix-ssh/plugin-sdk/testing";
import type { PluginManifest } from "@termix-ssh/plugin-sdk/manifest";
import * as plugin from "../../src/frontend/index";
import manifestJson from "../../manifest.json";
import locales from "../../locales/en.json";

const manifest = manifestJson as unknown as PluginManifest;

let rendered: RenderedPluginApp | null = null;

afterEach(async () => {
  await rendered?.deactivate();
  rendered = null;
});

const status = {
  root: true,
  os: "Debian GNU/Linux 12",
  packageManager: "apt-get",
  installed: true,
  version: "Version 4.17.12",
  init: "systemd",
  service: "smbd",
  active: true,
  enabled: true,
  firewall: "ufw",
  selinux: "none",
  included: true,
  acl: true,
};

const shares = [
  {
    managed: true,
    name: "docs",
    path: "/srv/docs",
    comment: "Team files",
    browseable: true,
    readOnly: false,
    guestOk: false,
    validUsers: ["alice"],
    writeList: [],
    forceUser: "",
    forceGroup: "",
    createMask: "",
    directoryMask: "",
    hideDotFiles: false,
    recycleBin: false,
    inheritPermissions: false,
  },
  {
    managed: false,
    name: "media",
    path: "/srv/media",
    comment: "",
    browseable: true,
    readOnly: true,
    guestOk: true,
    validUsers: [],
    writeList: [],
    forceUser: "",
    forceGroup: "",
    createMask: "",
    directoryMask: "",
    hideDotFiles: false,
    recycleBin: false,
    inheritPermissions: false,
  },
];

function api(current: unknown) {
  return {
    get: vi.fn(async (url: string) => ({
      data: url.endsWith("/status")
        ? current
        : url.endsWith("/shares")
          ? shares
          : {},
    })),
  } as never;
}

const host = { id: 1, name: "files", enableSsh: true };

describe(`${manifest.id} activate`, () => {
  it("registers the host tab", async () => {
    rendered = await renderWithApp(plugin, { manifest, locales });
    expect(rendered.registered.tabs()).toEqual(["samba"]);
  });

  it("lists managed and external shares", async () => {
    rendered = await renderWithApp(plugin, {
      manifest,
      locales,
      api: api(status),
    });
    rendered.renderTab("samba", { isVisible: true, host });
    expect(await screen.findByText("docs")).toBeTruthy();
    expect(screen.getByText("media")).toBeTruthy();
    expect(screen.getByText(locales.shares.external)).toBeTruthy();
  });

  it("opens a managed share and goes back", async () => {
    rendered = await renderWithApp(plugin, {
      manifest,
      locales,
      api: api(status),
    });
    rendered.renderTab("samba", { isVisible: true, host });
    fireEvent.click(await screen.findByText("docs"));
    expect(await screen.findByText(locales.shares.sectionAccess)).toBeTruthy();
    fireEvent.click(screen.getByText(locales.common.cancel));
    expect(await screen.findByText("media")).toBeTruthy();
  });

  it("opens an external share read only", async () => {
    rendered = await renderWithApp(plugin, {
      manifest,
      locales,
      api: api(status),
    });
    rendered.renderTab("samba", { isVisible: true, host });
    fireEvent.click(await screen.findByText("media"));
    expect(await screen.findByText(locales.shares.externalNote)).toBeTruthy();
    expect(screen.queryByText(locales.common.save)).toBeNull();
  });

  it("offers to install when Samba is missing", async () => {
    rendered = await renderWithApp(plugin, {
      manifest,
      locales,
      api: api({ ...status, installed: false, active: false }),
    });
    rendered.renderTab("samba", { isVisible: true, host });
    expect(await screen.findByText(locales.install.empty)).toBeTruthy();
    expect(screen.getByText(locales.install.button)).toBeTruthy();
  });

  it("shows an error when the host cannot be read", async () => {
    rendered = await renderWithApp(plugin, {
      manifest,
      locales,
      api: {
        get: vi.fn(async () => {
          throw new Error("offline");
        }),
      } as never,
    });
    rendered.renderTab("samba", { isVisible: true, host });
    expect(await screen.findByText(locales.tab.error)).toBeTruthy();
  });
});
