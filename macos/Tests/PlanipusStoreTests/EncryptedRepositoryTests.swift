import Foundation
import PlanipusCore
import PlanipusSecrets
import PlanipusStore
import XCTest

final class EncryptedRepositoryTests: XCTestCase {
    private var temporaryDirectories: [URL] = []

    override func tearDownWithError() throws {
        for directory in temporaryDirectories {
            try? FileManager.default.removeItem(at: directory)
        }
        temporaryDirectories.removeAll()
    }

    func testEncryptedHeaderAndEveryDurableEntitySurviveReopen() async throws {
        let databaseURL = try makeDatabaseURL()
        let secrets = InMemorySecretStore()
        let source = CalendarEndpoint(accountID: "personal-subject", calendarID: "primary")
        let destination = CalendarEndpoint(accountID: "employer-subject", calendarID: "primary")
        let event = makeEvent(
            id: "private-dentist-appointment",
            calendarID: source.calendarID,
            title: "Dentist at 1 Main Street"
        )
        let projectionKey = ProjectionKey(
            policyID: "personal-to-work",
            sourceEventID: event.id,
            sourceOccurrenceID: nil
        )
        let now = Date(timeIntervalSince1970: 1_800_000_000)
        let projection = StoredProjection(
            key: projectionKey,
            destinationEndpoint: destination,
            destinationEventID: "managed-copy",
            desiredFingerprint: "fingerprint",
            providerRevision: "etag-1",
            updatedAt: now
        )
        let effect = makeEffect(
            idempotencyKey: "create:personal-to-work:private-dentist-appointment",
            projectionKey: projectionKey,
            destination: destination,
            now: now
        )
        let policy = SyncPolicy(
            id: "personal-to-work",
            sourceAccountID: source.accountID,
            sourceCalendarID: source.calendarID,
            destinationAccountID: destination.accountID,
            destinationCalendarID: destination.calendarID,
            destinationIdentityEmail: "you@work.example",
            hoursProfile: .weekdays(timezoneIdentifier: "America/Vancouver"),
            privacyPreset: .busyOnly
        )
        let appConfiguration = NativeAppConfiguration(
            installationID: "stable-installation-id",
            accounts: [
                StoredNativeAccount(
                    id: source.accountID,
                    email: "you@personal.example",
                    role: "Personal",
                    colorName: "purple"
                ),
                StoredNativeAccount(
                    id: destination.accountID,
                    email: "you@work.example",
                    role: "Work",
                    colorName: "green"
                ),
            ],
            bridges: [
                StoredNativeBridge(
                    id: policy.id,
                    sourceEmail: "you@personal.example",
                    destinationEmail: "you@work.example",
                    hoursSummary: "Weekdays, 9:00–5:00",
                    policy: policy
                ),
            ]
        )

        let first = try await EncryptedPlanipusRepository.open(
            databaseURL: databaseURL,
            secretStore: secrets
        )
        let firstSchemaVersion = try await first.schemaVersion()
        XCTAssertEqual(firstSchemaVersion, EncryptedPlanipusRepository.currentSchemaVersion)
        let batch = try await first.beginChangeBatch(endpoint: source, mode: .incremental)
        try await first.stage([event], in: batch)
        try await first.commit(batch, nextSyncToken: "sync-token-1")
        try await first.saveProjection(projection)
        try await first.saveAppConfiguration(appConfiguration)
        let didEnqueue = try await first.enqueue(effect)
        XCTAssertTrue(didEnqueue)
        try await first.close()

        let file = try Data(contentsOf: databaseURL)
        let sqliteMagic = Data("SQLite format 3\0".utf8)
        XCTAssertGreaterThanOrEqual(file.count, sqliteMagic.count)
        XCTAssertNotEqual(file.prefix(sqliteMagic.count), sqliteMagic[...])
        XCTAssertNil(file.range(of: Data(event.title.utf8)))

        let reopened = try await EncryptedPlanipusRepository.open(
            databaseURL: databaseURL,
            secretStore: secrets
        )
        let reopenedSchemaVersion = try await reopened.schemaVersion()
        let reopenedToken = try await reopened.syncToken(for: source)
        let reopenedObservations = try await reopened.observations(at: source)
        let reopenedProjection = try await reopened.projection(for: projectionKey)
        let reopenedEffects = try await reopened.dueEffects(at: now, limit: 10)
        let reopenedConfiguration = try await reopened.loadAppConfiguration()
        XCTAssertEqual(reopenedSchemaVersion, EncryptedPlanipusRepository.currentSchemaVersion)
        XCTAssertEqual(reopenedToken, "sync-token-1")
        XCTAssertEqual(reopenedObservations, [event])
        XCTAssertEqual(reopenedProjection, projection)
        XCTAssertEqual(reopenedEffects, [effect])
        XCTAssertEqual(reopenedConfiguration, appConfiguration)
        try await reopened.close()
    }

