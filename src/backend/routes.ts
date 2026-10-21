import type { Request, Response, Router } from "express";
import type { PluginContext } from "@termix-ssh/plugin-sdk/backend";
import { SambaError } from "./errors.js";
import type { SessionManager } from "./sessions.js";
import { SERVICE_ACTIONS, type SambaService } from "./service.js";
import type { ShareManager } from "./shares.js";
import type { UserManager } from "./users.js";

export interface Deps {
  service: SambaService;
  shares: ShareManager;
  users: UserManager;
  sessions: SessionManager;
}

type Level = "connect" | "edit";

/** Maps a thrown error to a JSON answer. Unknown errors are not shown. */
function fail(ctx: PluginContext, res: Response, error: unknown): void {
  if (error instanceof SambaError) {
    res.status(error.status).json({ error: error.message, ...error.extra });
    return;
  }
  ctx.log.warn(
    `Samba request failed: ${error instanceof Error ? error.message : String(error)}`,
  );
  res.status(500).json({ error: "Something went wrong" });
}

/**
 * Mounts the Samba routes on the plugin's router, which core serves at
 * /plugin-api/samba with auth and the samba.use permission in front. Reads
 * need connect access to the host, changes need edit access.
 */
export function registerRoutes(
  router: Router,
  ctx: PluginContext,
  deps: Deps,
): void {
  const { service, shares, users, sessions } = deps;

  router.use(ctx.rbac.require("use") as never);
  router.use((_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    next();
  });

  async function gate(hostId: number, level: Level): Promise<void> {
    if (!Number.isInteger(hostId) || hostId < 1) {
      throw new SambaError("The host id is not valid");
    }
    if ((await ctx.hosts.checkAccess(hostId, level)).hasAccess) return;
    if (
      level === "edit" &&
      (await ctx.hosts.checkAccess(hostId, "connect")).hasAccess
    ) {
      throw new SambaError("You need edit access to this host", 403, {
        code: "HOST_EDIT_REQUIRED",
      });
    }
    throw new SambaError("Host not found", 404);
  }

  const read =
    (run: (hostId: number, req: Request) => Promise<unknown>) =>
    async (req: Request, res: Response) => {
      try {
        const hostId = Number(req.params.hostId);
        await gate(hostId, "connect");
        res.json(await run(hostId, req));
      } catch (error) {
        fail(ctx, res, error);
      }
    };

  /** A change: needs edit access and is written to the audit log. */
  const write =
    (
      action: string,
      run: (hostId: number, req: Request) => Promise<unknown>,
      target?: (req: Request) => string | undefined,
    ) =>
    async (req: Request, res: Response) => {
      const hostId = Number(req.params.hostId);
      const name = target?.(req);
      try {
        await gate(hostId, "edit");
        const result = await run(hostId, req);
        void ctx.audit.record({
          action: `samba.${action}`,
          resourceType: "host",
          resourceId: String(hostId),
          resourceName: name,
          success: true,
        });
        res.json(result ?? { ok: true });
      } catch (error) {
        void ctx.audit.record({
          action: `samba.${action}`,
          resourceType: "host",
          resourceId: String(hostId),
          resourceName: name,
          success: false,
          errorMessage: error instanceof Error ? error.message : undefined,
        });
        fail(ctx, res, error);
      }
    };

  const param = (req: Request, key: string) => String(req.params[key] ?? "");
  const body = (req: Request) => req.body as Record<string, unknown>;

  /**
   * @openapi
   * /plugin-api/samba/{hostId}/status:
   *   get:
   *     summary: Samba status on a host
   *     description: Reports whether Samba is installed and running, the package manager, firewall and whether root or passwordless sudo is available.
   *     tags:
   *       - Samba
   *     parameters:
   *       - in: path
   *         name: hostId
   *         required: true
   *         schema:
   *           type: integer
   *     responses:
   *       200:
   *         description: The Samba status.
   */
  router.get(
    "/:hostId/status",
    read((hostId) => service.status(hostId)),
  );

  /**
   * @openapi
   * /plugin-api/samba/{hostId}/install:
   *   post:
   *     summary: Install Samba
   *     description: Installs Samba and the ACL tools with the host's package manager, sets up the managed config and starts the service.
   *     tags:
   *       - Samba
   *     parameters:
   *       - in: path
   *         name: hostId
   *         required: true
   *         schema:
   *           type: integer
   *     responses:
   *       200:
   *         description: Samba is installed.
   */
  router.post(
    "/:hostId/install",
    write("install", (hostId) => service.install(hostId)),
  );

  /**
   * @openapi
   * /plugin-api/samba/{hostId}/service/{action}:
   *   post:
   *     summary: Control the Samba service
   *     description: Starts, stops, restarts, enables or disables the Samba service, or reloads its config.
   *     tags:
   *       - Samba
   *     parameters:
   *       - in: path
   *         name: hostId
   *         required: true
   *         schema:
   *           type: integer
   *       - in: path
   *         name: action
   *         required: true
   *         schema:
   *           type: string
   *           enum: [start, stop, restart, enable, disable, reload]
   *     responses:
   *       200:
   *         description: The action ran.
   */
  router.post(
    "/:hostId/service/:action",
    write(
      "service",
      async (hostId, req) => {
        const action = param(req, "action");
        if (!(SERVICE_ACTIONS as readonly string[]).includes(action)) {
          throw new SambaError("Unknown action");
        }
        await service.act(hostId, action as (typeof SERVICE_ACTIONS)[number]);
      },
      (req) => param(req, "action"),
    ),
  );

  /**
   * @openapi
   * /plugin-api/samba/{hostId}/shares:
   *   get:
   *     summary: List shares
   *     description: Lists the shares this plugin manages and the other shares in smb.conf, which are read only.
   *     tags:
   *       - Samba
   *     parameters:
   *       - in: path
   *         name: hostId
   *         required: true
   *         schema:
   *           type: integer
   *     responses:
   *       200:
   *         description: A list of shares.
   */
  router.get(
    "/:hostId/shares",
    read((hostId) => shares.list(hostId)),
  );

  /**
   * @openapi
   * /plugin-api/samba/{hostId}/shares:
   *   post:
   *     summary: Create a share
   *     description: Adds a share to the managed config. The new config is tested before it is used. It can also make the folder and set its owner, group and mode.
   *     tags:
   *       - Samba
   *     parameters:
   *       - in: path
   *         name: hostId
   *         required: true
   *         schema:
   *           type: integer
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *     responses:
   *       200:
   *         description: The share was created.
   *       409:
   *         description: A share with this name exists.
   */
  router.post(
    "/:hostId/shares",
    write(
      "share.create",
      (hostId, req) => shares.create(hostId, req.body),
      (req) => String(body(req)?.name ?? ""),
    ),
  );

  /**
   * @openapi
   * /plugin-api/samba/{hostId}/shares/{name}:
   *   put:
   *     summary: Update a share
   *     description: Replaces the settings of a managed share. Shares from smb.conf cannot be changed here.
   *     tags:
   *       - Samba
   *     parameters:
   *       - in: path
   *         name: hostId
   *         required: true
   *         schema:
   *           type: integer
   *       - in: path
   *         name: name
   *         required: true
   *         schema:
   *           type: string
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *     responses:
   *       200:
   *         description: The share was updated.
   */
  router.put(
    "/:hostId/shares/:name",
    write(
      "share.update",
      (hostId, req) => shares.update(hostId, param(req, "name"), req.body),
      (req) => param(req, "name"),
    ),
  );

  /**
   * @openapi
   * /plugin-api/samba/{hostId}/shares/{name}:
   *   delete:
   *     summary: Delete a share
   *     description: Removes a managed share from the config. The folder and its files stay on the host.
   *     tags:
   *       - Samba
   *     parameters:
   *       - in: path
   *         name: hostId
   *         required: true
   *         schema:
   *           type: integer
   *       - in: path
   *         name: name
   *         required: true
   *         schema:
   *           type: string
   *     responses:
   *       200:
   *         description: The share was removed.
   */
  router.delete(
    "/:hostId/shares/:name",
    write(
      "share.delete",
      (hostId, req) => shares.remove(hostId, param(req, "name")),
      (req) => param(req, "name"),
    ),
  );

  /**
   * @openapi
   * /plugin-api/samba/{hostId}/shares/{name}/permissions:
   *   get:
   *     summary: Folder permissions of a share
   *     description: Returns the owner, group, mode and user and group ACL entries of a managed share's folder.
   *     tags:
   *       - Samba
   *     parameters:
   *       - in: path
   *         name: hostId
   *         required: true
   *         schema:
   *           type: integer
   *       - in: path
   *         name: name
   *         required: true
   *         schema:
   *           type: string
   *     responses:
   *       200:
   *         description: The folder permissions.
   */
  router.get(
    "/:hostId/shares/:name/permissions",
    read((hostId, req) => shares.permissions(hostId, param(req, "name"))),
  );

  /**
   * @openapi
   * /plugin-api/samba/{hostId}/shares/{name}/permissions:
   *   put:
   *     summary: Change folder permissions of a share
   *     description: Sets the owner, group and mode, and adds or removes user and group ACL entries on a managed share's folder.
   *     tags:
   *       - Samba
   *     parameters:
   *       - in: path
   *         name: hostId
   *         required: true
   *         schema:
   *           type: integer
   *       - in: path
   *         name: name
   *         required: true
   *         schema:
   *           type: string
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *     responses:
   *       200:
   *         description: The permissions were changed.
   */
  router.put(
    "/:hostId/shares/:name/permissions",
    write(
      "share.permissions",
      (hostId, req) =>
        shares.setPermissions(hostId, param(req, "name"), req.body),
      (req) => param(req, "name"),
    ),
  );

  /**
   * @openapi
   * /plugin-api/samba/{hostId}/users:
   *   get:
   *     summary: List Samba users and groups
   *     description: Lists Samba users, Linux users that could be added, and Linux groups.
   *     tags:
   *       - Samba
   *     parameters:
   *       - in: path
   *         name: hostId
   *         required: true
   *         schema:
   *           type: integer
   *     responses:
   *       200:
   *         description: The users and groups.
   */
  router.get(
    "/:hostId/users",
    read((hostId) => users.list(hostId)),
  );

  /**
   * @openapi
   * /plugin-api/samba/{hostId}/users:
   *   post:
   *     summary: Add a Samba user
   *     description: Adds a Samba user with a password. The Linux user is created without a login shell when it does not exist.
   *     tags:
   *       - Samba
   *     parameters:
   *       - in: path
   *         name: hostId
   *         required: true
   *         schema:
   *           type: integer
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               name:
   *                 type: string
   *               password:
   *                 type: string
   *               createSystem:
   *                 type: boolean
   *     responses:
   *       200:
   *         description: The user was added.
   */
  router.post(
    "/:hostId/users",
    write(
      "user.create",
      (hostId, req) => users.add(hostId, req.body),
      (req) => String(body(req)?.name ?? ""),
    ),
  );

  /**
   * @openapi
   * /plugin-api/samba/{hostId}/users/{name}/password:
   *   post:
   *     summary: Set a Samba password
   *     description: Sets the Samba password of a user. The password is sent to the host over the SSH session and is never stored.
   *     tags:
   *       - Samba
   *     parameters:
   *       - in: path
   *         name: hostId
   *         required: true
   *         schema:
   *           type: integer
   *       - in: path
   *         name: name
   *         required: true
   *         schema:
   *           type: string
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               password:
   *                 type: string
   *     responses:
   *       200:
   *         description: The password was set.
   */
  router.post(
    "/:hostId/users/:name/password",
    write(
      "user.password",
      (hostId, req) =>
        users.setPassword(hostId, param(req, "name"), body(req)?.password),
      (req) => param(req, "name"),
    ),
  );

  /**
   * @openapi
   * /plugin-api/samba/{hostId}/users/{name}/state:
   *   post:
   *     summary: Enable or disable a Samba user
   *     description: Turns a Samba account on or off without deleting it.
   *     tags:
   *       - Samba
   *     parameters:
   *       - in: path
   *         name: hostId
   *         required: true
   *         schema:
   *           type: integer
   *       - in: path
   *         name: name
   *         required: true
   *         schema:
   *           type: string
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               disabled:
   *                 type: boolean
   *     responses:
   *       200:
   *         description: The account was changed.
   */
  router.post(
    "/:hostId/users/:name/state",
    write(
      "user.state",
      (hostId, req) =>
        users.setDisabled(
          hostId,
          param(req, "name"),
          body(req)?.disabled === true,
        ),
      (req) => param(req, "name"),
    ),
  );

  /**
   * @openapi
   * /plugin-api/samba/{hostId}/users/{name}:
   *   delete:
   *     summary: Remove a Samba user
   *     description: Removes the Samba account. With removeSystem set it also deletes the Linux user when its id is in the normal user range.
   *     tags:
   *       - Samba
   *     parameters:
   *       - in: path
   *         name: hostId
   *         required: true
   *         schema:
   *           type: integer
   *       - in: path
   *         name: name
   *         required: true
   *         schema:
   *           type: string
   *       - in: query
   *         name: removeSystem
   *         schema:
   *           type: boolean
   *     responses:
   *       200:
   *         description: The user was removed.
   */
  router.delete(
    "/:hostId/users/:name",
    write(
      "user.delete",
      (hostId, req) =>
        users.remove(
          hostId,
          param(req, "name"),
          req.query.removeSystem === "true",
        ),
      (req) => param(req, "name"),
    ),
  );

  /**
   * @openapi
   * /plugin-api/samba/{hostId}/groups:
   *   post:
   *     summary: Create a Linux group
   *     description: Creates a Linux group that can be used in share access lists.
   *     tags:
   *       - Samba
   *     parameters:
   *       - in: path
   *         name: hostId
   *         required: true
   *         schema:
   *           type: integer
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               name:
   *                 type: string
   *     responses:
   *       200:
   *         description: The group was created.
   */
  router.post(
    "/:hostId/groups",
    write(
      "group.create",
      (hostId, req) => users.addGroup(hostId, String(body(req)?.name ?? "")),
      (req) => String(body(req)?.name ?? ""),
    ),
  );

  /**
   * @openapi
   * /plugin-api/samba/{hostId}/groups/{name}/members:
   *   post:
   *     summary: Add or remove a group member
   *     description: Adds a user to a Linux group or removes the user from it.
   *     tags:
   *       - Samba
   *     parameters:
   *       - in: path
   *         name: hostId
   *         required: true
   *         schema:
   *           type: integer
   *       - in: path
   *         name: name
   *         required: true
   *         schema:
   *           type: string
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               user:
   *                 type: string
   *               add:
   *                 type: boolean
   *     responses:
   *       200:
   *         description: The membership was changed.
   */
  router.post(
    "/:hostId/groups/:name/members",
    write(
      "group.member",
      (hostId, req) =>
        users.member(
          hostId,
          param(req, "name"),
          String(body(req)?.user ?? ""),
          body(req)?.add !== false,
        ),
      (req) => param(req, "name"),
    ),
  );

  /**
   * @openapi
   * /plugin-api/samba/{hostId}/sessions:
   *   get:
   *     summary: Connected users and open files
   *     description: Returns the output of smbstatus as sessions, share connections and open files.
   *     tags:
   *       - Samba
   *     parameters:
   *       - in: path
   *         name: hostId
   *         required: true
   *         schema:
   *           type: integer
   *     responses:
   *       200:
   *         description: The live sessions.
   */
  router.get(
    "/:hostId/sessions",
    read((hostId) => sessions.list(hostId)),
  );

  /**
   * @openapi
   * /plugin-api/samba/{hostId}/sessions/{pid}/disconnect:
   *   post:
   *     summary: Disconnect a session
   *     description: Ends the smbd process that serves a client connection.
   *     tags:
   *       - Samba
   *     parameters:
   *       - in: path
   *         name: hostId
   *         required: true
   *         schema:
   *           type: integer
   *       - in: path
   *         name: pid
   *         required: true
   *         schema:
   *           type: integer
   *     responses:
   *       200:
   *         description: The session was ended.
   */
  router.post(
    "/:hostId/sessions/:pid/disconnect",
    write(
      "session.disconnect",
      (hostId, req) => sessions.disconnect(hostId, req.params.pid),
      (req) => param(req, "pid"),
    ),
  );

  /**
   * @openapi
   * /plugin-api/samba/{hostId}/config:
   *   get:
   *     summary: Read the config
   *     description: Returns the managed drop-in file and the main smb.conf.
   *     tags:
   *       - Samba
   *     parameters:
   *       - in: path
   *         name: hostId
   *         required: true
   *         schema:
   *           type: integer
   *     responses:
   *       200:
   *         description: The config files.
   */
  router.get(
    "/:hostId/config",
    read((hostId) => service.readConfig(hostId)),
  );

  /**
   * @openapi
   * /plugin-api/samba/{hostId}/config:
   *   put:
   *     summary: Replace the managed config
   *     description: Replaces the managed drop-in file with raw text. It is tested with testparm first and the old file stays when the test fails.
   *     tags:
   *       - Samba
   *     parameters:
   *       - in: path
   *         name: hostId
   *         required: true
   *         schema:
   *           type: integer
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               text:
   *                 type: string
   *     responses:
   *       200:
   *         description: The config was saved.
   */
  router.put(
    "/:hostId/config",
    write("config.save", (hostId, req) => {
      const text = body(req)?.text;
      if (typeof text !== "string")
        throw new SambaError("The config is missing");
      return service.applyConfig(hostId, text);
    }),
  );

  /**
   * @openapi
   * /plugin-api/samba/{hostId}/config/test:
   *   post:
   *     summary: Test the config
   *     description: Runs testparm on the host and returns its output.
   *     tags:
   *       - Samba
   *     parameters:
   *       - in: path
   *         name: hostId
   *         required: true
   *         schema:
   *           type: integer
   *     responses:
   *       200:
   *         description: The test result.
   */
  router.post(
    "/:hostId/config/test",
    read((hostId) => service.testConfig(hostId)),
  );

  /**
   * @openapi
   * /plugin-api/samba/{hostId}/logs:
   *   get:
   *     summary: Samba logs
   *     description: Returns the last lines of the Samba log from the journal or the log file.
   *     tags:
   *       - Samba
   *     parameters:
   *       - in: path
   *         name: hostId
   *         required: true
   *         schema:
   *           type: integer
   *       - in: query
   *         name: lines
   *         schema:
   *           type: integer
   *     responses:
   *       200:
   *         description: The log text.
   */
  router.get(
    "/:hostId/logs",
    read(async (hostId, req) => ({
      text: await service.logs(hostId, Number(req.query.lines) || 200),
    })),
  );
}
