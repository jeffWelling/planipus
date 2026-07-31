import Foundation
import PlanipusCore
import PlanipusStore
import PlanipusSync
import PlanipusTestSupport
import XCTest

final class SyncCoordinatorTests: XCTestCase {
    func testCreateIsAppliedOnceAcrossRepeatedPolling() async throws {
        let (coordinator, provider, _) = await system(event: sourceEvent(revision: "rev-1"))
        await coordinator.setLifecycle(.online)

        let firstStatus = await coordinator.runOnce(policy: policy())
        let secondStatus = await coordinator.runOnce(policy: policy())
        let mutations = await provider.mutations()

        XCTAssertEqual(firstStatus.state, .current)
        XCTAssertEqual(secondStatus.state, .current)
        XCTAssertEqual(mutations.map(\.operation), [.create])
        XCTAssertEqual(mutations.first?.desiredCopy?.summary, "Busy")
        let requests = await provider.requests()
        XCTAssertEqual(requests.first?.endpoint, personalEndpoint())
        XCTAssertEqual(mutations.first?.destinationEndpoint.accountID, "employer-account")
    }

    func testChangedSourceUpdatesTheDeterministicProjection() async throws {
        let (coordinator, provider, _) = await system(event: sourceEvent(revision: "rev-1"))
        await coordinator.setLifecycle(.online)
        _ = await coordinator.runOnce(policy: policy())

        var changed = sourceEvent(revision: "rev-2")
        changed.end = Date(timeIntervalSince1970: 1_700_007_200)
        await provider.setPages(
            [ProviderChangePage(events: [changed], nextSyncToken: "cursor-2")],
            at: personalEndpoint()
        )
        _ = await coordinator.runOnce(policy: policy())
        let mutations = await provider.mutations()

        XCTAssertEqual(mutations.map(\.operation), [.create, .update])
        XCTAssertEqual(mutations[0].destinationEventID, mutations[1].destinationEventID)
        XCTAssertEqual(mutations[1].expectedProviderRevision, "fake-1")
    }

    func testDeletedSourceRemovesExistingProjection() async throws {
        let (coordinator, provider, store) = await system(event: sourceEvent(revision: "rev-1"))
        await coordinator.setLifecycle(.online)
        _ = await coordinator.runOnce(policy: policy())

        var deleted = sourceEvent(revision: "rev-2")
        deleted.isDeleted = true
        await provider.setPages(
            [ProviderChangePage(events: [deleted], nextSyncToken: "cursor-2")],
            at: personalEndpoint()
        )
        _ = await coordinator.runOnce(policy: policy())

        let operations = await provider.mutations().map(\.operation)
        XCTAssertEqual(operations, [.create, .delete])
        let key = ProjectionKey(policyID: "policy", sourceEventID: "event", sourceOccurrenceID: nil)
        let projection = await store.projection(for: key)
        XCTAssertNil(projection)
    }

    func testDirectlyDeletedDestinationCopyIsRecreated() async throws {
        let (coordinator, provider, store) = await system(event: sourceEvent(revision: "rev-1"))
        await coordinator.setLifecycle(.online)
        _ = await coordinator.runOnce(policy: policy())
        let initialMutations = await provider.mutations()
        let created = try XCTUnwrap(initialMutations.first)
        await provider.removeDestinationEvent(
            at: created.destinationEndpoint,
            eventID: created.destinationEventID
        )

        _ = await coordinator.runOnce(policy: policy())
        let operations = await provider.mutations().map(\.operation)
        XCTAssertEqual(operations, [.create, .create])
        // The default destination-edit behavior records a user-facing notice
        // alongside the restore so the deletion cannot pass silently.
        let notices = await store.notices(includeResolved: false)
        XCTAssertEqual(notices.map(\.kind), [.copyDeleteRestored])
        XCTAssertEqual(notices.first?.status, .unread)
    }