    func testQuarantinedEffectIsDurableAndExcludedFromAutomaticRetry() async throws {
        let databaseURL = try makeDatabaseURL()
        let secrets = InMemorySecretStore()
        let now = Date(timeIntervalSince1970: 1_800_000_000)
        let destination = CalendarEndpoint(accountID: "employer", calendarID: "primary")
        let projectionKey = ProjectionKey(
            policyID: "blocked-policy",
            sourceEventID: "source-event",
            sourceOccurrenceID: nil
        )
        let blocked = makeEffect(
            idempotencyKey: "blocked-effect",
            projectionKey: projectionKey,
            destination: destination,
            now: now
        )
        let safe = makeEffect(
            idempotencyKey: "safe-effect",
            projectionKey: ProjectionKey(
                policyID: "safe-policy",
                sourceEventID: "safe-source-event",
                sourceOccurrenceID: nil
            ),
            destination: destination,
            now: now.addingTimeInterval(1)
        )

        let first = try await EncryptedPlanipusRepository.open(
            databaseURL: databaseURL,
            secretStore: secrets
        )
        let blockedWasEnqueued = try await first.enqueue(blocked)
        let safeWasEnqueued = try await first.enqueue(safe)
        XCTAssertTrue(blockedWasEnqueued)
        XCTAssertTrue(safeWasEnqueued)
        try await first.markQuarantined(
            id: blocked.id,
            error: "destination ownership marker mismatch"
        )
        let firstDue = try await first.dueEffects(at: now.addingTimeInterval(2), limit: 10)
        let firstHasQuarantine = try await first.hasQuarantinedEffects()
        XCTAssertEqual(firstDue.map(\.id), [safe.id])
        XCTAssertTrue(firstHasQuarantine)
        try await first.close()

        let reopened = try await EncryptedPlanipusRepository.open(
            databaseURL: databaseURL,
            secretStore: secrets
        )
        let reopenedDue = try await reopened.dueEffects(
            at: now.addingTimeInterval(2),
            limit: 10
        )
        let reopenedHasQuarantine = try await reopened.hasQuarantinedEffects()
        XCTAssertEqual(reopenedDue.map(\.id), [safe.id])
        XCTAssertTrue(reopenedHasQuarantine)
        try await reopened.close()
    }

    func testWrongKeyFailsWithoutOverwritingDatabase() async throws {
        let databaseURL = try makeDatabaseURL()
        let correctSecrets = InMemorySecretStore()
        let endpoint = CalendarEndpoint(accountID: "personal", calendarID: "primary")
        let event = makeEvent(id: "event-1", calendarID: "primary", title: "Private event")

        let original = try await EncryptedPlanipusRepository.open(
            databaseURL: databaseURL,
            secretStore: correctSecrets
        )
        let batch = try await original.beginChangeBatch(endpoint: endpoint, mode: .incremental)
        try await original.stage([event], in: batch)
        try await original.commit(batch, nextSyncToken: "safe-token")
        try await original.close()
        let before = try Data(contentsOf: databaseURL)

        let wrongSecrets = InMemorySecretStore()
        await wrongSecrets.save(
            Data(repeating: 0xA5, count: DatabaseKey.byteCount),
            as: .planipusDatabaseKey
        )
        do {
            _ = try await EncryptedPlanipusRepository.open(
                databaseURL: databaseURL,
                secretStore: wrongSecrets
            )
            XCTFail("A wrong key must not open or replace an existing database")
        } catch let error as EncryptedStoreError {
            XCTAssertEqual(error, .invalidDatabaseKey)
        }
        XCTAssertEqual(try Data(contentsOf: databaseURL), before)

        let recoveredWithOriginalKey = try await EncryptedPlanipusRepository.open(
            databaseURL: databaseURL,
            secretStore: correctSecrets
        )
        let recoveredToken = try await recoveredWithOriginalKey.syncToken(for: endpoint)
        let recoveredEvents = try await recoveredWithOriginalKey.observations(at: endpoint)
        XCTAssertEqual(recoveredToken, "safe-token")
        XCTAssertEqual(recoveredEvents, [event])
        try await recoveredWithOriginalKey.close()
    }

