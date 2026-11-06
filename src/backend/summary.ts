import type { Request, Response, Router } from "express";
import type { PluginContext } from "@termix-ssh/plugin-sdk/backend";
import type { SambaHostSummary } from "../shared/types.js";
import type { SessionManager } from "./sessions.js";
import type { SambaService } from "./service.js";
import type { ShareManager } from "./shares.js";

const CACHE_MS = 60_000;
const SUMMARY_CONCURRENCY = 4;

async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index]);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, worker),
  );
  return results;
}

export interface SummaryDeps {
  service: SambaService;
  shares: Pick<ShareManager, "list">;
  sessions: Pick<SessionManager, "list">;
}

export interface SummaryCache {
  check: (hostId: number, refresh?: boolean) => Promise<SambaHostSummary>;
}

export function createSummaryCache(
  ctx: PluginContext,
  deps: SummaryDeps,
): SummaryCache {
  const cache = new Map<string, SambaHostSummary>();
  const key = (hostId: number) => `${ctx.currentActor() ?? ""}:${hostId}`;

  return {
    check: async (hostId, refresh = false) => {
      const cached = cache.get(key(hostId));
      if (
        !refresh &&
        cached &&
        Date.now() - Date.parse(cached.checkedAt) < CACHE_MS
      ) {
        return cached;
      }
      const checkedAt = new Date().toISOString();
      let fresh: SambaHostSummary;
      try {
        const status = await deps.service.status(hostId);
        const shares = status.installed
          ? (await deps.shares.list(hostId)).length
          : 0;
        const sessions =
          status.installed && status.active
            ? await deps.sessions
                .list(hostId)
                .then((view) => view.sessions.length)
                .catch(() => 0)
            : 0;
        fresh = {
          hostId,
          checkedAt,
          installed: status.installed,
          active: status.active,
          shares,
          sessions,
        };
      } catch (error) {
        fresh = {
          hostId,
          checkedAt,
          installed: false,
          active: false,
          shares: 0,
          sessions: 0,
          error: error instanceof Error ? error.message : String(error),
        };
      }
      cache.set(key(hostId), fresh);
      return fresh;
    },
  };
}

export function registerSummary(
  router: Router,
  ctx: PluginContext,
  summary: SummaryCache,
): void {
  /**
   * @openapi
   * /plugin-api/samba/summary:
   *   get:
   *     summary: Samba state on every host
   *     description: One entry per host with Samba turned on, checked as the caller and cached for a minute unless refresh=1.
   *     tags:
   *       - Samba
   *     parameters:
   *       - in: query
   *         name: refresh
   *         schema:
   *           type: string
   *     responses:
   *       200:
   *         description: One entry per host.
   */
  router.get("/summary", async (req: Request, res: Response) => {
    try {
      const refresh = req.query.refresh === "1";
      const enabled: number[] = [];
      for (const host of await ctx.hosts.list()) {
        if ((await ctx.settings.getAll("host", host.id)).enableSamba === true) {
          enabled.push(host.id);
        }
      }
      res.json(
        await mapLimit(enabled, SUMMARY_CONCURRENCY, (hostId) =>
          summary.check(hostId, refresh),
        ),
      );
    } catch (error) {
      ctx.log.error(
        "Failed to build the samba summary",
        error instanceof Error ? error : undefined,
      );
      res.status(500).json({ error: "Failed to build the samba summary" });
    }
  });
}
