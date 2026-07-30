import { sql, type Transaction } from "kysely";

import type { DatabaseSchema } from "./database/types.js";

/**
 * Serialize activation decisions for calendars protected from outbound event
 * copying. The competing records live in separate tables, so a conventional
 * cross-table unique constraint cannot express this invariant.
 *
 * Conflict-response activation locks every selected availability calendar;
 * bridge activation locks its source calendar. Locks are transaction-scoped,
 * sorted, and de-duplicated to prevent multi-calendar deadlocks.
 */
export async function lockProtectedSourceCalendars(
  transaction: Transaction<DatabaseSchema>,
  organizationId: string,
  calendarIds: readonly string[]
): Promise<void> {
  const keys = [...new Set(calendarIds.map((calendarId) => JSON.stringify([
    "planipus:no-copy-source:v1",
    organizationId,
    calendarId
  ])))].sort();

  for (const key of keys) {
    await transaction.selectFrom("organizations")
      .select(sql<unknown>`pg_advisory_xact_lock(hashtextextended(${key}, 0::bigint))`.as("lock"))
      .where("id", "=", organizationId)
      .execute();
  }
}