    func testDirectEditOfManagedCopyIsRestoredWithNotice() async throws {
        let (coordinator, provider, store) = await system(event: sourceEvent(revision: "rev-1"))
        await coordinator.setLifecycle(.online)
        _ = await coordinator.runOnce(policy: policy())
        let initialMutations = await provider.mutations()
        let created = try XCTUnwrap(initialMutations.first)
        await provider.seedDestinationEvent(
            editedCopy(of: created, title: "Moved by hand on the work calendar"),
            at: created.destinationEndpoint
        )

        let status = await coordinator.runOnce(policy: policy())
        XCTAssertEqual(status.state, .current)
        let mutations = await provider.mutations()
        XCTAssertEqual(mutations.map(\.operation), [.create, .update])
        XCTAssertEqual(mutations.last?.expectedProviderRevision, "user-edit-1")
        let restored = try await provider.readEvent(
            at: created.destinationEndpoint,
            eventID: created.destinationEventID
        )
        XCTAssertEqual(restored?.title, "Busy")
        let notices = await store.notices(includeResolved: false)
        XCTAssertEqual(notices.map(\.kind), [.copyEditReverted])
        XCTAssertEqual(notices.first?.status, .unread)
        XCTAssertEqual(notices.first?.copySummary, "Busy")
    }

    func testDirectEditHoldsForReviewUntilRestoreDecision() async throws {
        let holdPolicy = policy(
            destinationEdits: DestinationEditPolicy(onEdit: .holdForReview, onDelete: .holdForReview)
        )
        let (coordinator, provider, store) = await system(event: sourceEvent(revision: "rev-1"))
        await store.saveAppConfiguration(
            NativeAppConfiguration(
                installationID: "installation",
                bridges: [StoredNativeBridge(
                    id: holdPolicy.id,
                    sourceEmail: "personal@example.invalid",
                    destinationEmail: "work@example.invalid",
                    hoursSummary: "All times",
                    policy: holdPolicy
                )]
            )
        )
        await coordinator.setLifecycle(.online)
        _ = await coordinator.runOnce(policy: holdPolicy)
        let initialMutations = await provider.mutations()
        let created = try XCTUnwrap(initialMutations.first)
        await provider.seedDestinationEvent(
            editedCopy(of: created, title: "Moved by hand on the work calendar"),
            at: created.destinationEndpoint
        )

        // The person's direct change stays in place; the copy is frozen behind
        // a decision notice and repeated passes do not duplicate the notice.
        let heldStatus = await coordinator.runOnce(policy: holdPolicy)
        _ = await coordinator.runOnce(policy: holdPolicy)
        XCTAssertEqual(heldStatus.state, .current)
        let heldMutations = await provider.mutations()
        XCTAssertEqual(heldMutations.map(\.operation), [.create])
        let key = ProjectionKey(policyID: "policy", sourceEventID: "event", sourceOccurrenceID: nil)
        let heldProjectionRow = await store.projection(for: key)
        let heldProjection = try XCTUnwrap(heldProjectionRow)
        XCTAssertEqual(heldProjection.hold, .edit)
        XCTAssertFalse(heldProjection.detached)
        let stillEdited = try await provider.readEvent(
            at: created.destinationEndpoint,
            eventID: created.destinationEventID
        )
        XCTAssertEqual(stillEdited?.title, "Moved by hand on the work calendar")
        let notices = await store.notices(includeResolved: false)
        XCTAssertEqual(notices.map(\.kind), [.copyEditHeld])
        let notice = try XCTUnwrap(notices.first)

        try await coordinator.resolveNotice(id: notice.id, action: .restore)
        let restoredMutations = await provider.mutations()
        XCTAssertEqual(restoredMutations.map(\.operation), [.create, .update])
        let restored = try await provider.readEvent(
            at: created.destinationEndpoint,
            eventID: created.destinationEventID
        )
        XCTAssertEqual(restored?.title, "Busy")
        let resolvedProjectionRow = await store.projection(for: key)
        let resolvedProjection = try XCTUnwrap(resolvedProjectionRow)
        XCTAssertNil(resolvedProjection.hold)
        let resolvedNoticeRow = await store.notice(id: notice.id)
        let resolvedNotice = try XCTUnwrap(resolvedNoticeRow)
        XCTAssertEqual(resolvedNotice.status, .resolved)
        XCTAssertEqual(resolvedNotice.resolution, .restore)
    }