    func testExistingDatabaseWithoutKeyFailsBeforeGeneratingReplacement() async throws {
        let databaseURL = try makeDatabaseURL()
        let originalSecrets = InMemorySecretStore()
        let original = try await EncryptedPlanipusRepository.open(
            databaseURL: databaseURL,
            secretStore: originalSecrets
        )
        try await original.close()
        let before = try Data(contentsOf: databaseURL)

        let emptySecrets = InMemorySecretStore()
        do {
            _ = try await EncryptedPlanipusRepository.open(
                databaseURL: databaseURL,
                secretStore: emptySecrets
            )
            XCTFail("An existing database must never receive a guessed replacement key")
        } catch let error as DatabaseKeyError {
            XCTAssertEqual(error, .missingForExistingDatabase)
        }
        let replacementKey = await emptySecrets.read(.planipusDatabaseKey)
        XCTAssertNil(replacementKey)
        XCTAssertEqual(try Data(contentsOf: databaseURL), before)
    }

    func testMigrationsAreIdempotentAndPreserveData() async throws {
        let databaseURL = try makeDatabaseURL()
        let secrets = InMemorySecretStore()
        let endpoint = CalendarEndpoint(accountID: "personal", calendarID: "primary")
        let event = makeEvent(id: "migration-event", calendarID: "primary", title: "Busy")

        let first = try await EncryptedPlanipusRepository.open(
            databaseURL: databaseURL,
            secretStore: secrets
        )
        let initialSchemaVersion = try await first.schemaVersion()
        XCTAssertEqual(initialSchemaVersion, EncryptedPlanipusRepository.currentSchemaVersion)
        let batch = try await first.beginChangeBatch(endpoint: endpoint, mode: .incremental)
        try await first.stage([event], in: batch)
        try await first.commit(batch, nextSyncToken: "migration-token")
        try await first.close()

        for _ in 0..<2 {
            let reopened = try await EncryptedPlanipusRepository.open(
                databaseURL: databaseURL,
                secretStore: secrets
            )
            let schemaVersion = try await reopened.schemaVersion()
            let token = try await reopened.syncToken(for: endpoint)
            let observations = try await reopened.observations(at: endpoint)
            XCTAssertEqual(schemaVersion, EncryptedPlanipusRepository.currentSchemaVersion)
            XCTAssertEqual(token, "migration-token")
            XCTAssertEqual(observations, [event])
            try await reopened.close()
        }
    }

