import CryptoKit
import Foundation
import PlanipusCore
import PlanipusGoogle
import PlanipusStore

public enum AppLifecycle: String, Codable, Sendable {
    case online
    case offline
    case sleeping
    case stopped
}

public enum SyncState: String, Codable, Sendable {
    case current
    case syncing
    case delayed
    case offline
    case actionNeeded = "action_needed"
    case paused
    case stopped
}

public struct SyncStatus: Codable, Equatable, Sendable {
    public var state: SyncState
    public var message: String
    public var lastSuccessfulSync: Date?
    public var updatedAt: Date

    public init(
        state: SyncState,
        message: String,
        lastSuccessfulSync: Date? = nil,
        updatedAt: Date
    ) {
        self.state = state
        self.message = message
        self.lastSuccessfulSync = lastSuccessfulSync
        self.updatedAt = updatedAt
    }
}

/// Hard traversal limits for a cursorless provider refresh. These defaults
/// cover recent history and roughly one year ahead while preventing an account
/// with an unexpectedly large calendar from consuming unbounded memory or API
/// quota. The coordinator persists each page before fetching the next.
public struct SyncTraversalLimits: Sendable, Equatable {
    public var fullSyncPast: TimeInterval
    public var fullSyncFuture: TimeInterval
    public var maximumPages: Int

    public init(
        fullSyncPast: TimeInterval = 30 * 24 * 60 * 60,
        fullSyncFuture: TimeInterval = 400 * 24 * 60 * 60,
        maximumPages: Int = 100
    ) {
        precondition(fullSyncPast >= 0)
        precondition(fullSyncFuture > 0)
        precondition(maximumPages > 0)
        self.fullSyncPast = fullSyncPast
        self.fullSyncFuture = fullSyncFuture
        self.maximumPages = maximumPages
    }
}