    func testDeletedCopyHeldAndKeptDetached() async throws {
        let holdPolicy = policy(
            destinationEdits: DestinationEditPolicy(onEdit: .holdForReview, onDelete: .holdForReview)
        )
        let (coordinator, provider, store) = await system(event: sourceEvent(revision: "rev-1"))
        await coordinator.setLifecycle(.online)
        _ = await coordinator.runOnce(policy: holdPolicy)
        let initialMutations = await provider.mutations()
        let created = try XCTUnwrap(initialMutations.first)
        await provider.removeDestinationEvent(
            at: created.destinationEndpoint,
            eventID: created.destinationEventID
        )

        _ = await coordinator.runOnce(policy: holdPolicy)
        let heldMutations = await provider.mutations()
        XCTAssertEqual(heldMutations.map(\.operation), [.create])
        let key = ProjectionKey(policyID: "policy", sourceEventID: "event", sourceOccurrenceID: nil)
        let heldProjectionRow = await store.projection(for: key)
        let heldProjection = try XCTUnwrap(heldProjectionRow)
        XCTAssertEqual(heldProjection.hold, .delete)
        let notices = await store.notices(includeResolved: false)
        XCTAssertEqual(notices.map(\.kind), [.copyDeleteHeld])
        let notice = try XCTUnwrap(notices.first)

        // Honoring the deletion detaches the copy; it is never recreated.
        try await coordinator.resolveNotice(id: notice.id, action: .keepAndDetach)
        let detachedProjectionRow = await store.projection(for: key)
        let detachedProjection = try XCTUnwrap(detachedProjectionRow)
        XCTAssertNil(detachedProjection.hold)
        XCTAssertTrue(detachedProjection.detached)
        let resolvedNoticeRow = await store.notice(id: notice.id)
        let resolvedNotice = try XCTUnwrap(resolvedNoticeRow)
        XCTAssertEqual(resolvedNotice.status, .resolved)
        XCTAssertEqual(resolvedNotice.resolution, .keepAndDetach)
        _ = await coordinator.runOnce(policy: holdPolicy)
        let finalMutations = await provider.mutations()
        XCTAssertEqual(finalMutations.map(\.operation), [.create])
        let stillAbsent = try await provider.readEvent(
            at: created.destinationEndpoint,
            eventID: created.destinationEventID
        )
        XCTAssertNil(stillAbsent)
    }

    func testUnownedDestinationCollisionStopsWithoutOverwriting() async throws {
        let (coordinator, provider, _) = await system(event: sourceEvent(revision: "rev-1"))
        await coordinator.setLifecycle(.online)
        _ = await coordinator.runOnce(policy: policy())
        let initialMutations = await provider.mutations()
        let created = try XCTUnwrap(initialMutations.first)
        await provider.seedDestinationEvent(
            SourceEvent(
                id: created.destinationEventID,
                calendarID: created.destinationCalendarID,
                start: Date(timeIntervalSince1970: 1_700_000_000),
                end: Date(timeIntervalSince1970: 1_700_003_600),
                title: "A user's unrelated event",
                isManagedCopy: false,
                providerRevision: "foreign-revision"
            ),
            at: created.destinationEndpoint
        )

        let status = await coordinator.runOnce(policy: policy())
        let mutations = await provider.mutations()
        XCTAssertEqual(status.state, .actionNeeded)
        XCTAssertEqual(mutations.count, 1)
    }

    func testConflictRefreshesRevisionAndRetriesOwnedUpdate() async throws {
        let (coordinator, provider, _) = await system(event: sourceEvent(revision: "rev-1"))
        await coordinator.setLifecycle(.online)
        _ = await coordinator.runOnce(policy: policy())
        var changed = sourceEvent(revision: "rev-2")
        changed.end = Date(timeIntervalSince1970: 1_700_007_200)
        await provider.setPages(
            [ProviderChangePage(events: [changed], nextSyncToken: "cursor-2")],
            at: personalEndpoint()
        )
        await provider.enqueueApplyError(.conflict)

        let conflicted = await coordinator.runOnce(policy: policy())
        let recovered = await coordinator.runOnce(policy: policy())
        let mutations = await provider.mutations()
        XCTAssertEqual(conflicted.state, .delayed)
        XCTAssertEqual(recovered.state, .current)
        XCTAssertEqual(mutations.map(\.operation), [.create, .update])
        XCTAssertEqual(mutations.last?.expectedProviderRevision, "fake-1")
    }