    func testCursorAndStagedBatchCommitAtomically() async throws {
        let store = try await EncryptedPlanipusRepository.open(
            databaseURL: try makeDatabaseURL(),
            secretStore: InMemorySecretStore()
        )
        let endpoint = CalendarEndpoint(accountID: "personal", calendarID: "primary")
        let otherEndpoint = CalendarEndpoint(accountID: "employer", calendarID: "primary")
        let event = makeEvent(id: "event-1", calendarID: "primary", title: "Busy")
        let batch = try await store.beginChangeBatch(endpoint: endpoint, mode: .incremental)
        try await store.stage([event], in: batch)

        let stagedToken = try await store.syncToken(for: endpoint)
        let stagedObservations = try await store.observations(at: endpoint)
        XCTAssertNil(stagedToken)
        XCTAssertEqual(stagedObservations, [])

        let forgedHandle = ChangeBatchHandle(id: batch.id, endpoint: otherEndpoint, mode: .incremental)
        do {
            _ = try await store.commit(forgedHandle, nextSyncToken: "must-not-commit")
            XCTFail("A mismatched handle must roll back the entire transaction")
        } catch let error as RepositoryError {
            XCTAssertEqual(error, .mismatchedCalendar)
        }
        let rolledBackToken = try await store.syncToken(for: endpoint)
        let otherToken = try await store.syncToken(for: otherEndpoint)
        let rolledBackObservations = try await store.observations(at: endpoint)
        XCTAssertNil(rolledBackToken)
        XCTAssertNil(otherToken)
        XCTAssertEqual(rolledBackObservations, [])

        try await store.commit(batch, nextSyncToken: "committed-token")
        let committedToken = try await store.syncToken(for: endpoint)
        let committedObservations = try await store.observations(at: endpoint)
        XCTAssertEqual(committedToken, "committed-token")
        XCTAssertEqual(committedObservations, [event])

        let abandoned = try await store.beginChangeBatch(endpoint: endpoint, mode: .incremental)
        let second = makeEvent(id: "event-2", calendarID: "primary", title: "Another")
        try await store.stage([second], in: abandoned)
        await store.abandon(abandoned)
        let tokenAfterAbandon = try await store.syncToken(for: endpoint)
        let observationsAfterAbandon = try await store.observations(at: endpoint)
        XCTAssertEqual(tokenAfterAbandon, "committed-token")
        XCTAssertEqual(observationsAfterAbandon, [event])
        try await store.close()
    }

    func testRelaunchDiscardsUncommittedCrashBatchWithoutAdvancingCursor() async throws {
        let databaseURL = try makeDatabaseURL()
        let secrets = InMemorySecretStore()
        let endpoint = CalendarEndpoint(accountID: "personal", calendarID: "primary")
        let event = makeEvent(id: "staged-before-crash", calendarID: "primary", title: "Busy")

        let first = try await EncryptedPlanipusRepository.open(
            databaseURL: databaseURL,
            secretStore: secrets
        )
        let abandonedByCrash = try await first.beginChangeBatch(
            endpoint: endpoint,
            mode: .incremental
        )
        try await first.stage([event], in: abandonedByCrash)
        try await first.close()

        let reopened = try await EncryptedPlanipusRepository.open(
            databaseURL: databaseURL,
            secretStore: secrets
        )
        do {
            _ = try await reopened.commit(abandonedByCrash, nextSyncToken: "unsafe-token")
            XCTFail("A staged pre-crash batch must not survive a process restart")
        } catch let error as RepositoryError {
            XCTAssertEqual(error, .unknownBatch)
        }
        let token = try await reopened.syncToken(for: endpoint)
        let observations = try await reopened.observations(at: endpoint)
        XCTAssertNil(token)
        XCTAssertEqual(observations, [])
        try await reopened.close()
    }

