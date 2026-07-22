import Foundation
import PlanipusCore

public actor FakeCalendarProvider: CalendarProvider {
    private var pagesByEndpoint: [CalendarEndpoint: [ProviderChangePage]] = [:]
    private var destinationEvents: [CalendarEndpoint: [String: SourceEvent]] = [:]
    private var queuedFetchErrors: [ProviderError] = []
    private var queuedReadErrors: [ProviderError] = []
    private var queuedApplyErrors: [ProviderError] = []
    private var appliedMutations: [ProviderMutation] = []
    private var fetchRequests: [ProviderChangeRequest] = []
    private var readEndpoints: [CalendarEndpoint] = []
    private var reads = 0

    public init() {}

    public func setPages(_ pages: [ProviderChangePage], at endpoint: CalendarEndpoint) {
        pagesByEndpoint[endpoint] = pages
    }

    public func enqueueError(_ error: ProviderError) {
        queuedApplyErrors.append(error)
    }

    public func enqueueFetchError(_ error: ProviderError) { queuedFetchErrors.append(error) }
    public func enqueueReadError(_ error: ProviderError) { queuedReadErrors.append(error) }
    public func enqueueApplyError(_ error: ProviderError) { queuedApplyErrors.append(error) }

    public func seedDestinationEvent(_ event: SourceEvent, at endpoint: CalendarEndpoint) {
        destinationEvents[endpoint, default: [:]][event.id] = event
    }

    public func removeDestinationEvent(at endpoint: CalendarEndpoint, eventID: String) {
        destinationEvents[endpoint, default: [:]].removeValue(forKey: eventID)
    }

    public func mutations() -> [ProviderMutation] { appliedMutations }
    public func requests() -> [ProviderChangeRequest] { fetchRequests }
    public func readsAtEndpoints() -> [CalendarEndpoint] { readEndpoints }
    public func readCount() -> Int { reads }

    public func fetchChangePage(_ request: ProviderChangeRequest) throws -> ProviderChangePage {
        try Self.throwFirst(&queuedFetchErrors)
        fetchRequests.append(request)
        let pages = pagesByEndpoint[request.endpoint] ?? [
            ProviderChangePage(events: [], nextSyncToken: request.syncToken),
        ]
        guard let pageToken = request.pageToken else { return pages[0] }
        guard let index = pages.indices.dropFirst().first(where: { index in
            pages[index - 1].nextPageToken == pageToken
        }) else {
            throw ProviderError.malformedResponse
        }
        return pages[index]
    }

    public func readEvent(at endpoint: CalendarEndpoint, eventID: String) throws -> SourceEvent? {
        reads += 1
        readEndpoints.append(endpoint)
        try Self.throwFirst(&queuedReadErrors)
        return destinationEvents[endpoint]?[eventID]
    }

    public func apply(_ mutation: ProviderMutation) throws -> ProviderMutationResult {
        try Self.throwFirst(&queuedApplyErrors)
        if mutation.operation != .create,
           let expectedRevision = mutation.expectedProviderRevision,
           let existing = destinationEvents[mutation.destinationEndpoint]?[mutation.destinationEventID],
           existing.providerRevision != expectedRevision
        {
            throw ProviderError.conflict
        }
        appliedMutations.append(mutation)
        switch mutation.operation {
        case .create, .update:
            guard let desired = mutation.desiredCopy else { throw ProviderError.malformedResponse }
            let revision = "fake-\(appliedMutations.count)"
            destinationEvents[mutation.destinationEndpoint, default: [:]][mutation.destinationEventID] =
                SourceEvent(
                    id: mutation.destinationEventID,
                    calendarID: mutation.destinationCalendarID,
                    start: desired.start,
                    end: desired.end,
                    isAllDay: desired.isAllDay,
                    isFree: desired.transparency == .transparent,
                    title: desired.summary,
                    details: desired.description,
                    location: desired.location,
                    conferenceURL: desired.conferenceURL,
                    rsvpStatus: .organizer,
                    isManagedCopy: true,
                    managedPolicyID: mutation.policyID,
                    managedProjectionID: mutation.destinationEventID,
                    providerRevision: revision
                )
        case .delete:
            destinationEvents[mutation.destinationEndpoint, default: [:]]
                .removeValue(forKey: mutation.destinationEventID)
        }
        return ProviderMutationResult(
            destinationEventID: mutation.destinationEventID,
            providerRevision: "fake-\(appliedMutations.count)"
        )
    }

    private static func throwFirst(_ errors: inout [ProviderError]) throws {
        if !errors.isEmpty { throw errors.removeFirst() }
    }
}

public struct FixedSyncClock: SyncClock {
    public let date: Date

    public init(_ date: Date) { self.date = date }
    public func now() -> Date { date }
    public func sleep(for duration: Duration) async throws { try Task.checkCancellation() }
}