    func testPolicyChangeReconcilesStoredObservationWithoutProviderChange() async throws {
        let (coordinator, provider, _) = await system(event: sourceEvent(revision: "rev-1"))
        await coordinator.setLifecycle(.online)
        _ = await coordinator.runOnce(policy: policy())
        await provider.setPages(
            [ProviderChangePage(events: [], nextSyncToken: "cursor-2")],
            at: personalEndpoint()
        )
        var changedPolicy = policy()
        changedPolicy.revision = 2
        changedPolicy.privacyPreset = .commitment

        _ = await coordinator.runOnce(policy: changedPolicy)
        let mutations = await provider.mutations()
        XCTAssertEqual(mutations.map(\.operation), [.create, .update])
        XCTAssertEqual(mutations.last?.desiredCopy?.summary, "Personal commitment")
    }

    func testAmbiguousCreateAdoptsDeterministicDestinationOnRetry() async throws {
        let (coordinator, provider, store) = await system(event: sourceEvent(revision: "rev-1"))
        await provider.enqueueApplyError(.ambiguous)
        await coordinator.setLifecycle(.online)
        let first = await coordinator.runOnce(policy: policy())
        XCTAssertEqual(first.state, .delayed)

        let due = await store.dueEffects(at: Date(timeIntervalSince1970: 1_700_000_000), limit: 1)
        let effect = try XCTUnwrap(due.first)
        let desired = try XCTUnwrap(effect.mutation.desiredCopy)
        await provider.seedDestinationEvent(
            SourceEvent(
                id: effect.mutation.destinationEventID,
                calendarID: effect.mutation.destinationCalendarID,
                start: desired.start,
                end: desired.end,
                title: desired.summary,
                isManagedCopy: true,
                managedPolicyID: effect.mutation.policyID,
                managedProjectionID: effect.mutation.destinationEventID,
                providerRevision: "provider-created-despite-timeout"
            ),
            at: effect.mutation.destinationEndpoint
        )

        let second = await coordinator.runOnce(policy: policy())
        XCTAssertEqual(second.state, .current)
        let mutations = await provider.mutations()
        let readCount = await provider.readCount()
        XCTAssertTrue(mutations.isEmpty)
        XCTAssertGreaterThan(readCount, 0)
    }

