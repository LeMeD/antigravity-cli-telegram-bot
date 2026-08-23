import type { Usage } from "../types.js";

export function addUsage(previous: Usage | null | undefined, current: Usage | null): Usage | null {
  if (!current) return previous || null;
  const total: Usage = { ...(previous || {}) };
  for (const [key, value] of Object.entries(current) as Array<[keyof Usage, number]>) total[key] = (total[key] || 0) + value;
  return total;
}
