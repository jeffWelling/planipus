import Foundation
import PlanipusCore
import PlanipusStore
import XCTest

final class InMemoryRepositoryTests: XCTestCase {
    func testStagedEventsAndCursorAreInvisibleUntilCommit() async throws {
        let store = InMemoryPlanipusRepository()
        let batch = await store.beginChangeBatch(endpoint: endpoint(), mode: .incremental)
        try await store.stage([event()], in: batch)

        let beforeEvents = await store.observations(at: endpoint())
        let beforeToken = await store.syncToken(for: endpoint())
        XCTAssertTrue(beforeEvents.isEmpty)
        XCTAssertNil(beforeToken)

        try await store.commit(batch, nextSyncToken: "cursor-2")
        let afterEvents = await store.observations(at: endpoint())
        let afterToken = await store.syncToken(for: endpoint())
        XCTAssertEqual(afterEvents, [event()])
        XCTAssertEqual(afterToken, "cursor-2")
    }

    func testAbandonedBatchDoesNotChangeDurableView() async throws {
        let store = InMemoryPlanipusRepository()
        let batch = await store.beginChangeBatch(endpoint: endpoint(), mode: .incremental)
        try await store.stage([event()], in: batch)
        await store.abandon(batch)

        let events = await store.observations(at: endpoint())
        XCTAssertTrue(events.isEmpty)
    }

    func testOutboxDeduplicatesIdempotencyKey() async throws {
        let store = InMemoryPlanipusRepository()
        let now = Date(timeIntervalSince1970: 100)
        let mutation = ProviderMutation(
            idempotencyKey: "same-intent",
            operation: .delete,
            policyID: "policy",
            sourceEventID: "event",
            destinationEndpoint: CalendarEndpoint(accountID: "work-account", calendarID: "work"),
            destinationEventID: "copy",
            desiredCopy: nil
        )
        let key = ProjectionKey(policyID: "policy", sourceEventID: "event", sourceOccurrenceID: nil)
        let first = OutboxEffect(
            idempotencyKey: "same-intent",
            projectionKey: key,
            mutation: mutation,
            nextAttemptAt: now,
            createdAt: now
        )
        let second = OutboxEffect(
            idempotencyKey: "same-intent",
            projectionKey: key,
            mutation: mutation,
            nextAttemptAt: now,
            createdAt: now
        )

        let insertedFirst = await store.enqueue(first)
        let insertedSecond = await store.enqueue(second)
        let due = await store.dueEffects(at: now, limit: 10)
        XCTAssertTrue(insertedFirst)
        XCTAssertFalse(insertedSecond)
        XCTAssertEqual(due.count, 1)
    }

    func testSameCalendarIDInDifferentAccountsHasIndependentCursorAndObservations() async throws {
        let store = InMemoryPlanipusRepository()
        let personal = CalendarEndpoint(accountID: "personal-account", calendarID: "primary")
        let employer = CalendarEndpoint(accountID: "employer-account", calendarID: "primary")
        let personalEvent = SourceEvent(
            id: "personal-event",
            calendarID: "primary",
            start: Date(timeIntervalSince1970: 100),
            end: Date(timeIntervalSince1970: 200),
            title: "Personal"
        )
        let batch = await store.beginChangeBatch(endpoint: personal, mode: .incremental)
        try await store.stage([personalEvent], in: batch)
        try await store.commit(batch, nextSyncToken: "personal-cursor")

        let personalEvents = await store.observations(at: personal)
        let employerEvents = await store.observations(at: employer)
        let personalToken = await store.syncToken(for: personal)
        let employerToken = await store.syncToken(for: employer)
        XCTAssertEqual(personalEvents, [personalEvent])
        XCTAssertTrue(employerEvents.isEmpty)
        XCTAssertEqual(personalToken, "personal-cursor")
        XCTAssertNil(employerToken)
    }

    private func event() -> SourceEvent {
        SourceEvent(
            id: "event",
            calendarID: "personal",
            start: Date(timeIntervalSince1970: 100),
            end: Date(timeIntervalSince1970: 200),
            title: "Appointment",
            providerRevision: "1"
        )
    }

    private func endpoint() -> CalendarEndpoint {
        CalendarEndpoint(accountID: "personal-account", calendarID: "personal")
    }
}