    func testOwnershipMismatchIsQuarantinedWithoutStarvingIndependentPolicy() async throws {
        let provider = FakeCalendarProvider()
        let store = InMemoryPlanipusRepository()
        let now = Date(timeIntervalSince1970: 1_700_000_000)
        let firstSource = CalendarEndpoint(accountID: "personal-one", calendarID: "primary")
        let secondSource = CalendarEndpoint(accountID: "personal-two", calendarID: "primary")
        let firstPolicy = policy(
            id: "first",
            sourceAccountID: firstSource.accountID,
            sourceCalendarID: firstSource.calendarID,
            destinationAccountID: "employer-one",
            destinationCalendarID: "primary"
        )
        let secondPolicy = policy(
            id: "second",
            sourceAccountID: secondSource.accountID,
            sourceCalendarID: secondSource.calendarID,
            destinationAccountID: "employer-two",
            destinationCalendarID: "primary"
        )
        await provider.setPages(
            [ProviderChangePage(
                events: [sourceEvent(id: "first-event", calendarID: "primary")],
                nextSyncToken: "first-cursor"
            )],
            at: firstSource
        )
        let coordinator = SyncCoordinator(
            provider: provider,
            repository: store,
            installationID: "installation",
            clock: FixedSyncClock(now)
        )
        await provider.enqueueApplyError(.ambiguous)
        await coordinator.setLifecycle(.online)

        let ambiguous = await coordinator.runOnce(policy: firstPolicy)
        XCTAssertEqual(ambiguous.state, .delayed)
        let firstDue = await store.dueEffects(at: now, limit: 1)
        let blockedEffect = try XCTUnwrap(firstDue.first)
        await provider.seedDestinationEvent(
            SourceEvent(
                id: blockedEffect.mutation.destinationEventID,
                calendarID: blockedEffect.mutation.destinationCalendarID,
                start: now,
                end: now.addingTimeInterval(3_600),
                title: "Unrelated user event",
                isManagedCopy: false,
                providerRevision: "foreign-revision"
            ),
            at: blockedEffect.mutation.destinationEndpoint
        )
        await provider.setPages(
            [ProviderChangePage(
                events: [sourceEvent(id: "second-event", calendarID: "primary")],
                nextSyncToken: "second-cursor"
            )],
            at: secondSource
        )
        // A fresh coordinator one second later models relaunch and guarantees
        // the quarantined candidate is the oldest due effect. The independent
        // policy is enqueued behind it, which is the starvation order that
        // previously failed.
        let recoveryCoordinator = SyncCoordinator(
            provider: provider,
            repository: store,
            installationID: "installation",
            clock: FixedSyncClock(now.addingTimeInterval(1))
        )
        await recoveryCoordinator.setLifecycle(.online)

        let status = await recoveryCoordinator.runOnce(policies: [firstPolicy, secondPolicy])
        let mutations = await provider.mutations()
        let hasQuarantine = await store.hasQuarantinedEffects()
        let remainingDue = await store.dueEffects(at: now, limit: 10)
        XCTAssertEqual(status.state, .actionNeeded)
        XCTAssertEqual(mutations.map(\.policyID), ["second"])
        XCTAssertTrue(hasQuarantine)
        XCTAssertTrue(remainingDue.isEmpty)

        // The terminal quarantine remains visible, but never re-enters the due
        // queue or causes the independent copy to be applied twice.
        let repeated = await recoveryCoordinator.runOnce(policies: [firstPolicy, secondPolicy])
        let repeatedMutations = await provider.mutations()
        XCTAssertEqual(repeated.state, .actionNeeded)
        XCTAssertEqual(repeatedMutations.map(\.policyID), ["second"])
    }

    func testOfflineLifecycleDoesNotFetchOrMutate() async throws {
        let (coordinator, provider, _) = await system(event: sourceEvent(revision: "rev-1"))
        await coordinator.setLifecycle(.offline)
        let status = await coordinator.runOnce(policy: policy())

        XCTAssertEqual(status.state, .offline)
        let mutations = await provider.mutations()
        XCTAssertTrue(mutations.isEmpty)
    }

    func testExpiredCursorIsClearedForSafeFullRefresh() async throws {
        let (coordinator, provider, store) = await system(event: sourceEvent(revision: "rev-1"))
        let seedBatch = await store.beginChangeBatch(
            endpoint: personalEndpoint(),
            mode: .incremental
        )
        try await store.commit(seedBatch, nextSyncToken: "expired-cursor")
        await provider.enqueueFetchError(.cursorExpired)
        await coordinator.setLifecycle(.online)

        let status = await coordinator.runOnce(policy: policy())
        let cursor = await store.syncToken(for: personalEndpoint())
        XCTAssertEqual(status.state, .delayed)
        XCTAssertNil(cursor)
    }

    func testTwoPoliciesRoutePersonalReadsAndEmployerWritesIndependently() async throws {
        let provider = FakeCalendarProvider()
        let firstSource = CalendarEndpoint(accountID: "personal-one", calendarID: "primary")
        let secondSource = CalendarEndpoint(accountID: "personal-two", calendarID: "primary")
        await provider.setPages(
            [ProviderChangePage(events: [sourceEvent(id: "one", calendarID: "primary")], nextSyncToken: "one-cursor")],
            at: firstSource
        )
        await provider.setPages(
            [ProviderChangePage(events: [sourceEvent(id: "two", calendarID: "primary")], nextSyncToken: "two-cursor")],
            at: secondSource
        )
        let coordinator = SyncCoordinator(
            provider: provider,
            repository: InMemoryPlanipusRepository(),
            installationID: "installation",
            clock: FixedSyncClock(Date(timeIntervalSince1970: 1_700_000_000))
        )
        await coordinator.setLifecycle(.online)

        let status = await coordinator.runOnce(policies: [
            policy(
                id: "one",
                sourceAccountID: "personal-one",
                sourceCalendarID: "primary",
                destinationAccountID: "employer-one",
                destinationCalendarID: "primary"
            ),
            policy(
                id: "two",
                sourceAccountID: "personal-two",
                sourceCalendarID: "primary",
                destinationAccountID: "employer-two",
                destinationCalendarID: "primary"
            ),
        ])

        XCTAssertEqual(status.state, .current)
        let requests = await provider.requests()
        XCTAssertEqual(Set(requests.map(\.endpoint)), Set([firstSource, secondSource]))
        let routes = Dictionary(
            uniqueKeysWithValues: await provider.mutations().map {
                ($0.policyID, $0.destinationEndpoint.accountID)
            }
        )
        XCTAssertEqual(routes, ["one": "employer-one", "two": "employer-two"])
    }