/// The single owner of network side effects in the native product.
///
/// Policies are scheduled by source endpoint (`provider + account + calendar`).
/// Policies that read the same endpoint share a provider traversal, while
/// policies for different accounts remain independently active. Cancellation
/// and lifecycle epochs ensure a fetch cannot advance a cursor after sleep or
/// an offline transition.
public actor SyncCoordinator {
    private let provider: any CalendarProvider
    private let repository: any PlanipusRepository
    private let clock: any SyncClock
    private let installationID: String
    private let evaluator: PolicyEvaluator
    private let traversalLimits: SyncTraversalLimits

    private var lifecycle: AppLifecycle = .stopped
    private var lifecycleEpoch = 0
    private var activePolicies: [String: SyncPolicy] = [:]
    private var pollingTasks: [CalendarEndpoint: Task<Void, Never>] = [:]
    private var pollingIntervals: [CalendarEndpoint: Duration] = [:]
    private var runningFeeds: Set<CalendarEndpoint> = []
    private var runSlotOccupied = false
    private var runSlotWaiters: [CheckedContinuation<Void, Never>] = []
    private var currentStatus: SyncStatus

    public init(
        provider: any CalendarProvider,
        repository: any PlanipusRepository,
        installationID: String,
        clock: any SyncClock = SystemSyncClock(),
        evaluator: PolicyEvaluator = PolicyEvaluator(),
        traversalLimits: SyncTraversalLimits = SyncTraversalLimits()
    ) {
        self.provider = provider
        self.repository = repository
        self.installationID = installationID
        self.clock = clock
        self.evaluator = evaluator
        self.traversalLimits = traversalLimits
        let now = clock.now()
        currentStatus = SyncStatus(state: .stopped, message: "Sync is stopped", updatedAt: now)
    }

    deinit {
        for task in pollingTasks.values { task.cancel() }
    }

    public func status() -> SyncStatus { currentStatus }
    public func appLifecycle() -> AppLifecycle { lifecycle }
    public func scheduledPolicyIDs() -> [String] { activePolicies.keys.sorted() }

    public func setLifecycle(_ newLifecycle: AppLifecycle) {
        lifecycleEpoch += 1
        lifecycle = newLifecycle
        if newLifecycle != .online {
            cancelPollingTasks()
        }

        let now = clock.now()
        switch newLifecycle {
        case .online:
            currentStatus = SyncStatus(
                state: .delayed,
                message: "Ready to sync",
                lastSuccessfulSync: currentStatus.lastSuccessfulSync,
                updatedAt: now
            )
            for endpoint in Set(activePolicies.values.map(\.sourceEndpoint)) {
                startPollingTaskIfNeeded(
                    endpoint: endpoint,
                    every: pollingIntervals[endpoint] ?? .seconds(60)
                )
            }
        case .offline:
            currentStatus = SyncStatus(
                state: .offline,
                message: "Waiting for a network connection",
                lastSuccessfulSync: currentStatus.lastSuccessfulSync,
                updatedAt: now
            )
        case .sleeping:
            currentStatus = SyncStatus(
                state: .paused,
                message: "Sync pauses while this Mac sleeps",
                lastSuccessfulSync: currentStatus.lastSuccessfulSync,
                updatedAt: now
            )
        case .stopped:
            currentStatus = SyncStatus(
                state: .stopped,
                message: "Sync is stopped",
                lastSuccessfulSync: currentStatus.lastSuccessfulSync,
                updatedAt: now
            )
        }
    }

    /// Adds or updates one independently active policy. It does not replace
    /// other polling policies. A shared source endpoint has exactly one poller.
    public func startPolling(policy: SyncPolicy, every interval: Duration = .seconds(60)) {
        if let previous = activePolicies[policy.id], previous.sourceEndpoint != policy.sourceEndpoint {
            activePolicies.removeValue(forKey: policy.id)
            stopFeedIfUnused(previous.sourceEndpoint)
        }
        activePolicies[policy.id] = policy
        pollingIntervals[policy.sourceEndpoint] = interval
        guard lifecycle == .online else { return }
        startPollingTaskIfNeeded(endpoint: policy.sourceEndpoint, every: interval)
    }

    public func startPolling(policies: [SyncPolicy], every interval: Duration = .seconds(60)) {
        for policy in policies { startPolling(policy: policy, every: interval) }
    }

    public func stopPolling(policyID: String) {
        guard let policy = activePolicies.removeValue(forKey: policyID) else { return }
        stopFeedIfUnused(policy.sourceEndpoint)
    }

    public func stopPolling() {
        activePolicies.removeAll()
        pollingIntervals.removeAll()
        cancelPollingTasks()
    }

    @discardableResult
    public func runOnce(policy: SyncPolicy) async -> SyncStatus {
        await runOnce(policies: [policy])
    }

    /// Runs all supplied policies, grouping reads by source endpoint. This is
    /// the explicit one-shot entry point used by tests and manual refresh.
    @discardableResult
    public func runOnce(policies: [SyncPolicy]) async -> SyncStatus {
        guard lifecycle == .online else { return currentStatus }
        await acquireRunSlot()
        defer { releaseRunSlot() }
        guard lifecycle == .online, !Task.isCancelled else { return currentStatus }
        let enabled = policies.filter(\.enabled)
        guard !enabled.isEmpty else { return currentStatus }
        let epoch = lifecycleEpoch
        currentStatus = SyncStatus(
            state: .syncing,
            message: "Checking calendars",
            lastSuccessfulSync: currentStatus.lastSuccessfulSync,
            updatedAt: clock.now()
        )

        do {
            let groups = Dictionary(grouping: enabled, by: \.sourceEndpoint)
            for endpoint in groups.keys.sorted(by: Self.endpointOrder) {
                guard let feedPolicies = groups[endpoint] else { continue }
                try await syncFeed(endpoint: endpoint, policies: feedPolicies, epoch: epoch)
            }
            try await drainOutbox(epoch: epoch)
            try ensureCurrent(epoch)

            let now = clock.now()
            currentStatus = SyncStatus(
                state: .current,
                message: "Calendars are in sync",
                lastSuccessfulSync: now,
                updatedAt: now
            )
        } catch is CancellationError {
            // Lifecycle transition already published the user-facing status.
        } catch SyncCoordinatorError.lifecycleChanged {
            // Lifecycle transition already published the user-facing status.
        } catch {
            applyFailure(error)
        }
        return currentStatus
    }

    private func syncFeed(
        endpoint: CalendarEndpoint,
        policies: [SyncPolicy],
        epoch: Int
    ) async throws {
        guard !runningFeeds.contains(endpoint) else { return }
        runningFeeds.insert(endpoint)
        defer { runningFeeds.remove(endpoint) }

        var batch: ChangeBatchHandle?
        do {
            let token = try await repository.syncToken(for: endpoint)
            let fullStart = clock.now().addingTimeInterval(-traversalLimits.fullSyncPast)
            let fullEnd = clock.now().addingTimeInterval(traversalLimits.fullSyncFuture)
            let mode: ChangeBatchMode = token == nil
                ? .full(start: fullStart, end: fullEnd)
                : .incremental
            let newBatch = try await repository.beginChangeBatch(endpoint: endpoint, mode: mode)
            batch = newBatch

            var pageToken: String?
            var lastSyncToken = token
            var pageCount = 0
            var seenPageTokens: Set<String> = []
            repeat {
                try ensureCurrent(epoch)
                guard pageCount < traversalLimits.maximumPages else {
                    throw ProviderError.pageLimitExceeded
                }
                let page = try await provider.fetchChangePage(
                    ProviderChangeRequest(
                        endpoint: endpoint,
                        syncToken: token,
                        pageToken: pageToken,
                        fullSyncStart: token == nil ? fullStart : nil,
                        fullSyncEnd: token == nil ? fullEnd : nil
                    )
                )
                try ensureCurrent(epoch)
                try await repository.stage(page.events, in: newBatch)
                pageCount += 1
                if let nextSyncToken = page.nextSyncToken { lastSyncToken = nextSyncToken }
                pageToken = page.nextPageToken
                if let pageToken, !seenPageTokens.insert(pageToken).inserted {
                    throw ProviderError.malformedResponse
                }
            } while pageToken != nil

            try ensureCurrent(epoch)
            let tombstones = try await repository.commit(newBatch, nextSyncToken: lastSyncToken)
            batch = nil

            // Re-evaluate durable observations on every safety pass so policy
            // edits converge even when Google reports no source changes. The
            // repository returns persisted deletion tombstones at commit.
            let observations = try await repository.observations(at: endpoint)
            for policy in policies {
                for event in observations + tombstones {
                    try ensureCurrent(epoch)
                    try await reconcile(event: event, policy: policy)
                }
            }
        } catch {
            if let batch { await repository.abandon(batch) }
            if let providerError = error as? ProviderError, providerError == .cursorExpired {
                try? await repository.clearSyncToken(for: endpoint)
            }
            throw error
        }
    }

    private func poll(endpoint: CalendarEndpoint, every interval: Duration) async {
        while !Task.isCancelled, lifecycle == .online {
            let policies = activePolicies.values.filter { $0.sourceEndpoint == endpoint }
            guard !policies.isEmpty else { break }
            _ = await runOnce(policies: policies)
            do {
                try await clock.sleep(for: interval)
            } catch {
                break
            }
        }
        // The owner removes task handles when a policy is stopped or the
        // lifecycle changes. An older cancelled task must not remove a newer
        // task installed after wake/reconnect.
    }

    private func startPollingTaskIfNeeded(endpoint: CalendarEndpoint, every interval: Duration) {
        guard pollingTasks[endpoint] == nil else { return }
        pollingTasks[endpoint] = Task { [weak self] in
            guard let self else { return }
            await self.poll(endpoint: endpoint, every: interval)
        }
    }

    private func stopFeedIfUnused(_ endpoint: CalendarEndpoint) {
        guard !activePolicies.values.contains(where: { $0.sourceEndpoint == endpoint }) else { return }
        pollingTasks.removeValue(forKey: endpoint)?.cancel()
        pollingIntervals.removeValue(forKey: endpoint)
    }

    private func cancelPollingTasks() {
        for task in pollingTasks.values { task.cancel() }
        pollingTasks.removeAll()
    }

    /// Provider effects and the outbox are process-wide resources. Different
    /// source pollers may wake together, so complete runs queue here rather
    /// than racing the same durable effect. Unlike a boolean "already running"
    /// guard, queued account feeds are not silently dropped or starved.
    private func acquireRunSlot() async {
        if !runSlotOccupied {
            runSlotOccupied = true
            return
        }
        await withCheckedContinuation { continuation in
            runSlotWaiters.append(continuation)
        }
    }

    private func releaseRunSlot() {
        guard !runSlotWaiters.isEmpty else {
            runSlotOccupied = false
            return
        }
        runSlotWaiters.removeFirst().resume()
    }

    private func reconcile(event: SourceEvent, policy: SyncPolicy) async throws {
        let key = ProjectionKey(
            policyID: policy.id,
            sourceEventID: event.id,
            sourceOccurrenceID: event.occurrenceID
        )
        let projection = try await repository.projection(for: key)

        // A detached copy is deliberately unmanaged, and a destination-edit
        // hold is a pending user decision. Neither may produce provider writes
        // until the person acts through notice resolution.
        if let projection, projection.detached || projection.hold != nil {
            return
        }

        // A destination/account change is a move, not an update. Delete the
        // old owned projection first; the next safety pass creates the new one.
        if let projection, projection.destinationEndpoint != policy.destinationEndpoint {
            try await enqueueOwnedDeletion(
                event: event,
                policy: policy,
                key: key,
                projection: projection
            )
            return
        }

        let decision = evaluator.evaluate(
            event: event,
            policy: policy,
            hasExistingProjection: projection != nil
        )

        switch decision.action {
        case .omit:
            return
        case .copy:
            guard let desiredCopy = decision.desiredCopy else { return }
            let fingerprint = Self.fingerprint(desiredCopy)
            var expectedRevision: String?
            var operation: ProviderMutationOperation = .create
            if let projection {
                let observed = try await verifiedDestination(projection: projection, policyID: policy.id)
                if let observed {
                    expectedRevision = observed.providerRevision
                    // A revision the projection did not record means the owned
                    // copy was changed directly on the destination. The source
                    // stays authoritative; the policy chooses how loudly.
                    let editedDirectly = projection.providerRevision != nil
                        && projection.providerRevision != observed.providerRevision
                    if editedDirectly {
                        switch policy.effectiveDestinationEdits.onEdit {
                        case .holdForReview:
                            try await holdForDecision(
                                projection: projection,
                                hold: .edit,
                                noticeKind: .copyEditHeld,
                                desired: desiredCopy
                            )
                            return
                        case .restoreAndNotify:
                            try await recordNotice(kind: .copyEditReverted, key: key, desired: desiredCopy)
                            operation = .update
                        case .restore:
                            operation = .update
                        }
                    } else if projection.desiredFingerprint == fingerprint {
                        return
                    } else {
                        operation = .update
                    }
                } else {
                    // The managed copy is gone from the destination. A marker
                    // mismatch throws before this point; recreation reuses the
                    // stable destination ID below.
                    switch policy.effectiveDestinationEdits.onDelete {
                    case .holdForReview:
                        try await holdForDecision(
                            projection: projection,
                            hold: .delete,
                            noticeKind: .copyDeleteHeld,
                            desired: desiredCopy
                        )
                        return
                    case .restoreAndNotify:
                        try await recordNotice(kind: .copyDeleteRestored, key: key, desired: desiredCopy)
                    case .restore:
                        break
                    }
                }
            }
            let destinationID = projection?.destinationEventID ?? GoogleEventID.deterministic(
                installationID: installationID,
                policyID: policy.id,
                sourceCalendarID: policy.sourceCalendarID,
                sourceEventID: event.id,
                occurrenceID: event.occurrenceID
            )
            try await enqueue(
                operation: operation,
                sourceRevision: event.providerRevision,
                policy: policy,
                key: key,
                destinationEndpoint: policy.destinationEndpoint,
                destinationEventID: destinationID,
                expectedProviderRevision: expectedRevision,
                desiredCopy: desiredCopy,
                fingerprint: fingerprint
            )
        case .delete:
            guard let projection else { return }
            try await enqueueOwnedDeletion(
                event: event,
                policy: policy,
                key: key,
                projection: projection
            )
        }
    }

    private func enqueueOwnedDeletion(
        event: SourceEvent,
        policy: SyncPolicy,
        key: ProjectionKey,
        projection: StoredProjection
    ) async throws {
        guard let observed = try await verifiedDestination(projection: projection, policyID: policy.id) else {
            try await repository.deleteProjection(for: key)
            return
        }
        try await enqueue(
            operation: .delete,
            sourceRevision: event.providerRevision,
            policy: policy,
            key: key,
            destinationEndpoint: projection.destinationEndpoint,
            destinationEventID: projection.destinationEventID,
            expectedProviderRevision: observed.providerRevision,
            desiredCopy: nil,
            fingerprint: projection.desiredFingerprint
        )
    }

    /// Freeze an owned-but-changed copy for an explicit decision. The person's
    /// direct change stays on the destination; a notice carries the decision.
    private func holdForDecision(
        projection: StoredProjection,
        hold: DestinationEditHold,
        noticeKind: SyncNoticeKind,
        desired: DesiredCopy
    ) async throws {
        var held = projection
        held.hold = hold
        held.updatedAt = clock.now()
        try await repository.saveProjection(held)
        try await recordNotice(kind: noticeKind, key: projection.key, desired: desired)
    }

    private func recordNotice(
        kind: SyncNoticeKind,
        key: ProjectionKey,
        desired: DesiredCopy
    ) async throws {
        try await repository.recordNotice(
            SyncNotice(
                projectionKey: key,
                kind: kind,
                copySummary: desired.summary,
                copyStart: desired.start,
                copyEnd: desired.end,
                copyIsAllDay: desired.isAllDay,
                createdAt: clock.now()
            )
        )
    }

    public func openNotices() async throws -> [SyncNotice] {
        try await repository.notices(includeResolved: false)
    }

    /// Marking a notice as seen is idempotent; resolved notices are unchanged.
    public func acknowledgeNotice(id: UUID) async throws {
        guard var notice = try await repository.notice(id: id) else {
            throw SyncNoticeError.noticeNotFound
        }
        guard notice.status == .unread else { return }
        notice.status = .acknowledged
        notice.updatedAt = clock.now()
        try await repository.updateNotice(notice)
    }

    /// Resolve a held destination-edit notice. `restore` re-applies the
    /// source-authoritative copy (or removes it when the source no longer
    /// projects here); `keepAndDetach` keeps the person's direct change and
    /// stops managing the copy. The run slot serializes this decision against
    /// concurrent polling passes.
    public func resolveNotice(id: UUID, action: SyncNoticeResolution) async throws {
        await acquireRunSlot()
        defer { releaseRunSlot() }
        guard let notice = try await repository.notice(id: id) else {
            throw SyncNoticeError.noticeNotFound
        }
        guard notice.kind.carriesDecision, notice.status != .resolved else {
            throw SyncNoticeError.noticeNotResolvable
        }
        guard var projection = try await repository.projection(for: notice.projectionKey),
              projection.hold != nil,
              !projection.detached
        else {
            throw SyncNoticeError.holdStale
        }
        projection.hold = nil
        projection.updatedAt = clock.now()
        switch action {
        case .keepAndDetach:
            projection.detached = true
            try await repository.saveProjection(projection)
            try await markResolved(notice, as: action)
        case .restore:
            try await repository.saveProjection(projection)
            try await enqueueRestore(projection: projection, key: notice.projectionKey)
            // The decision is durable once the intent is queued; record it
            // before draining so a failure below cannot strand a resolved
            // restore behind an open notice. Then apply the restore now
            // instead of waiting for the next polling pass, which would
            // observe the still-drifted copy first and hold it again. If the
            // write itself fails, the queued intent retries and the copy is
            // honestly re-held with a fresh notice if drift outlives it.
            try await markResolved(notice, as: action)
            try await drainOutbox(epoch: lifecycleEpoch)
        }
    }

    private func markResolved(
        _ notice: SyncNotice,
        as resolution: SyncNoticeResolution
    ) async throws {
        var resolved = notice
        resolved.status = .resolved
        resolved.resolution = resolution
        resolved.updatedAt = clock.now()
        try await repository.updateNotice(resolved)
    }

    private func enqueueRestore(projection: StoredProjection, key: ProjectionKey) async throws {
        guard let policy = try await resolvePolicy(id: key.policyID) else {
            throw SyncNoticeError.policyUnavailable
        }
        let event = try await repository.observations(at: policy.sourceEndpoint).first {
            $0.id == key.sourceEventID && $0.occurrenceID == key.sourceOccurrenceID
        }
        let observed = try await provider.readEvent(
            at: projection.destinationEndpoint,
            eventID: projection.destinationEventID
        )
        if let observed,
           !Self.isOwned(observed, policyID: policy.id, projectionID: projection.destinationEventID)
        {
            throw ProviderError.ownershipMismatch
        }
        if let event {
            let decision = evaluator.evaluate(
                event: event,
                policy: policy,
                hasExistingProjection: true
            )
            if decision.action == .copy, let desired = decision.desiredCopy {
                try await enqueue(
                    operation: observed == nil ? .create : .update,
                    sourceRevision: event.providerRevision,
                    policy: policy,
                    key: key,
                    destinationEndpoint: projection.destinationEndpoint,
                    destinationEventID: projection.destinationEventID,
                    expectedProviderRevision: observed?.providerRevision,
                    desiredCopy: desired,
                    fingerprint: Self.fingerprint(desired)
                )
                return
            }
        }
        // The source event no longer projects to this destination, so the
        // authoritative state is no copy at all.
        guard let observed else {
            try await repository.deleteProjection(for: key)
            return
        }
        try await enqueue(
            operation: .delete,
            sourceRevision: event?.providerRevision,
            policy: policy,
            key: key,
            destinationEndpoint: projection.destinationEndpoint,
            destinationEventID: projection.destinationEventID,
            expectedProviderRevision: observed.providerRevision,
            desiredCopy: nil,
            fingerprint: projection.desiredFingerprint
        )
    }

    private func resolvePolicy(id: String) async throws -> SyncPolicy? {
        if let active = activePolicies[id] { return active }
        let configuration = try await repository.loadAppConfiguration()
        return configuration?.bridges.first { $0.policy.id == id }?.policy
    }

    private func verifiedDestination(
        projection: StoredProjection,
        policyID: String
    ) async throws -> SourceEvent? {
        let observed = try await provider.readEvent(
            at: projection.destinationEndpoint,
            eventID: projection.destinationEventID
        )
        guard let observed else { return nil }
        guard Self.isOwned(observed, policyID: policyID, projectionID: projection.destinationEventID) else {
            throw ProviderError.ownershipMismatch
        }
        return observed
    }

    private func enqueue(
        operation: ProviderMutationOperation,
        sourceRevision: String?,
        policy: SyncPolicy,
        key: ProjectionKey,
        destinationEndpoint: CalendarEndpoint,
        destinationEventID: String,
        expectedProviderRevision: String?,
        desiredCopy: DesiredCopy?,
        fingerprint: String
    ) async throws {
        let idempotencyKey = [
            "outbox-v2",
            operation.rawValue,
            destinationEndpoint.provider.rawValue,
            destinationEndpoint.accountID,
            destinationEndpoint.calendarID,
            destinationEventID,
            String(policy.revision),
            sourceRevision ?? "unversioned",
            fingerprint,
        ].joined(separator: "\u{001f}")
        let mutation = ProviderMutation(
            idempotencyKey: idempotencyKey,
            operation: operation,
            policyID: policy.id,
            sourceEventID: key.sourceEventID,
            sourceOccurrenceID: key.sourceOccurrenceID,
            destinationEndpoint: destinationEndpoint,
            destinationEventID: destinationEventID,
            expectedProviderRevision: expectedProviderRevision,
            desiredCopy: desiredCopy
        )
        let now = clock.now()
        _ = try await repository.enqueue(
            OutboxEffect(
                idempotencyKey: idempotencyKey,
                projectionKey: key,
                mutation: mutation,
                nextAttemptAt: now,
                createdAt: now
            )
        )
    }

    private func drainOutbox(epoch: Int) async throws {
        let effects = try await repository.dueEffects(at: clock.now(), limit: 100)
        var foundOwnershipMismatch = false
        for effect in effects {
            try ensureCurrent(epoch)
            do {
                if effect.mutation.operation == .create,
                   effect.state == .ambiguous || effect.state == .applying,
                   let existing = try await provider.readEvent(
                       at: effect.mutation.destinationEndpoint,
                       eventID: effect.mutation.destinationEventID
                   )
                {
                    guard Self.isOwned(
                        existing,
                        policyID: effect.mutation.policyID,
                        projectionID: effect.mutation.destinationEventID
                    ) else {
                        throw ProviderError.ownershipMismatch
                    }
                    try await finish(effect: effect, providerRevision: existing.providerRevision)
                    continue
                }

                try await repository.markApplying(id: effect.id)
                let result = try await provider.apply(effect.mutation)
                if effect.mutation.operation == .create || effect.mutation.operation == .update {
                    guard let verified = try await provider.readEvent(
                        at: effect.mutation.destinationEndpoint,
                        eventID: result.destinationEventID
                    ) else {
                        throw ProviderError.ambiguous
                    }
                    guard Self.isOwned(
                        verified,
                        policyID: effect.mutation.policyID,
                        projectionID: effect.mutation.destinationEventID
                    ) else {
                        throw ProviderError.ownershipMismatch
                    }
                    try await finish(effect: effect, providerRevision: verified.providerRevision)
                } else {
                    try await finish(effect: effect, providerRevision: result.providerRevision)
                }
            } catch let error as ProviderError {
                switch error {
                case .ambiguous:
                    try await repository.markAmbiguous(id: effect.id, error: "ambiguous provider result")
                    throw error
                case .ownershipMismatch:
                    try await repository.markQuarantined(
                        id: effect.id,
                        error: "destination ownership marker mismatch"
                    )
                    // This deterministic destination ID is occupied by an
                    // object Planipus cannot prove it owns. Quarantine the
                    // effect permanently, but keep draining unrelated work so
                    // one account or policy cannot starve the whole process.
                    foundOwnershipMismatch = true
                    continue
                case .conflict:
                    do {
                        try await recoverConflict(effect)
                    } catch let recoveryError as ProviderError
                        where recoveryError == .ownershipMismatch
                    {
                        try await repository.markQuarantined(
                            id: effect.id,
                            error: "destination ownership marker mismatch"
                        )
                        foundOwnershipMismatch = true
                        continue
                    }
                    throw error
                case .notFound where effect.mutation.operation == .delete:
                    try await finish(effect: effect, providerRevision: nil)
                case .notFound where effect.mutation.operation == .update:
                    var replacement = effect.mutation
                    replacement.operation = .create
                    replacement.expectedProviderRevision = nil
                    try await repository.reviseEffect(
                        id: effect.id,
                        mutation: replacement,
                        at: clock.now(),
                        error: "destination disappeared before update"
                    )
                    throw error
                case .unauthorized, .forbidden:
                    try await repository.scheduleRetry(
                        id: effect.id,
                        at: clock.now().addingTimeInterval(300),
                        error: String(describing: error)
                    )
                    throw error
                default:
                    let delay = min(pow(2, Double(effect.attemptCount + 1)) * 5, 300)
                    try await repository.scheduleRetry(
                        id: effect.id,
                        at: clock.now().addingTimeInterval(delay),
                        error: String(describing: error)
                    )
                    throw error
                }
            }
        }
        // A quarantine must stay visible across relaunches even though it is
        // deliberately excluded from automatic retries. Check the durable
        // repository after processing all safe effects, then surface the same
        // action-needed status without blocking those effects.
        let hasDurableQuarantine = try await repository.hasQuarantinedEffects()
        if foundOwnershipMismatch || hasDurableQuarantine {
            throw ProviderError.ownershipMismatch
        }
    }

    private func recoverConflict(_ effect: OutboxEffect) async throws {
        let existing = try await provider.readEvent(
            at: effect.mutation.destinationEndpoint,
            eventID: effect.mutation.destinationEventID
        )
        guard let existing else {
            if effect.mutation.operation == .delete {
                try await finish(effect: effect, providerRevision: nil)
                return
            }
            var replacement = effect.mutation
            replacement.operation = .create
            replacement.expectedProviderRevision = nil
            try await repository.reviseEffect(
                id: effect.id,
                mutation: replacement,
                at: clock.now(),
                error: "destination disappeared during conflict recovery"
            )
            return
        }
        guard Self.isOwned(
            existing,
            policyID: effect.mutation.policyID,
            projectionID: effect.mutation.destinationEventID
        ) else {
            throw ProviderError.ownershipMismatch
        }
        if effect.mutation.operation == .create {
            try await finish(effect: effect, providerRevision: existing.providerRevision)
            return
        }
        var replacement = effect.mutation
        replacement.expectedProviderRevision = existing.providerRevision
        try await repository.reviseEffect(
            id: effect.id,
            mutation: replacement,
            at: clock.now(),
            error: "destination revision refreshed after conflict"
        )
    }

    private func finish(effect: OutboxEffect, providerRevision: String?) async throws {
        switch effect.mutation.operation {
        case .create, .update:
            guard let desired = effect.mutation.desiredCopy else { return }
            try await repository.saveProjection(
                StoredProjection(
                    key: effect.projectionKey,
                    destinationEndpoint: effect.mutation.destinationEndpoint,
                    destinationEventID: effect.mutation.destinationEventID,
                    desiredFingerprint: Self.fingerprint(desired),
                    providerRevision: providerRevision,
                    updatedAt: clock.now()
                )
            )
        case .delete:
            try await repository.deleteProjection(for: effect.projectionKey)
        }
        try await repository.markSucceeded(id: effect.id)
    }

    private func ensureCurrent(_ epoch: Int) throws {
        guard epoch == lifecycleEpoch, lifecycle == .online, !Task.isCancelled else {
            throw SyncCoordinatorError.lifecycleChanged
        }
    }

    private func applyFailure(_ error: Error) {
        let now = clock.now()
        let state: SyncState
        let message: String
        switch error as? ProviderError {
        case .unauthorized, .forbidden:
            state = .actionNeeded
            message = "Reconnect a Google account"
        case .ownershipMismatch:
            state = .actionNeeded
            message = "A destination event is no longer owned by Planipus"
        case .pageLimitExceeded:
            state = .actionNeeded
            message = "Calendar history exceeded the configured safety limit"
        case .offline:
            state = .offline
            message = "Waiting for a network connection"
        case .cursorExpired:
            state = .delayed
            message = "Refreshing calendar history"
        default:
            state = .delayed
            message = "Sync will retry"
        }
        currentStatus = SyncStatus(
            state: state,
            message: message,
            lastSuccessfulSync: currentStatus.lastSuccessfulSync,
            updatedAt: now
        )
    }

    private static func isOwned(_ event: SourceEvent, policyID: String, projectionID: String) -> Bool {
        event.isManagedCopy
            && event.managedPolicyID == policyID
            && event.managedProjectionID == projectionID
    }

    private static func endpointOrder(_ lhs: CalendarEndpoint, _ rhs: CalendarEndpoint) -> Bool {
        let left = "\(lhs.provider.rawValue)\u{001f}\(lhs.accountID)\u{001f}\(lhs.calendarID)"
        let right = "\(rhs.provider.rawValue)\u{001f}\(rhs.accountID)\u{001f}\(rhs.calendarID)"
        return left < right
    }

    private static func fingerprint(_ desired: DesiredCopy) -> String {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        encoder.outputFormatting = [.sortedKeys]
        let data = (try? encoder.encode(desired)) ?? Data()
        return SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    }
}

private enum SyncCoordinatorError: Error {
    case lifecycleChanged
}

public enum SyncNoticeError: Error, Equatable, Sendable {
    case noticeNotFound
    case noticeNotResolvable
    case holdStale
    case policyUnavailable
}
