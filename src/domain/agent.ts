import { z } from "zod";
import type { Tx } from "@/db/tenant";
import { AppError } from "@/lib/errors";
import { parse } from "@/lib/validate";

export const ONLINE_WINDOW_MS = 120_000;
export const REDELIVER_AFTER_MS = 120_000;
export const COMMAND_TTL_MS = 600_000;
export const VERSION_RE = /^\d{1,4}\.\d{1,4}\.\d{1,4}$/;
export const COMMAND_TYPES = ["restart_pdv", "reboot", "update"] as const;
export type CommandType = (typeof COMMAND_TYPES)[number];

export type ClaimedCommand = { id: string; type: CommandType; payload: { version?: string } };
export type CommandRow = {
  id: string;
  type: CommandType;
  status: string;
  createdBy: string | null;
  createdAt: Date;
  error: string | null;
};

export const isOnline = (last: Date | null, now: Date): boolean =>
  last !== null && now.getTime() - last.getTime() <= ONLINE_WINDOW_MS;

const Heartbeat = z.object({
  agentVersion: z.string().trim().min(1).max(40),
  pdvStatus: z.enum(["running", "stopped"]),
});

/** The update takes a row lock on the terminal, so concurrent heartbeats of one terminal run one after the other. */
export async function recordHeartbeat(tx: Tx, terminalId: string, raw: unknown, now: Date): Promise<void> {
  const i = parse(Heartbeat, raw);
  await tx`
    update terminals
    set last_heartbeat_at = ${now}, agent_version = ${i.agentVersion}, pdv_status = ${i.pdvStatus}
    where id = ${terminalId}`;
}

async function expireStaleCommands(tx: Tx, terminalId: string, now: Date): Promise<void> {
  const oldest = new Date(now.getTime() - COMMAND_TTL_MS);
  await tx`
    update terminal_commands
    set status = 'failed', error = 'expired', finished_at = ${now}
    where terminal_id = ${terminalId} and status in ('pending', 'delivered') and created_at < ${oldest}`;
}

/**
 * Hands out at most one command: the oldest pending one, or a delivered one that got no result for
 * REDELIVER_AFTER_MS. Nothing is handed out while another command is still waiting for its result.
 * Call it in the same transaction as recordHeartbeat so the terminal row lock serializes callers.
 */
export async function claimNextCommand(tx: Tx, terminalId: string, now: Date): Promise<ClaimedCommand | null> {
  await expireStaleCommands(tx, terminalId, now);
  const redeliverBefore = new Date(now.getTime() - REDELIVER_AFTER_MS);
  const [row] = await tx`
    update terminal_commands set status = 'delivered', delivered_at = ${now}
    where id = (
      select c.id from terminal_commands c
      where c.terminal_id = ${terminalId}
        and (c.status = 'pending' or (c.status = 'delivered' and c.delivered_at < ${redeliverBefore}))
        and not exists (
          select 1 from terminal_commands d
          where d.terminal_id = ${terminalId} and d.status = 'delivered' and d.delivered_at >= ${redeliverBefore})
      order by c.created_at, c.id
      limit 1)
    returning id, type, payload`;
  if (!row) return null;
  return { id: row.id as string, type: row.type as CommandType, payload: (row.payload ?? {}) as { version?: string } };
}

const Result = z.object({ ok: z.boolean(), error: z.string().max(500).optional() });
const isUuid = (s: string) => z.string().uuid().safeParse(s).success;

/** Idempotent: a command that already has an outcome keeps it. Another terminal's command is not_found. */
export async function finishCommand(
  tx: Tx,
  terminalId: string,
  commandId: string,
  raw: unknown,
  now: Date,
): Promise<void> {
  if (!isUuid(commandId)) throw new AppError("not_found");
  const r = parse(Result, raw);
  const [done] = await tx`
    update terminal_commands
    set status = ${r.ok ? "succeeded" : "failed"}, finished_at = ${now}, error = ${r.ok ? null : (r.error ?? "unknown")}
    where id = ${commandId} and terminal_id = ${terminalId} and status = 'delivered'
    returning id`;
  if (done) return;
  const [known] = await tx`select 1 as x from terminal_commands where id = ${commandId} and terminal_id = ${terminalId}`;
  if (!known) throw new AppError("not_found");
}

const Create = z
  .object({
    terminalId: z.string().uuid(),
    type: z.enum(COMMAND_TYPES),
    version: z.string().regex(VERSION_RE).optional(),
  })
  .refine((i) => i.type !== "update" || i.version !== undefined, { message: "version required" });

export async function createCommand(
  tx: Tx,
  orgId: string,
  userId: string,
  raw: unknown,
  now: Date,
): Promise<string> {
  const i = parse(Create, raw);
  const [t] = await tx`select revoked_at from terminals where id = ${i.terminalId}`;
  if (!t) throw new AppError("not_found");
  if (t.revoked_at) throw new AppError("terminal_revoked");
  await expireStaleCommands(tx, i.terminalId, now);
  const payload = i.type === "update" ? { version: i.version } : {};
  // ON CONFLICT instead of catching the unique violation: an error would abort the transaction and undo the expiry above.
  const [row] = await tx`
    insert into terminal_commands (org_id, terminal_id, type, payload, created_by)
    values (${orgId}, ${i.terminalId}, ${i.type}, ${tx.json(payload)}, ${userId})
    on conflict (terminal_id, type) where status in ('pending', 'delivered') do nothing
    returning id`;
  if (!row) throw new AppError("command_in_progress");
  return row.id as string;
}

export async function listCommands(tx: Tx, terminalId: string, limit = 5): Promise<CommandRow[]> {
  const rows = await tx`
    select id, type, status, created_by, created_at, error
    from terminal_commands where terminal_id = ${terminalId}
    order by created_at desc, id desc limit ${limit}`;
  return rows.map((r) => ({
    id: r.id as string,
    type: r.type as CommandType,
    status: r.status as string,
    createdBy: (r.created_by as string | null) ?? null,
    createdAt: r.created_at as Date,
    error: (r.error as string | null) ?? null,
  }));
}

/** Terminals that connected before and went quiet. Never-connected and revoked terminals do not count. */
export async function countOfflineTerminals(tx: Tx, now: Date): Promise<number> {
  const cutoff = new Date(now.getTime() - ONLINE_WINDOW_MS);
  const [r] = await tx`
    select count(*)::int as n from terminals
    where revoked_at is null and last_heartbeat_at is not null and last_heartbeat_at < ${cutoff}`;
  return r.n as number;
}
