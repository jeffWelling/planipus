import type { Transaction } from "kysely";

import type { DatabaseSchema } from "../database/types.js";

export interface FakeDemoEndpointIdentity {
  readonly sourceConnectionId: string;
  readonly destinationConnectionId: string;
  readonly sourceCalendarId: string;
  readonly destinationCalendarId: string;
  readonly sourceRemoteId: string;
  readonly destinationRemoteId: string;
}

/** Remove only the two cross-account endpoint shapes created by the original
 * global fake-provider discovery bug. A referenced row aborts the transaction
 * instead of deleting data that has since become meaningful. */
export async function repairFakeDemoCrossAccountEndpoints(
  transaction: Transaction<DatabaseSchema>,
  identity: FakeDemoEndpointIdentity
): Promise<number> {
  const staleEndpoints = await transaction.selectFrom("calendar_endpoints")
    .select("id")
    .where((expression) => expression.or([
      expression.and([
        expression("connection_id", "=", identity.sourceConnectionId),
        expression("remote_id", "=", identity.destinationRemoteId)
      ]),
      expression.and([
        expression("connection_id", "=", identity.destinationConnectionId),
        expression("remote_id", "=", identity.sourceRemoteId)
      ])
    ]))
    .where("id", "not in", [identity.sourceCalendarId, identity.destinationCalendarId])
    .execute();
  let repaired = 0;
  for (const stale of staleEndpoints) {
    const references = await Promise.all([
      transaction.selectFrom("sync_policies").select("id")
        .where((expression) => expression.or([
          expression("source_calendar_id", "=", stale.id),
          expression("destination_calendar_id", "=", stale.id)
        ])).executeTakeFirst(),
      transaction.selectFrom("sync_cursors").select("id")
        .where("calendar_endpoint_id", "=", stale.id).executeTakeFirst(),
      transaction.selectFrom("source_observations").select("id")
        .where("calendar_endpoint_id", "=", stale.id).executeTakeFirst(),
      transaction.selectFrom("projections").select("id")
        .where("destination_calendar_id", "=", stale.id).executeTakeFirst(),
      transaction.selectFrom("provider_subscriptions").select("id")
        .where("calendar_endpoint_id", "=", stale.id).executeTakeFirst(),
      transaction.selectFrom("planning_rules").select("id")
        .where("target_calendar_id", "=", stale.id).executeTakeFirst(),
      transaction.selectFrom("planned_events").select("id")
        .where("destination_calendar_id", "=", stale.id).executeTakeFirst()
    ]);
    if (references.some((reference) => reference !== undefined)) {
      throw new Error("fake demo repair refused to remove a referenced cross-account calendar");
    }
    await transaction.deleteFrom("calendar_endpoints")
      .where("id", "=", stale.id)
      .executeTakeFirstOrThrow();
    repaired += 1;
  }
  return repaired;
}
