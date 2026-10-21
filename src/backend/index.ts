import type { Router } from "express";
import type { PluginContext } from "@termix-ssh/plugin-sdk/backend";
import { createRemote } from "./remote.js";
import { registerRoutes } from "./routes.js";
import { createService } from "./service.js";
import { createSessions } from "./sessions.js";
import { createShares } from "./shares.js";
import { createUsers } from "./users.js";

export async function activate(ctx: PluginContext) {
  const remote = createRemote(ctx);
  const service = createService(remote);
  registerRoutes(ctx.http.router<Router>(), ctx, {
    service,
    shares: createShares(remote, service),
    users: createUsers(remote),
    sessions: createSessions(remote),
  });
  ctx.log.info("Samba routes mounted at /plugin-api/samba");
}

export async function deactivate() {
  // Everything above was registered through ctx and is disposed by core.
}
