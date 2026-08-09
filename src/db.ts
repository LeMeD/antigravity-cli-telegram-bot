import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import type { ConversationSummary } from "./types.js";

export interface ConversationPage {
  items: ConversationSummary[];
  total: number;
  page: number;
  totalPages: number;
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string | undefined | null): boolean {
  if (!value || typeof value !== "string") return false;
  return UUID_REGEX.test(value.trim());
}

export function parseTimestamp(value: unknown): number {
  if (typeof value === "number") {
    if (value < 10_000_000_000) return value * 1000;
    if (value > 10_000_000_000_000) return Math.floor(value / 1000);
    return value;
  }
  if (typeof value === "string") {
    const num = Number(value);
    if (!Number.isNaN(num) && num > 0) return parseTimestamp(num);
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) return parsed;
  }
  if (value instanceof Date) return value.getTime();
  return Date.now();
}

export function formatRelativeTime(value: unknown, now = Date.now()): string {
  const time = parseTimestamp(value);
  const diffMs = now - time;
  if (diffMs < 0) return "just now";
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return "just now";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour}h ago`;
  const diffDay = Math.floor(diffHour / 24);
  if (diffDay < 7) return `${diffDay}d ago`;

  const date = new Date(time);
  const day = String(date.getDate()).padStart(2, "0");
  const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const month = monthNames[date.getMonth()];
  const year = date.getFullYear();
  return `${day} ${month} ${year}`;
}

export class ConversationDatabase {
  public constructor(public readonly dbPath: string) {}

  public getConversations(page = 0, pageSize = 10): ConversationPage {
    const normalizedPageSize = Math.max(1, pageSize);
    const emptyResult: ConversationPage = { items: [], total: 0, page: 0, totalPages: 1 };
    if (!fs.existsSync(this.dbPath)) return emptyResult;

    let db: DatabaseSync | null = null;
    try {
      db = new DatabaseSync(this.dbPath, { readOnly: true });
      const countStmt = db.prepare(
        "SELECT COUNT(*) as total FROM conversation_summaries WHERE killed = 0 AND step_count > 0;"
      );
      const countRow = countStmt.get() as { total?: number } | undefined;
      const total = countRow?.total && Number.isSafeInteger(countRow.total) ? countRow.total : 0;
      const totalPages = Math.max(1, Math.ceil(total / normalizedPageSize));
      const normalizedPage = Math.min(Math.max(page, 0), totalPages - 1);
      const offset = normalizedPage * normalizedPageSize;

      const listStmt = db.prepare(`
        SELECT
          conversation_id,
          COALESCE(NULLIF(preview, ''), NULLIF(title, ''), '(untitled)') AS display_title,
          COALESCE(step_count, 0) AS step_count,
          COALESCE(last_modified_time, 0) AS last_modified_time,
          COALESCE(project_id, '') AS project_id
        FROM conversation_summaries
        WHERE killed = 0
          AND step_count > 0
        ORDER BY last_modified_time DESC
        LIMIT ? OFFSET ?;
      `);
      const rows = listStmt.all(normalizedPageSize, offset) as unknown as ConversationSummary[];
      return {
        items: rows || [],
        total,
        page: normalizedPage,
        totalPages,
      };
    } catch {
      return emptyResult;
    } finally {
      db?.close();
    }
  }

  public getConversationById(id: string): ConversationSummary | null {
    if (!id || !fs.existsSync(this.dbPath)) return null;
    let db: DatabaseSync | null = null;
    try {
      db = new DatabaseSync(this.dbPath, { readOnly: true });
      const stmt = db.prepare(`
        SELECT
          conversation_id,
          COALESCE(NULLIF(preview, ''), NULLIF(title, ''), '(untitled)') AS display_title,
          COALESCE(step_count, 0) AS step_count,
          COALESCE(last_modified_time, 0) AS last_modified_time,
          COALESCE(project_id, '') AS project_id
        FROM conversation_summaries
        WHERE conversation_id = ?
          AND killed = 0
          AND step_count > 0
        LIMIT 1;
      `);
      const row = stmt.get(id) as unknown as ConversationSummary | undefined;
      return row || null;
    } catch {
      return null;
    } finally {
      db?.close();
    }
  }
}
