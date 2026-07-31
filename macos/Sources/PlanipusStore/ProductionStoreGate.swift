import Foundation
import GRDB
import PlanipusCore
import PlanipusSecrets

public enum EncryptedStoreError: Error, Equatable, Sendable {
    /// SQLCipher could not authenticate the existing file with the resolved
    /// Keychain key. The file is left untouched.
    case invalidDatabaseKey
    case corruptRecord
}

/// Durable native persistence backed by the SQLCipher-managed GRDB fork.
///
/// Opening is intentionally asynchronous because key resolution crosses the
/// Keychain actor boundary. There is no initializer that accepts an unkeyed
/// SQLite connection and no in-memory fallback.
public actor EncryptedPlanipusRepository: PlanipusRepository {
    public static let currentSchemaVersion = 6

    public nonisolated let databaseURL: URL
    private let database: DatabaseQueue

    private init(databaseURL: URL, database: DatabaseQueue) {
        self.databaseURL = databaseURL
        self.database = database
    }

    /// Opens or creates the encrypted database.
    ///
    /// If a database already exists, a missing Keychain item fails before a
    /// connection is attempted. A wrong key maps to a stable error and never
    /// triggers replacement, truncation, or a new key.
    public static func open(
        databaseURL: URL,
        secretStore: any SecretStore = KeychainSecretStore(),
        keyIdentifier: SecretIdentifier = .planipusDatabaseKey
    ) async throws -> EncryptedPlanipusRepository {
        let fileManager = FileManager.default
        let databaseExisted = fileManager.fileExists(atPath: databaseURL.path)
        let key = try await DatabaseKeyVault(
            secretStore: secretStore,
            identifier: keyIdentifier
        ).resolve(databaseExists: databaseExisted)

        if !databaseExisted {
            try fileManager.createDirectory(
                at: databaseURL.deletingLastPathComponent(),
                withIntermediateDirectories: true
            )
        }

        var configuration = Configuration()
        configuration.label = "Planipus encrypted calendar store"
        configuration.foreignKeysEnabled = true
        configuration.busyMode = .timeout(5)
        configuration.prepareDatabase { database in
            // SQLCipher requires the key before the first schema read.
            try key.withUnsafeData { try database.usePassphrase($0) }
            try database.execute(sql: "PRAGMA cipher_memory_security = ON")
            try database.execute(sql: "PRAGMA secure_delete = ON")
        }

        let queue: DatabaseQueue
        do {
            queue = try DatabaseQueue(path: databaseURL.path, configuration: configuration)
            // Force authentication now; do not let a lazy first query surface
            // a key error after app composition reports the store as ready.
            try queue.inDatabase { database in
                _ = try Int.fetchOne(database, sql: "SELECT COUNT(*) FROM sqlite_master")
            }
        } catch let error as DatabaseError
            where databaseExisted && error.resultCode == .SQLITE_NOTADB
        {
            throw EncryptedStoreError.invalidDatabaseKey
        }

        do {
            try makeMigrator().migrate(queue)
        } catch let error as DatabaseError
            where databaseExisted && error.resultCode == .SQLITE_NOTADB
        {
            throw EncryptedStoreError.invalidDatabaseKey
        }
        // A staged batch has no meaning across process lifetimes: its cursor
        // was never committed. Remove crash leftovers before the coordinator
        // starts; the foreign key deletes staged pages in the same transaction.
        try await queue.write { database in
            try database.execute(sql: "DELETE FROM change_batches")
        }
        return EncryptedPlanipusRepository(databaseURL: databaseURL, database: queue)
    }

    public func close() throws {
        try database.close()
    }

    /// A non-secret diagnostic used by migration tests and support bundles.
    public func schemaVersion() throws -> Int {
        try database.read { database in
            try Int.fetchOne(
                database,
                sql: "SELECT value FROM store_metadata WHERE key = 'schema_version'"
            ) ?? 0
        }
    }

    public func loadAppConfiguration() throws -> NativeAppConfiguration? {
        try database.read { database in
            guard let data = try Data.fetchOne(
                database,
                sql: "SELECT configuration_json FROM app_configuration WHERE singleton = 1"
            ) else { return nil }
            return try Self.decode(NativeAppConfiguration.self, from: data)
        }
    }

    public func saveAppConfiguration(_ configuration: NativeAppConfiguration) throws {
        try database.write { database in
            try database.execute(
                sql: """
                    INSERT INTO app_configuration (singleton, configuration_json)
                    VALUES (1, ?)
                    ON CONFLICT(singleton)
                    DO UPDATE SET configuration_json = excluded.configuration_json
                    """,
                arguments: [try Self.encode(configuration)]
            )
        }
    }

    public func syncToken(for endpoint: CalendarEndpoint) throws -> String? {
        try database.read { database in
            try String.fetchOne(
                database,
                sql: """
                    SELECT token FROM sync_cursors
                    WHERE provider = ? AND account_id = ? AND calendar_id = ?
                    """,
                arguments: Self.endpointArguments(endpoint)
            )
        }
    }

    public func clearSyncToken(for endpoint: CalendarEndpoint) throws {
        try database.write { database in
            try database.execute(
                sql: """
                    DELETE FROM sync_cursors
                    WHERE provider = ? AND account_id = ? AND calendar_id = ?
                    """,
                arguments: Self.endpointArguments(endpoint)
            )
        }
    }

    public func beginChangeBatch(
        endpoint: CalendarEndpoint,
        mode: ChangeBatchMode
    ) throws -> ChangeBatchHandle {
        let handle = ChangeBatchHandle(endpoint: endpoint, mode: mode)
        let modeValues = Self.persistedMode(mode)
        try database.write { database in
            try database.execute(
                sql: """
                    INSERT INTO change_batches (
                        id, provider, account_id, calendar_id, mode, range_start, range_end
                    ) VALUES (?, ?, ?, ?, ?, ?, ?)
                    """,
                arguments: [
                    handle.id.uuidString,
                    endpoint.provider.rawValue,
                    endpoint.accountID,
                    endpoint.calendarID,
                    modeValues.name,
                    modeValues.start,
                    modeValues.end,
                ]
            )
        }
        return handle
    }

    public func stage(_ events: [SourceEvent], in batch: ChangeBatchHandle) throws {
        guard events.allSatisfy({ $0.calendarID == batch.endpoint.calendarID }) else {
            throw RepositoryError.mismatchedCalendar
        }
        try database.write { database in
            try Self.validate(batch, in: database)
            var sequence = try Int.fetchOne(
                database,
                sql: "SELECT COALESCE(MAX(sequence) + 1, 0) FROM staged_observations WHERE batch_id = ?",
                arguments: [batch.id.uuidString]
            ) ?? 0
            for event in events {
                try database.execute(
                    sql: "INSERT INTO staged_observations (batch_id, sequence, event_json) VALUES (?, ?, ?)",
                    arguments: [batch.id.uuidString, sequence, try Self.encode(event)]
                )
                sequence += 1
            }
        }
    }

    @discardableResult
    public func commit(
        _ batch: ChangeBatchHandle,
        nextSyncToken: String?
    ) throws -> [SourceEvent] {
        try database.write { database in
            try Self.validate(batch, in: database)
            let stagedRows = try Row.fetchAll(
                database,
                sql: "SELECT event_json FROM staged_observations WHERE batch_id = ? ORDER BY sequence",
                arguments: [batch.id.uuidString]
            )
            let stagedEvents: [SourceEvent] = try stagedRows.map { row in
                try Self.decode(SourceEvent.self, from: row["event_json"])
            }

            var removedByKey: [String: SourceEvent] = [:]
            if case .full(let start, let end) = batch.mode {
                let existing = try Row.fetchAll(
                    database,
                    sql: """
                        SELECT event_json FROM observations
                        WHERE provider = ? AND account_id = ? AND calendar_id = ?
                          AND end_time > ? AND start_time < ?
                        """,
                    arguments: [
                        batch.endpoint.provider.rawValue,
                        batch.endpoint.accountID,
                        batch.endpoint.calendarID,
                        start.timeIntervalSince1970,
                        end.timeIntervalSince1970,
                    ]
                )
                for row in existing {
                    var tombstone = try Self.decode(SourceEvent.self, from: row["event_json"])
                    tombstone.isDeleted = true
                    removedByKey[Self.observationKey(tombstone)] = tombstone
                }
                try database.execute(
                    sql: """
                        DELETE FROM observations
                        WHERE provider = ? AND account_id = ? AND calendar_id = ?
                          AND end_time > ? AND start_time < ?
                        """,
                    arguments: [
                        batch.endpoint.provider.rawValue,
                        batch.endpoint.accountID,
                        batch.endpoint.calendarID,
                        start.timeIntervalSince1970,
                        end.timeIntervalSince1970,
                    ]
                )
            }

            for event in stagedEvents {
                let key = Self.observationKey(event)
                let occurrenceKey = Self.occurrenceKey(event.occurrenceID)
                if event.isDeleted {
                    let existingData = try Data.fetchOne(
                        database,
                        sql: """
                            SELECT event_json FROM observations
                            WHERE provider = ? AND account_id = ? AND calendar_id = ?
                              AND event_id = ? AND occurrence_key = ?
                            """,
                        arguments: [
                            batch.endpoint.provider.rawValue,
                            batch.endpoint.accountID,
                            batch.endpoint.calendarID,
                            event.id,
                            occurrenceKey,
                        ]
                    )
                    var tombstone = try existingData.map {
                        try Self.decode(SourceEvent.self, from: $0)
                    } ?? event
                    tombstone.isDeleted = true
                    tombstone.providerRevision = event.providerRevision ?? tombstone.providerRevision
                    removedByKey[key] = tombstone
                    try database.execute(
                        sql: """
                            DELETE FROM observations
                            WHERE provider = ? AND account_id = ? AND calendar_id = ?
                              AND event_id = ? AND occurrence_key = ?
                            """,
                        arguments: [
                            batch.endpoint.provider.rawValue,
                            batch.endpoint.accountID,
                            batch.endpoint.calendarID,
                            event.id,
                            occurrenceKey,
                        ]
                    )
                } else {
                    try database.execute(
                        sql: """
                            INSERT INTO observations (
                                provider, account_id, calendar_id, event_id, occurrence_key,
                                start_time, end_time, event_json
                            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                            ON CONFLICT(provider, account_id, calendar_id, event_id, occurrence_key)
                            DO UPDATE SET
                                start_time = excluded.start_time,
                                end_time = excluded.end_time,
                                event_json = excluded.event_json
                            """,
                        arguments: [
                            batch.endpoint.provider.rawValue,
                            batch.endpoint.accountID,
                            batch.endpoint.calendarID,
                            event.id,
                            occurrenceKey,
                            event.start.timeIntervalSince1970,
                            event.end.timeIntervalSince1970,
                            try Self.encode(event),
                        ]
                    )
                    removedByKey.removeValue(forKey: key)
                }
            }

            if let nextSyncToken {
                try database.execute(
                    sql: """
                        INSERT INTO sync_cursors (provider, account_id, calendar_id, token)
                        VALUES (?, ?, ?, ?)
                        ON CONFLICT(provider, account_id, calendar_id)
                        DO UPDATE SET token = excluded.token
                        """,
                    arguments: [
                        batch.endpoint.provider.rawValue,
                        batch.endpoint.accountID,
                        batch.endpoint.calendarID,
                        nextSyncToken,
                    ]
                )
            }
            try database.execute(
                sql: "DELETE FROM change_batches WHERE id = ?",
                arguments: [batch.id.uuidString]
            )
            return removedByKey.values.sorted {
                Self.observationKey($0) < Self.observationKey($1)
            }
        }
    }

    public func abandon(_ batch: ChangeBatchHandle) {
        try? database.write { database in
            try database.execute(
                sql: "DELETE FROM change_batches WHERE id = ?",
                arguments: [batch.id.uuidString]
            )
        }
    }

    public func observations(at endpoint: CalendarEndpoint) throws -> [SourceEvent] {
        try database.read { database in
            try Row.fetchAll(
                database,
                sql: """
                    SELECT event_json FROM observations
                    WHERE provider = ? AND account_id = ? AND calendar_id = ?
                    ORDER BY event_id, occurrence_key
                    """,
                arguments: Self.endpointArguments(endpoint)
            ).map { row in
                try Self.decode(SourceEvent.self, from: row["event_json"])
            }
        }
    }

    public func projection(for key: ProjectionKey) throws -> StoredProjection? {
        try database.read { database in
            guard let row = try Row.fetchOne(
                database,
                sql: """
                    SELECT * FROM projections
                    WHERE policy_id = ? AND source_event_id = ? AND source_occurrence_key = ?
                    """,
                arguments: [key.policyID, key.sourceEventID, Self.occurrenceKey(key.sourceOccurrenceID)]
            ) else { return nil }
            return try Self.projection(from: row)
        }
    }

    public func saveProjection(_ projection: StoredProjection) throws {
        try database.write { database in
            try database.execute(
                sql: """
                    INSERT INTO projections (
                        policy_id, source_event_id, source_occurrence_key,
                        destination_provider, destination_account_id, destination_calendar_id,
                        destination_event_id, desired_fingerprint, provider_revision,
                        hold_code, detached, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(policy_id, source_event_id, source_occurrence_key)
                    DO UPDATE SET
                        destination_provider = excluded.destination_provider,
                        destination_account_id = excluded.destination_account_id,
                        destination_calendar_id = excluded.destination_calendar_id,
                        destination_event_id = excluded.destination_event_id,
                        desired_fingerprint = excluded.desired_fingerprint,
                        provider_revision = excluded.provider_revision,
                        hold_code = excluded.hold_code,
                        detached = excluded.detached,
                        updated_at = excluded.updated_at
                    """,
                arguments: [
                    projection.key.policyID,
                    projection.key.sourceEventID,
                    Self.occurrenceKey(projection.key.sourceOccurrenceID),
                    projection.destinationEndpoint.provider.rawValue,
                    projection.destinationEndpoint.accountID,
                    projection.destinationEndpoint.calendarID,
                    projection.destinationEventID,
                    projection.desiredFingerprint,
                    projection.providerRevision,
                    projection.hold?.rawValue,
                    projection.detached,
                    projection.updatedAt.timeIntervalSince1970,
                ]
            )
        }
    }

    public func deleteProjection(for key: ProjectionKey) throws {
        try database.write { database in
            try database.execute(
                sql: """
                    DELETE FROM projections
                    WHERE policy_id = ? AND source_event_id = ? AND source_occurrence_key = ?
                    """,
                arguments: [key.policyID, key.sourceEventID, Self.occurrenceKey(key.sourceOccurrenceID)]
            )
        }
    }

    public func recordNotice(_ notice: SyncNotice) throws {
        try database.write { database in
            try database.execute(
                sql: """
                    INSERT INTO sync_notices (
                        id, policy_id, source_event_id, source_occurrence_key,
                        kind, status, resolution, copy_summary, copy_start, copy_end,
                        copy_all_day, created_at, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                arguments: [
                    notice.id.uuidString,
                    notice.projectionKey.policyID,
                    notice.projectionKey.sourceEventID,
                    Self.occurrenceKey(notice.projectionKey.sourceOccurrenceID),
                    notice.kind.rawValue,
                    notice.status.rawValue,
                    notice.resolution?.rawValue,
                    notice.copySummary,
                    notice.copyStart.timeIntervalSince1970,
                    notice.copyEnd.timeIntervalSince1970,
                    notice.copyIsAllDay,
                    notice.createdAt.timeIntervalSince1970,
                    notice.updatedAt.timeIntervalSince1970,
                ]
            )
        }
    }

    public func notices(includeResolved: Bool) throws -> [SyncNotice] {
        try database.read { database in
            let rows = includeResolved
                ? try Row.fetchAll(
                    database,
                    sql: "SELECT * FROM sync_notices ORDER BY created_at, id"
                )
                : try Row.fetchAll(
                    database,
                    sql: "SELECT * FROM sync_notices WHERE status <> ? ORDER BY created_at, id",
                    arguments: [SyncNoticeStatus.resolved.rawValue]
                )
            return try rows.map(Self.notice(from:))
        }
    }

    public func notice(id: UUID) throws -> SyncNotice? {
        try database.read { database in
            guard let row = try Row.fetchOne(
                database,
                sql: "SELECT * FROM sync_notices WHERE id = ?",
                arguments: [id.uuidString]
            ) else { return nil }
            return try Self.notice(from: row)
        }
    }

    public func updateNotice(_ notice: SyncNotice) throws {
        try database.write { database in
            let exists = try Bool.fetchOne(
                database,
                sql: "SELECT EXISTS(SELECT 1 FROM sync_notices WHERE id = ?)",
                arguments: [notice.id.uuidString]
            ) ?? false
            guard exists else { throw RepositoryError.unknownNotice }
            try database.execute(
                sql: """
                    UPDATE sync_notices
                    SET status = ?, resolution = ?, updated_at = ?
                    WHERE id = ?
                    """,
                arguments: [
                    notice.status.rawValue,
                    notice.resolution?.rawValue,
                    notice.updatedAt.timeIntervalSince1970,
                    notice.id.uuidString,
                ]
            )
        }
    }

    @discardableResult
    public func enqueue(_ effect: OutboxEffect) throws -> Bool {
        try database.write { database in
            if let existing = try Row.fetchOne(
                database,
                sql: "SELECT id, state FROM outbox_effects WHERE idempotency_key = ?",
                arguments: [effect.idempotencyKey]
            ) {
                let state: String = existing["state"]
                guard state == OutboxState.succeeded.rawValue else { return false }
                let existingID: String = existing["id"]
                try database.execute(
                    sql: "DELETE FROM outbox_effects WHERE id = ?",
                    arguments: [existingID]
                )
            }
            try database.execute(
                sql: """
                    INSERT INTO outbox_effects (
                        id, idempotency_key, policy_id, source_event_id, source_occurrence_key,
                        mutation_json, state, attempt_count, next_attempt_at, last_error, created_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                arguments: [
                    effect.id.uuidString,
                    effect.idempotencyKey,
                    effect.projectionKey.policyID,
                    effect.projectionKey.sourceEventID,
                    Self.occurrenceKey(effect.projectionKey.sourceOccurrenceID),
                    try Self.encode(effect.mutation),
                    effect.state.rawValue,
                    effect.attemptCount,
                    effect.nextAttemptAt.timeIntervalSince1970,
                    effect.lastError,
                    effect.createdAt.timeIntervalSince1970,
                ]
            )
            return true
        }
    }

    public func dueEffects(at date: Date, limit: Int) throws -> [OutboxEffect] {
        guard limit > 0 else { return [] }
        return try database.read { database in
            try Row.fetchAll(
                database,
                sql: """
                    SELECT * FROM outbox_effects
                    WHERE state IN (?, ?, ?) AND next_attempt_at <= ?
                    ORDER BY next_attempt_at, created_at
                    LIMIT ?
                    """,
                arguments: [
                    OutboxState.pending.rawValue,
                    OutboxState.applying.rawValue,
                    OutboxState.ambiguous.rawValue,
                    date.timeIntervalSince1970,
                    limit,
                ]
            ).map(Self.effect(from:))
        }
    }

    public func markApplying(id: UUID) throws {
        try updateEffect(id: id) { database in
            try database.execute(
                sql: """
                    UPDATE outbox_effects
                    SET state = ?, attempt_count = attempt_count + 1
                    WHERE id = ?
                    """,
                arguments: [OutboxState.applying.rawValue, id.uuidString]
            )
        }
    }

    public func markSucceeded(id: UUID) throws {
        try updateEffect(id: id) { database in
            try database.execute(
                sql: "UPDATE outbox_effects SET state = ? WHERE id = ?",
                arguments: [OutboxState.succeeded.rawValue, id.uuidString]
            )
        }
    }

    public func markAmbiguous(id: UUID, error: String) throws {
        try updateEffect(id: id) { database in
            try database.execute(
                sql: "UPDATE outbox_effects SET state = ?, last_error = ? WHERE id = ?",
                arguments: [OutboxState.ambiguous.rawValue, error, id.uuidString]
            )
        }
    }

    public func markQuarantined(id: UUID, error: String) throws {
        try updateEffect(id: id) { database in
            try database.execute(
                sql: "UPDATE outbox_effects SET state = ?, last_error = ? WHERE id = ?",
                arguments: [OutboxState.quarantined.rawValue, error, id.uuidString]
            )
        }
    }

    public func hasQuarantinedEffects() throws -> Bool {
        try database.read { database in
            try Bool.fetchOne(
                database,
                sql: "SELECT EXISTS(SELECT 1 FROM outbox_effects WHERE state = ?)",
                arguments: [OutboxState.quarantined.rawValue]
            ) ?? false
        }
    }

    public func scheduleRetry(id: UUID, at date: Date, error: String) throws {
        try updateEffect(id: id) { database in
            try database.execute(
                sql: """
                    UPDATE outbox_effects
                    SET state = ?, next_attempt_at = ?, last_error = ?
                    WHERE id = ?
                    """,
                arguments: [
                    OutboxState.pending.rawValue,
                    date.timeIntervalSince1970,
                    error,
                    id.uuidString,
                ]
            )
        }
    }

    public func reviseEffect(
        id: UUID,
        mutation: ProviderMutation,
        at date: Date,
        error: String
    ) throws {
        try updateEffect(id: id) { database in
            try database.execute(
                sql: """
                    UPDATE outbox_effects
                    SET mutation_json = ?, state = ?, next_attempt_at = ?, last_error = ?
                    WHERE id = ?
                    """,
                arguments: [
                    try Self.encode(mutation),
                    OutboxState.pending.rawValue,
                    date.timeIntervalSince1970,
                    error,
                    id.uuidString,
                ]
            )
        }
    }

    private func updateEffect(
        id: UUID,
        update: (Database) throws -> Void
    ) throws {
        try database.write { database in
            let exists = try Bool.fetchOne(
                database,
                sql: "SELECT EXISTS(SELECT 1 FROM outbox_effects WHERE id = ?)",
                arguments: [id.uuidString]
            ) ?? false
            guard exists else { throw RepositoryError.unknownEffect }
            try update(database)
        }
    }

    private static func makeMigrator() -> DatabaseMigrator {
        var migrator = DatabaseMigrator()
        migrator.registerMigration("001_sync_state") { database in
            try database.execute(sql: """
                CREATE TABLE sync_cursors (
                    provider TEXT NOT NULL,
                    account_id TEXT NOT NULL,
                    calendar_id TEXT NOT NULL,
                    token TEXT NOT NULL,
                    PRIMARY KEY (provider, account_id, calendar_id)
                ) WITHOUT ROWID
                """)
            try database.execute(sql: """
                CREATE TABLE observations (
                    provider TEXT NOT NULL,
                    account_id TEXT NOT NULL,
                    calendar_id TEXT NOT NULL,
                    event_id TEXT NOT NULL,
                    occurrence_key TEXT NOT NULL,
                    start_time REAL NOT NULL,
                    end_time REAL NOT NULL,
                    event_json BLOB NOT NULL,
                    PRIMARY KEY (provider, account_id, calendar_id, event_id, occurrence_key)
                ) WITHOUT ROWID
                """)
            try database.execute(sql: """
                CREATE TABLE change_batches (
                    id TEXT PRIMARY KEY NOT NULL,
                    provider TEXT NOT NULL,
                    account_id TEXT NOT NULL,
                    calendar_id TEXT NOT NULL,
                    mode TEXT NOT NULL CHECK (mode IN ('incremental', 'full')),
                    range_start REAL,
                    range_end REAL,
                    CHECK (
                        (mode = 'incremental' AND range_start IS NULL AND range_end IS NULL) OR
                        (mode = 'full' AND range_start IS NOT NULL AND range_end IS NOT NULL)
                    )
                ) WITHOUT ROWID
                """)
            try database.execute(sql: """
                CREATE TABLE staged_observations (
                    batch_id TEXT NOT NULL REFERENCES change_batches(id) ON DELETE CASCADE,
                    sequence INTEGER NOT NULL,
                    event_json BLOB NOT NULL,
                    PRIMARY KEY (batch_id, sequence)
                ) WITHOUT ROWID
                """)
            try database.execute(sql: """
                CREATE TABLE projections (
                    policy_id TEXT NOT NULL,
                    source_event_id TEXT NOT NULL,
                    source_occurrence_key TEXT NOT NULL,
                    destination_provider TEXT NOT NULL,
                    destination_account_id TEXT NOT NULL,
                    destination_calendar_id TEXT NOT NULL,
                    destination_event_id TEXT NOT NULL,
                    desired_fingerprint TEXT NOT NULL,
                    provider_revision TEXT,
                    updated_at REAL NOT NULL,
                    PRIMARY KEY (policy_id, source_event_id, source_occurrence_key)
                ) WITHOUT ROWID
                """)
            try database.execute(sql: """
                CREATE TABLE outbox_effects (
                    id TEXT PRIMARY KEY NOT NULL,
                    idempotency_key TEXT NOT NULL UNIQUE,
                    policy_id TEXT NOT NULL,
                    source_event_id TEXT NOT NULL,
                    source_occurrence_key TEXT NOT NULL,
                    mutation_json BLOB NOT NULL,
                    state TEXT NOT NULL CHECK (state IN ('pending', 'applying', 'ambiguous', 'succeeded')),
                    attempt_count INTEGER NOT NULL CHECK (attempt_count >= 0),
                    next_attempt_at REAL NOT NULL,
                    last_error TEXT,
                    created_at REAL NOT NULL
                )
                """)
        }
        migrator.registerMigration("002_query_indexes") { database in
            try database.execute(sql: """
                CREATE INDEX observations_full_sync_range
                ON observations (provider, account_id, calendar_id, start_time, end_time)
                """)
            try database.execute(sql: """
                CREATE INDEX outbox_due_effects
                ON outbox_effects (state, next_attempt_at, created_at)
                """)
        }
        migrator.registerMigration("003_schema_metadata") { database in
            try database.execute(sql: """
                CREATE TABLE store_metadata (
                    key TEXT PRIMARY KEY NOT NULL,
                    value INTEGER NOT NULL
                ) WITHOUT ROWID
                """)
            try database.execute(
                sql: "INSERT INTO store_metadata (key, value) VALUES ('schema_version', ?)",
                arguments: [3]
            )
        }
        migrator.registerMigration("004_native_configuration") { database in
            try database.execute(sql: """
                CREATE TABLE app_configuration (
                    singleton INTEGER PRIMARY KEY NOT NULL CHECK (singleton = 1),
                    configuration_json BLOB NOT NULL
                )
                """)
            try database.execute(
                sql: "UPDATE store_metadata SET value = ? WHERE key = 'schema_version'",
                arguments: [4]
            )
        }
        migrator.registerMigration("005_quarantined_outbox_effects") { database in
            // SQLite cannot widen a CHECK constraint in place. Rebuild the
            // outbox transactionally so existing pending/applying/ambiguous and
            // succeeded effects retain their IDs, ordering, and retry metadata.
            try database.execute(sql: """
                CREATE TABLE outbox_effects_v5 (
                    id TEXT PRIMARY KEY NOT NULL,
                    idempotency_key TEXT NOT NULL UNIQUE,
                    policy_id TEXT NOT NULL,
                    source_event_id TEXT NOT NULL,
                    source_occurrence_key TEXT NOT NULL,
                    mutation_json BLOB NOT NULL,
                    state TEXT NOT NULL CHECK (
                        state IN ('pending', 'applying', 'ambiguous', 'quarantined', 'succeeded')
                    ),
                    attempt_count INTEGER NOT NULL CHECK (attempt_count >= 0),
                    next_attempt_at REAL NOT NULL,
                    last_error TEXT,
                    created_at REAL NOT NULL
                )
                """)
            try database.execute(sql: """
                INSERT INTO outbox_effects_v5 (
                    id, idempotency_key, policy_id, source_event_id, source_occurrence_key,
                    mutation_json, state, attempt_count, next_attempt_at, last_error, created_at
                )
                SELECT
                    id, idempotency_key, policy_id, source_event_id, source_occurrence_key,
                    mutation_json, state, attempt_count, next_attempt_at, last_error, created_at
                FROM outbox_effects
                """)
            try database.execute(sql: "DROP TABLE outbox_effects")
            try database.execute(sql: "ALTER TABLE outbox_effects_v5 RENAME TO outbox_effects")
            try database.execute(sql: """
                CREATE INDEX outbox_due_effects
                ON outbox_effects (state, next_attempt_at, created_at)
                """)
            try database.execute(
                sql: "UPDATE store_metadata SET value = ? WHERE key = 'schema_version'",
                arguments: [5]
            )
        }
        migrator.registerMigration("006_destination_edit_notices") { database in
            try database.execute(sql: "ALTER TABLE projections ADD COLUMN hold_code TEXT")
            try database.execute(
                sql: "ALTER TABLE projections ADD COLUMN detached INTEGER NOT NULL DEFAULT 0"
            )
            try database.execute(sql: """
                CREATE TABLE sync_notices (
                    id TEXT PRIMARY KEY NOT NULL,
                    policy_id TEXT NOT NULL,
                    source_event_id TEXT NOT NULL,
                    source_occurrence_key TEXT NOT NULL,
                    kind TEXT NOT NULL CHECK (kind IN (
                        'copy_edit_reverted', 'copy_delete_restored',
                        'copy_edit_held', 'copy_delete_held'
                    )),
                    status TEXT NOT NULL CHECK (status IN ('unread', 'acknowledged', 'resolved')),
                    resolution TEXT CHECK (resolution IN ('restore', 'keep_and_detach')),
                    copy_summary TEXT NOT NULL,
                    copy_start REAL NOT NULL,
                    copy_end REAL NOT NULL,
                    copy_all_day INTEGER NOT NULL,
                    created_at REAL NOT NULL,
                    updated_at REAL NOT NULL
                )
                """)
            try database.execute(sql: """
                CREATE INDEX sync_notices_open ON sync_notices (status, created_at)
                """)
            try database.execute(
                sql: "UPDATE store_metadata SET value = ? WHERE key = 'schema_version'",
                arguments: [currentSchemaVersion]
            )
        }
        return migrator
    }

    private static func validate(_ batch: ChangeBatchHandle, in database: Database) throws {
        guard let row = try Row.fetchOne(
            database,
            sql: "SELECT * FROM change_batches WHERE id = ?",
            arguments: [batch.id.uuidString]
        ) else {
            throw RepositoryError.unknownBatch
        }
        let endpoint = try endpoint(
            provider: row["provider"],
            accountID: row["account_id"],
            calendarID: row["calendar_id"]
        )
        let modeName: String = row["mode"]
        let mode: ChangeBatchMode
        if modeName == "incremental" {
            mode = .incremental
        } else if modeName == "full",
                  let start: Double = row["range_start"],
                  let end: Double = row["range_end"]
        {
            mode = .full(
                start: Date(timeIntervalSince1970: start),
                end: Date(timeIntervalSince1970: end)
            )
        } else {
            throw EncryptedStoreError.corruptRecord
        }
        guard endpoint == batch.endpoint, mode == batch.mode else {
            throw RepositoryError.mismatchedCalendar
        }
    }

    private static func projection(from row: Row) throws -> StoredProjection {
        let provider: String = row["destination_provider"]
        let accountID: String = row["destination_account_id"]
        let calendarID: String = row["destination_calendar_id"]
        let updatedAt: Double = row["updated_at"]
        let holdCode: String? = row["hold_code"]
        let hold: DestinationEditHold?
        if let holdCode {
            guard let known = DestinationEditHold(rawValue: holdCode) else {
                throw EncryptedStoreError.corruptRecord
            }
            hold = known
        } else {
            hold = nil
        }
        return StoredProjection(
            key: ProjectionKey(
                policyID: row["policy_id"],
                sourceEventID: row["source_event_id"],
                sourceOccurrenceID: try occurrenceID(from: row["source_occurrence_key"])
            ),
            destinationEndpoint: try endpoint(
                provider: provider,
                accountID: accountID,
                calendarID: calendarID
            ),
            destinationEventID: row["destination_event_id"],
            desiredFingerprint: row["desired_fingerprint"],
            providerRevision: row["provider_revision"],
            hold: hold,
            detached: row["detached"],
            updatedAt: Date(timeIntervalSince1970: updatedAt)
        )
    }

    private static func notice(from row: Row) throws -> SyncNotice {
        let idString: String = row["id"]
        let kindString: String = row["kind"]
        let statusString: String = row["status"]
        let resolutionString: String? = row["resolution"]
        guard let id = UUID(uuidString: idString),
              let kind = SyncNoticeKind(rawValue: kindString),
              let status = SyncNoticeStatus(rawValue: statusString)
        else {
            throw EncryptedStoreError.corruptRecord
        }
        let resolution: SyncNoticeResolution?
        if let resolutionString {
            guard let known = SyncNoticeResolution(rawValue: resolutionString) else {
                throw EncryptedStoreError.corruptRecord
            }
            resolution = known
        } else {
            resolution = nil
        }
        let copyStart: Double = row["copy_start"]
        let copyEnd: Double = row["copy_end"]
        let createdAt: Double = row["created_at"]
        let updatedAt: Double = row["updated_at"]
        return SyncNotice(
            id: id,
            projectionKey: ProjectionKey(
                policyID: row["policy_id"],
                sourceEventID: row["source_event_id"],
                sourceOccurrenceID: try occurrenceID(from: row["source_occurrence_key"])
            ),
            kind: kind,
            status: status,
            resolution: resolution,
            copySummary: row["copy_summary"],
            copyStart: Date(timeIntervalSince1970: copyStart),
            copyEnd: Date(timeIntervalSince1970: copyEnd),
            copyIsAllDay: row["copy_all_day"],
            createdAt: Date(timeIntervalSince1970: createdAt),
            updatedAt: Date(timeIntervalSince1970: updatedAt)
        )
    }

    private static func effect(from row: Row) throws -> OutboxEffect {
        let idString: String = row["id"]
        let stateString: String = row["state"]
        guard let id = UUID(uuidString: idString),
              let state = OutboxState(rawValue: stateString)
        else {
            throw EncryptedStoreError.corruptRecord
        }
        let nextAttemptAt: Double = row["next_attempt_at"]
        let createdAt: Double = row["created_at"]
        return OutboxEffect(
            id: id,
            idempotencyKey: row["idempotency_key"],
            projectionKey: ProjectionKey(
                policyID: row["policy_id"],
                sourceEventID: row["source_event_id"],
                sourceOccurrenceID: try occurrenceID(from: row["source_occurrence_key"])
            ),
            mutation: try decode(ProviderMutation.self, from: row["mutation_json"]),
            state: state,
            attemptCount: row["attempt_count"],
            nextAttemptAt: Date(timeIntervalSince1970: nextAttemptAt),
            lastError: row["last_error"],
            createdAt: Date(timeIntervalSince1970: createdAt)
        )
    }

    private static func endpoint(
        provider: String,
        accountID: String,
        calendarID: String
    ) throws -> CalendarEndpoint {
        guard let providerKind = CalendarProviderKind(rawValue: provider),
              !accountID.isEmpty,
              !calendarID.isEmpty
        else {
            throw EncryptedStoreError.corruptRecord
        }
        return CalendarEndpoint(
            provider: providerKind,
            accountID: accountID,
            calendarID: calendarID
        )
    }

    private static func persistedMode(
        _ mode: ChangeBatchMode
    ) -> (name: String, start: Double?, end: Double?) {
        switch mode {
        case .incremental:
            return ("incremental", nil, nil)
        case .full(let start, let end):
            return ("full", start.timeIntervalSince1970, end.timeIntervalSince1970)
        }
    }

    private static func observationKey(_ event: SourceEvent) -> String {
        event.id + "\u{001f}" + occurrenceKey(event.occurrenceID)
    }

    /// Distinguishes nil from every provider-supplied string, including an
    /// empty string, without relying on SQLite's nullable-primary-key quirks.
    private static func occurrenceKey(_ occurrenceID: String?) -> String {
        guard let occurrenceID else { return "0" }
        return "1" + occurrenceID
    }

    private static func occurrenceID(from occurrenceKey: String) throws -> String? {
        if occurrenceKey == "0" { return nil }
        guard occurrenceKey.first == "1" else { throw EncryptedStoreError.corruptRecord }
        return String(occurrenceKey.dropFirst())
    }

    private static func encode<Value: Encodable>(_ value: Value) throws -> Data {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        return try encoder.encode(value)
    }

    private static func decode<Value: Decodable>(
        _ type: Value.Type,
        from data: Data
    ) throws -> Value {
        do {
            return try JSONDecoder().decode(type, from: data)
        } catch {
            throw EncryptedStoreError.corruptRecord
        }
    }

    private static func endpointArguments(_ endpoint: CalendarEndpoint) -> StatementArguments {
        [endpoint.provider.rawValue, endpoint.accountID, endpoint.calendarID]
    }
}

/// Production composition entry point. Availability means the audited
/// SQLCipher implementation is linked; readiness is established only after
/// `open` succeeds with the device-bound Keychain key.
public enum ProductionStoreGate {
    public static let isAvailable = true

    public static func open(
        databaseURL: URL,
        secretStore: any SecretStore = KeychainSecretStore()
    ) async throws -> EncryptedPlanipusRepository {
        try await EncryptedPlanipusRepository.open(
            databaseURL: databaseURL,
            secretStore: secretStore
        )
    }
}
