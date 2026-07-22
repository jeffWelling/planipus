import type { Kysely } from "kysely";

import type { DatabaseSchema } from "./database/types.js";
import { PostgresJobQueue } from "./jobs/queue.js";
import { DESTINATION_VERIFICATION_INTERVAL_MILLISECONDS } from "./sync/verification.js";

const DISCOVERY_WINDOW_MILLISECONDS = 60 * 60_000;
const RECONCILE_WINDOW_MILLISECONDS = 15 * 60_000;

export class Scheduler {
  private readonly jobs: PostgresJobQueue;

  public constructor(
    private readonly db: Kysely<DatabaseSchema>,
    private readonly planningEnabled = true
  ) {
    this.jobs = new PostgresJobQueue(db);
  }

  public async tick(now = new Date()): Promise<void> {
    await this.db.transaction().execute(async (transaction) => {
      const organizations = await transaction.selectFrom("organizations")
        .select("id")
        .orderBy("id", "asc")
        .execute();
      const discoveryWindow = Math.floor(now.getTime() / DISCOVERY_WINDOW_MILLISECONDS);
      const reconcileWindow = Math.floor(now.getTime() / RECONCILE_WINDOW_MILLISECONDS);
      const destinationVerificationWindow = Math.floor(
        now.getTime() / DESTINATION_VERIFICATION_INTERVAL_MILLISECONDS
      );
      for (const organization of organizations) {
        const connections = await transaction
          .selectFrom("provider_connections")
          .select("id")
          .where("organization_id", "=", organization.id)
          .where("status", "=", "active")
          .orderBy("id", "asc")
          .execute();
        for (const connection of connections) {
          await this.jobs.enqueueOnce(
            organization.id,
            "discover_calendars",
            `connection:${connection.id}:window:${discoveryWindow}`,
            { connection_id: connection.id },
            now,
            transaction
          );
        }
        const calendars = await transaction
          .selectFrom("calendar_endpoints")
          .select("id")
          .where("organization_id", "=", organization.id)
          .where("readable", "=", true)
          .orderBy("id", "asc")
          .execute();
        for (const calendar of calendars) {
          await this.jobs.enqueue(
            organization.id,
            "sync_calendar",
            `calendar:${calendar.id}`,
            { calendar_id: calendar.id },
            now,
            transaction
          );
        }
        const policies = await transaction
          .selectFrom("sync_policies")
          .select(["id", "revision"])
          .where("organization_id", "=", organization.id)
          .where("status", "=", "active")
          .orderBy("id", "asc")
          .execute();
        for (const policy of policies) {
          await this.jobs.enqueueOnce(
            organization.id,
            "reconcile_policy",
            `policy:${policy.id}:revision:${policy.revision}:safety:${reconcileWindow}`,
            { policy_id: policy.id },
            now,
            transaction
          );
        }
        const planningRules = this.planningEnabled ? await transaction
          .selectFrom("planning_rules")
          .select(["id", "revision"])
          .where("organization_id", "=", organization.id)
          .where("status", "=", "active")
          .orderBy("id", "asc")
          .execute() : [];
        for (const rule of planningRules) {
          await this.jobs.enqueueOnce(
            organization.id,
            "reconcile_planning_rule",
            `planning-rule:${rule.id}:revision:${rule.revision}:window:${reconcileWindow}`,
            { rule_id: rule.id },
            now,
            transaction
          );
        }
        await this.jobs.enqueueOnce(
          organization.id,
          "verify_destinations",
          `organization:${organization.id}:window:${destinationVerificationWindow}`,
          {},
          now,
          transaction
        );
      }
    });
    await this.cleanup(now);
  }

  private async cleanup(now: Date): Promise<void> {
    const retentionCutoff = new Date(now.getTime() - 7 * 86_400_000);
    await this.db.deleteFrom("policy_previews").where("expires_at", "<", retentionCutoff).execute();
    await this.db.deleteFrom("planning_previews").where("expires_at", "<", retentionCutoff).execute();
    await this.db
      .updateTable("planning_suggestions")
      .set({ status: "expired", updated_at: now })
      .where("status", "=", "pending")
      .where("expires_at", "<", now)
      .execute();
    await this.db
      .deleteFrom("browser_sessions")
      .where((expression) => expression.or([
        expression("expires_at", "<", retentionCutoff),
        expression("revoked_at", "<", retentionCutoff)
      ]))
      .execute();
    await this.db
      .deleteFrom("scheduled_jobs")
      .where("state", "in", ["succeeded", "dead"])
      .where("updated_at", "<", retentionCutoff)
      .execute();
    await this.db
      .deleteFrom("outbox_effects")
      .where("state", "=", "succeeded")
      .where("updated_at", "<", retentionCutoff)
      .execute();
  }
}