    func testSamePrimaryCalendarAndPoliciesRemainSeparatedByAccount() async throws {
        let store = try await EncryptedPlanipusRepository.open(
            databaseURL: try makeDatabaseURL(),
            secretStore: InMemorySecretStore()
        )
        let personal = CalendarEndpoint(accountID: "personal-google-sub", calendarID: "primary")
        let employer = CalendarEndpoint(accountID: "employer-google-sub", calendarID: "primary")
        let secondEmployer = CalendarEndpoint(accountID: "other-work-sub", calendarID: "primary")
        let personalEvent = makeEvent(id: "same-provider-id", calendarID: "primary", title: "Personal")
        let employerEvent = makeEvent(id: "same-provider-id", calendarID: "primary", title: "Work")

        let personalBatch = try await store.beginChangeBatch(endpoint: personal, mode: .incremental)
        try await store.stage([personalEvent], in: personalBatch)
        try await store.commit(personalBatch, nextSyncToken: "personal-token")
        let employerBatch = try await store.beginChangeBatch(endpoint: employer, mode: .incremental)
        try await store.stage([employerEvent], in: employerBatch)
        try await store.commit(employerBatch, nextSyncToken: "work-token")

        let firstKey = ProjectionKey(
            policyID: "personal-to-employer",
            sourceEventID: personalEvent.id,
            sourceOccurrenceID: nil
        )
        let secondKey = ProjectionKey(
            policyID: "personal-to-other-work",
            sourceEventID: personalEvent.id,
            sourceOccurrenceID: nil
        )
        let now = Date(timeIntervalSince1970: 1_800_000_000)
        let firstProjection = StoredProjection(
            key: firstKey,
            destinationEndpoint: employer,
            destinationEventID: "copy-one",
            desiredFingerprint: "fp-one",
            updatedAt: now
        )
        let secondProjection = StoredProjection(
            key: secondKey,
            destinationEndpoint: secondEmployer,
            destinationEventID: "copy-two",
            desiredFingerprint: "fp-two",
            updatedAt: now
        )
        try await store.saveProjection(firstProjection)
        try await store.saveProjection(secondProjection)
        let firstEffect = makeEffect(
            idempotencyKey: "first-policy-create",
            projectionKey: firstKey,
            destination: employer,
            now: now
        )
        let secondEffect = makeEffect(
            idempotencyKey: "second-policy-create",
            projectionKey: secondKey,
            destination: secondEmployer,
            now: now.addingTimeInterval(1)
        )
        let didEnqueueFirst = try await store.enqueue(firstEffect)
        let didEnqueueSecond = try await store.enqueue(secondEffect)
        XCTAssertTrue(didEnqueueFirst)
        XCTAssertTrue(didEnqueueSecond)

        let personalToken = try await store.syncToken(for: personal)
        let employerToken = try await store.syncToken(for: employer)
        let personalObservations = try await store.observations(at: personal)
        let employerObservations = try await store.observations(at: employer)
        let storedFirstProjection = try await store.projection(for: firstKey)
        let storedSecondProjection = try await store.projection(for: secondKey)
        XCTAssertEqual(personalToken, "personal-token")
        XCTAssertEqual(employerToken, "work-token")
        XCTAssertEqual(personalObservations, [personalEvent])
        XCTAssertEqual(employerObservations, [employerEvent])
        XCTAssertEqual(storedFirstProjection, firstProjection)
        XCTAssertEqual(storedSecondProjection, secondProjection)
        let due = try await store.dueEffects(at: now.addingTimeInterval(2), limit: 10)
        XCTAssertEqual(due.map(\.mutation.destinationAccountID), [
            employer.accountID,
            secondEmployer.accountID,
        ])
        try await store.close()
    }

    private func makeDatabaseURL() throws -> URL {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("planipus-store-tests-" + UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        temporaryDirectories.append(directory)
        return directory.appendingPathComponent("planipus.sqlite")
    }

    private func makeEvent(
        id: String,
        calendarID: String,
        title: String
    ) -> SourceEvent {
        SourceEvent(
            id: id,
            calendarID: calendarID,
            start: Date(timeIntervalSince1970: 1_800_000_000),
            end: Date(timeIntervalSince1970: 1_800_003_600),
            title: title,
            details: "private description"
        )
    }

    private func makeEffect(
        idempotencyKey: String,
        projectionKey: ProjectionKey,
        destination: CalendarEndpoint,
        now: Date
    ) -> OutboxEffect {
        OutboxEffect(
            idempotencyKey: idempotencyKey,
            projectionKey: projectionKey,
            mutation: ProviderMutation(
                idempotencyKey: idempotencyKey,
                operation: .create,
                policyID: projectionKey.policyID,
                sourceEventID: projectionKey.sourceEventID,
                sourceOccurrenceID: projectionKey.sourceOccurrenceID,
                destinationEndpoint: destination,
                destinationEventID: "managed-" + projectionKey.policyID,
                desiredCopy: nil
            ),
            nextAttemptAt: now,
            createdAt: now
        )
    }
}