    func testPoliciesSharingSourceDeduplicateProviderPoll() async throws {
        let provider = FakeCalendarProvider()
        await provider.setPages(
            [ProviderChangePage(events: [sourceEvent(revision: "rev-1")], nextSyncToken: "cursor")],
            at: personalEndpoint()
        )
        let coordinator = SyncCoordinator(
            provider: provider,
            repository: InMemoryPlanipusRepository(),
            installationID: "installation",
            clock: FixedSyncClock(Date(timeIntervalSince1970: 1_700_000_000))
        )
        await coordinator.setLifecycle(.online)
        _ = await coordinator.runOnce(policies: [
            policy(id: "first", destinationAccountID: "employer-one"),
            policy(id: "second", destinationAccountID: "employer-two"),
        ])

        let requestCount = await provider.requests().count
        let mutationCount = await provider.mutations().count
        XCTAssertEqual(requestCount, 1)
        XCTAssertEqual(mutationCount, 2)
    }

    func testRegisteringSecondPollingPolicyDoesNotReplaceFirst() async {
        let coordinator = SyncCoordinator(
            provider: FakeCalendarProvider(),
            repository: InMemoryPlanipusRepository(),
            installationID: "installation"
        )
        await coordinator.startPolling(policy: policy(id: "first"))
        await coordinator.startPolling(
            policy: policy(
                id: "second",
                sourceAccountID: "another-personal-account",
                destinationAccountID: "another-employer-account"
            )
        )

        let scheduled = await coordinator.scheduledPolicyIDs()
        XCTAssertEqual(scheduled, ["first", "second"])
    }

    func testFullSyncStagesPagesWithinHardTimeAndPageBounds() async throws {
        let provider = FakeCalendarProvider()
        await provider.setPages(
            [
                ProviderChangePage(
                    events: [sourceEvent(id: "page-one", calendarID: "personal")],
                    nextPageToken: "page-two"
                ),
                ProviderChangePage(
                    events: [sourceEvent(id: "page-two", calendarID: "personal")],
                    nextSyncToken: "cursor"
                ),
            ],
            at: personalEndpoint()
        )
        let store = InMemoryPlanipusRepository()
        let now = Date(timeIntervalSince1970: 1_700_000_000)
        let coordinator = SyncCoordinator(
            provider: provider,
            repository: store,
            installationID: "installation",
            clock: FixedSyncClock(now),
            traversalLimits: SyncTraversalLimits(
                fullSyncPast: 86_400,
                fullSyncFuture: 172_800,
                maximumPages: 2
            )
        )
        await coordinator.setLifecycle(.online)

        let status = await coordinator.runOnce(policy: policy())
        let requests = await provider.requests()
        XCTAssertEqual(status.state, .current)
        XCTAssertEqual(requests.count, 2)
        XCTAssertEqual(requests[0].fullSyncStart, now.addingTimeInterval(-86_400))
        XCTAssertEqual(requests[0].fullSyncEnd, now.addingTimeInterval(172_800))
        XCTAssertEqual(requests[1].pageToken, "page-two")
        let observations = await store.observations(at: personalEndpoint())
        let token = await store.syncToken(for: personalEndpoint())
        XCTAssertEqual(observations.count, 2)
        XCTAssertEqual(token, "cursor")
    }

