import type { Router } from "express";
import type { PluginContext } from "@termix-ssh/plugin-sdk/backend";
import { createRemote } from "./remote.js";
import { registerOperations } from "./operations.js";
import { registerRoutes } from "./routes.js";
import { createService } from "./service.js";
import { createSessions } from "./sessions.js";
import { createShares } from "./shares.js";
import { createUsers } from "./users.js";

export async function activate(ctx: PluginContext) {
  const remote = createRemote(ctx);
  const service = createService(remote);
  const shares = createShares(remote, service);
  registerOperations(ctx, service, shares);
  registerRoutes(ctx.http.router<Router>(), ctx, {
    service,
    shares,
    users: createUsers(remote),
    sessions: createSessions(remote),
  });
  ctx.log.info("Samba routes mounted at /plugin-api/samba");
}

export async function deactivate() {
  // Everything above was registered through ctx and is disposed by core.
}
