import type {
  PluginContext,
  PluginOperationContext,
} from "@termix-ssh/plugin-sdk/backend";
import type { SambaService } from "./service.js";

type Shares = {
  list: (hostId: number) => Promise<
    {
      name: string;
      path: string;
      comment: string;
      readOnly: boolean;
      guestOk: boolean;
      managed: boolean;
    }[]
  >;
};

function requireHost(context: PluginOperationContext): number {
  if (context.hostId === undefined) throw new Error("This needs a host");
  return context.hostId;
}

/** Everything Samba offers to the rest of Termix. */
export function registerOperations(
  ctx: PluginContext,
  service: SambaService,
  shares: Shares,
): void {
  if (typeof ctx.operations?.register !== "function") return;

  ctx.operations.register("samba.list-shares", {
    run: async (_input, context) => {
      const rows = (await shares.list(requireHost(context))).map((share) => ({
        name: share.name,
        path: share.path,
        comment: share.comment,
        access: share.readOnly ? "read only" : "read and write",
        guests: share.guestOk ? "yes" : "no",
        managed: share.managed,
      }));
      return { summary: `${rows.length} shares`, data: { rows } };
    },
  });

  ctx.operations.register("samba.status", {
    run: async (_input, context) => {
      const status = await service.status(requireHost(context));
      const label = !status.installed
        ? "Not installed"
        : status.active
          ? "Running"
          : "Stopped";
      return {
        summary: label,
        data: {
          value: label,
          status: status.installed && status.active ? "ok" : "warn",
          label,
        },
      };
    },
  });

  for (const action of ["start", "stop", "restart", "reload"] as const) {
    ctx.operations.register(`samba.${action}`, {
      describe: () => `Would ${action} Samba`,
      run: async (_input, context) => {
        await service.act(requireHost(context), action);
        return { summary: `Samba: ${action} done`, changed: true };
      },
    });
  }
}