    func testPageLimitAbandonsBatchWithoutCursorAdvance() async throws {
        let provider = FakeCalendarProvider()
        await provider.setPages(
            [
                ProviderChangePage(
                    events: [sourceEvent(id: "page-one", calendarID: "personal")],
                    nextPageToken: "unsafe-next-page"
                ),
                ProviderChangePage(events: [], nextSyncToken: "must-not-commit"),
            ],
            at: personalEndpoint()
        )
        let store = InMemoryPlanipusRepository()
        let coordinator = SyncCoordinator(
            provider: provider,
            repository: store,
            installationID: "installation",
            clock: FixedSyncClock(Date(timeIntervalSince1970: 1_700_000_000)),
            traversalLimits: SyncTraversalLimits(maximumPages: 1)
        )
        await coordinator.setLifecycle(.online)

        let status = await coordinator.runOnce(policy: policy())
        XCTAssertEqual(status.state, .actionNeeded)
        let observations = await store.observations(at: personalEndpoint())
        let token = await store.syncToken(for: personalEndpoint())
        XCTAssertTrue(observations.isEmpty)
        XCTAssertNil(token)
    }

    private func system(
        event: SourceEvent
    ) async -> (SyncCoordinator, FakeCalendarProvider, InMemoryPlanipusRepository) {
        let provider = FakeCalendarProvider()
        await provider.setPages(
            [ProviderChangePage(events: [event], nextSyncToken: "cursor-1")],
            at: personalEndpoint()
        )
        let store = InMemoryPlanipusRepository()
        let coordinator = SyncCoordinator(
            provider: provider,
            repository: store,
            installationID: "installation",
            clock: FixedSyncClock(Date(timeIntervalSince1970: 1_700_000_000))
        )
        return (coordinator, provider, store)
    }

    private func policy() -> SyncPolicy {
        policy(id: "policy")
    }

    private func policy(destinationEdits: DestinationEditPolicy) -> SyncPolicy {
        policy(id: "policy", destinationEdits: destinationEdits)
    }

    private func policy(
        id: String,
        sourceAccountID: String = "personal-account",
        sourceCalendarID: String = "personal",
        destinationAccountID: String = "employer-account",
        destinationCalendarID: String = "work",
        destinationEdits: DestinationEditPolicy? = nil
    ) -> SyncPolicy {
        SyncPolicy(
            id: id,
            sourceAccountID: sourceAccountID,
            sourceCalendarID: sourceCalendarID,
            destinationAccountID: destinationAccountID,
            destinationCalendarID: destinationCalendarID,
            hoursMode: .allTimes,
            hoursProfile: .weekdays(timezoneIdentifier: "UTC"),
            destinationEdits: destinationEdits
        )
    }

    /// Models a person dragging or retitling the managed copy directly on the
    /// destination calendar: same event, same ownership markers, new provider
    /// revision the projection has not recorded.
    private func editedCopy(of created: ProviderMutation, title: String) -> SourceEvent {
        SourceEvent(
            id: created.destinationEventID,
            calendarID: created.destinationCalendarID,
            start: Date(timeIntervalSince1970: 1_700_010_000),
            end: Date(timeIntervalSince1970: 1_700_013_600),
            title: title,
            isManagedCopy: true,
            managedPolicyID: created.policyID,
            managedProjectionID: created.destinationEventID,
            providerRevision: "user-edit-1"
        )
    }

    private func sourceEvent(revision: String) -> SourceEvent {
        sourceEvent(id: "event", calendarID: "personal", revision: revision)
    }

    private func sourceEvent(
        id: String,
        calendarID: String,
        revision: String = "rev-1"
    ) -> SourceEvent {
        SourceEvent(
            id: id,
            calendarID: calendarID,
            start: Date(timeIntervalSince1970: 1_700_000_000),
            end: Date(timeIntervalSince1970: 1_700_003_600),
            title: "Sensitive personal title",
            details: "Sensitive details",
            providerRevision: revision
        )
    }

    private func personalEndpoint() -> CalendarEndpoint {
        CalendarEndpoint(accountID: "personal-account", calendarID: "personal")
    }
}
