import Foundation
import PlanipusCore

public actor InMemoryPlanipusRepository: PlanipusRepository {
    private struct StagedBatch: Sendable {
        let endpoint: CalendarEndpoint
        let mode: ChangeBatchMode
        var events: [SourceEvent]
    }

    private var tokens: [CalendarEndpoint: String] = [:]
    private var appConfiguration: NativeAppConfiguration?
    private var storedEvents: [CalendarEndpoint: [String: SourceEvent]] = [:]
    private var batches: [UUID: StagedBatch] = [:]
    private var projections: [ProjectionKey: StoredProjection] = [:]
    private var storedNotices: [UUID: SyncNotice] = [:]
    private var effects: [UUID: OutboxEffect] = [:]
    private var effectIDByIdempotencyKey: [String: UUID] = [:]

    public init() {}

    public func loadAppConfiguration() -> NativeAppConfiguration? {
        appConfiguration
    }

    public func saveAppConfiguration(_ configuration: NativeAppConfiguration) {
        appConfiguration = configuration
    }

    public func syncToken(for endpoint: CalendarEndpoint) -> String? {
        tokens[endpoint]
    }

    public func clearSyncToken(for endpoint: CalendarEndpoint) {
        tokens.removeValue(forKey: endpoint)
    }

    public func beginChangeBatch(
        endpoint: CalendarEndpoint,
        mode: ChangeBatchMode
    ) -> ChangeBatchHandle {
        let handle = ChangeBatchHandle(endpoint: endpoint, mode: mode)
        batches[handle.id] = StagedBatch(endpoint: endpoint, mode: mode, events: [])
        return handle
    }

    public func stage(_ events: [SourceEvent], in batch: ChangeBatchHandle) throws {
        guard var staged = batches[batch.id] else { throw RepositoryError.unknownBatch }
        guard staged.endpoint == batch.endpoint, staged.mode == batch.mode else {
            throw RepositoryError.mismatchedCalendar
        }
        guard events.allSatisfy({ $0.calendarID == batch.endpoint.calendarID }) else {
            throw RepositoryError.mismatchedCalendar
        }
        staged.events.append(contentsOf: events)
        batches[batch.id] = staged
    }

    @discardableResult
    public func commit(
        _ batch: ChangeBatchHandle,
        nextSyncToken: String?
    ) throws -> [SourceEvent] {
        guard let staged = batches.removeValue(forKey: batch.id) else {
            throw RepositoryError.unknownBatch
        }
        guard staged.endpoint == batch.endpoint, staged.mode == batch.mode else {
            throw RepositoryError.mismatchedCalendar
        }

        var calendarEvents = storedEvents[batch.endpoint, default: [:]]
        var removedByKey: [String: SourceEvent] = [:]
        if case .full(let start, let end) = staged.mode {
            for (key, event) in calendarEvents where event.end > start && event.start < end {
                var tombstone = event
                tombstone.isDeleted = true
                removedByKey[key] = tombstone
            }
            calendarEvents = calendarEvents.filter { _, event in
                !(event.end > start && event.start < end)
            }
        }
        for event in staged.events {
            let key = Self.observationKey(event)
            if event.isDeleted {
                var tombstone = calendarEvents.removeValue(forKey: key) ?? event
                tombstone.isDeleted = true
                tombstone.providerRevision = event.providerRevision ?? tombstone.providerRevision
                removedByKey[key] = tombstone
            } else {
                calendarEvents[key] = event
                removedByKey.removeValue(forKey: key)
            }
        }
        storedEvents[batch.endpoint] = calendarEvents
        if let nextSyncToken {
            tokens[batch.endpoint] = nextSyncToken
        }
        return removedByKey.values.sorted {
            Self.observationKey($0) < Self.observationKey($1)
        }
    }

    public func abandon(_ batch: ChangeBatchHandle) {
        batches.removeValue(forKey: batch.id)
    }

    public func observations(at endpoint: CalendarEndpoint) -> [SourceEvent] {
        Array(storedEvents[endpoint, default: [:]].values)
            .sorted { Self.observationKey($0) < Self.observationKey($1) }
    }

    public func projection(for key: ProjectionKey) -> StoredProjection? {
        projections[key]
    }

    public func recordNotice(_ notice: SyncNotice) {
        storedNotices[notice.id] = notice
    }

    public func notices(includeResolved: Bool) -> [SyncNotice] {
        storedNotices.values
            .filter { includeResolved || $0.status != .resolved }
            .sorted {
                if $0.createdAt == $1.createdAt { return $0.id.uuidString < $1.id.uuidString }
                return $0.createdAt < $1.createdAt
            }
    }

    public func notice(id: UUID) -> SyncNotice? {
        storedNotices[id]
    }

    public func updateNotice(_ notice: SyncNotice) throws {
        guard storedNotices[notice.id] != nil else { throw RepositoryError.unknownNotice }
        storedNotices[notice.id] = notice
    }

    public func saveProjection(_ projection: StoredProjection) {
        projections[projection.key] = projection
    }

    public func deleteProjection(for key: ProjectionKey) {
        projections.removeValue(forKey: key)
    }

    public func enqueue(_ effect: OutboxEffect) -> Bool {
        if let existingID = effectIDByIdempotencyKey[effect.idempotencyKey],
           let existing = effects[existingID] {
            guard existing.state == .succeeded else { return false }
            // A previously completed intent may be deliberately re-issued when
            // safety reconciliation proves the provider object was deleted.
            effects.removeValue(forKey: existingID)
        }
        effects[effect.id] = effect
        effectIDByIdempotencyKey[effect.idempotencyKey] = effect.id
        return true
    }

    public func dueEffects(at date: Date, limit: Int) -> [OutboxEffect] {
        effects.values
            .filter { effect in
                [.pending, .applying, .ambiguous].contains(effect.state)
                    && effect.nextAttemptAt <= date
            }
            .sorted {
                if $0.nextAttemptAt == $1.nextAttemptAt { return $0.createdAt < $1.createdAt }
                return $0.nextAttemptAt < $1.nextAttemptAt
            }
            .prefix(max(0, limit))
            .map { $0 }
    }

    public func markApplying(id: UUID) throws {
        try updateEffect(id) {
            $0.state = .applying
            $0.attemptCount += 1
        }
    }

    public func markSucceeded(id: UUID) throws {
        try updateEffect(id) { $0.state = .succeeded }
    }

    public func markAmbiguous(id: UUID, error: String) throws {
        try updateEffect(id) {
            $0.state = .ambiguous
            $0.lastError = error
        }
    }

    public func markQuarantined(id: UUID, error: String) throws {
        try updateEffect(id) {
            $0.state = .quarantined
            $0.lastError = error
        }
    }

    public func hasQuarantinedEffects() -> Bool {
        effects.values.contains { $0.state == .quarantined }
    }

    public func scheduleRetry(id: UUID, at date: Date, error: String) throws {
        try updateEffect(id) {
            $0.state = .pending
            $0.nextAttemptAt = date
            $0.lastError = error
        }
    }

    public func reviseEffect(
        id: UUID,
        mutation: ProviderMutation,
        at date: Date,
        error: String
    ) throws {
        try updateEffect(id) {
            $0.mutation = mutation
            $0.state = .pending
            $0.nextAttemptAt = date
            $0.lastError = error
        }
    }

    private func updateEffect(_ id: UUID, body: (inout OutboxEffect) -> Void) throws {
        guard var effect = effects[id] else { throw RepositoryError.unknownEffect }
        body(&effect)
        effects[id] = effect
    }

    private static func observationKey(_ event: SourceEvent) -> String {
        event.id + "\u{001f}" + (event.occurrenceID ?? "")
    }
}
