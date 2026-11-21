import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const invokeAction = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock("@termix-ssh/plugin-sdk/frontend", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  invokeAction,
  useToast: () => ({ error: vi.fn(), success: vi.fn() }),
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("../../src/frontend/api", () => ({
  errorMessage: (_e: unknown, fallback: string) => fallback,
  updateShare: vi.fn(),
  listShares: async () => [
    {
      name: "media",
      path: "/srv/media",
      comment: "",
      readOnly: false,
      guestOk: false,
      browseable: true,
      managed: true,
    },
  ],
}));

import { SharesView } from "../../src/frontend/SharesView";

describe("SharesView", () => {
  it("opens a share's folder in File Manager", async () => {
    const host = { id: 4, name: "nas" } as never;
    render(<SharesView host={host} hostId={4} onOpen={() => {}} isVisible />);
    await waitFor(() => expect(screen.getByText("media")).toBeTruthy());
    fireEvent.click(screen.getByLabelText("shares.browse"));
    expect(invokeAction).toHaveBeenCalledWith(
      "files.openHost",
      host,
      "/srv/media",
    );
  });
});
