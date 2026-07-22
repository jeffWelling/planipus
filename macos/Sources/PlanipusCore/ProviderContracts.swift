import Foundation

public enum CalendarProviderKind: String, Codable, CaseIterable, Sendable {
    case google
}

/// A calendar is not globally identified by its provider calendar ID. Google
/// commonly uses `primary` for every signed-in account, so the authenticated
/// account is part of every provider operation and persistence key.
public struct CalendarEndpoint: Codable, Hashable, Sendable {
    public var provider: CalendarProviderKind
    public var accountID: String
    public var calendarID: String

    public init(
        provider: CalendarProviderKind = .google,
        accountID: String,
        calendarID: String
    ) {
        precondition(!accountID.isEmpty)
        precondition(!calendarID.isEmpty)
        self.provider = provider
        self.accountID = accountID
        self.calendarID = calendarID
    }
}

public struct ProviderChangeRequest: Codable, Hashable, Sendable {
    public var endpoint: CalendarEndpoint
    public var syncToken: String?
    public var pageToken: String?
    public var fullSyncStart: Date?
    public var fullSyncEnd: Date?

    public init(
        endpoint: CalendarEndpoint,
        syncToken: String?,
        pageToken: String? = nil,
        fullSyncStart: Date? = nil,
        fullSyncEnd: Date? = nil
    ) {
        self.endpoint = endpoint
        self.syncToken = syncToken
        self.pageToken = pageToken
        self.fullSyncStart = fullSyncStart
        self.fullSyncEnd = fullSyncEnd
    }
}

public struct ProviderChangePage: Codable, Hashable, Sendable {
    public var events: [SourceEvent]
    public var nextPageToken: String?
    public var nextSyncToken: String?

    public init(events: [SourceEvent], nextPageToken: String? = nil, nextSyncToken: String? = nil) {
        self.events = events
        self.nextPageToken = nextPageToken
        self.nextSyncToken = nextSyncToken
    }
}

public enum ProviderMutationOperation: String, Codable, Sendable {
    case create
    case update
    case delete
}

public struct ProviderMutation: Codable, Hashable, Sendable {
    public var idempotencyKey: String
    public var operation: ProviderMutationOperation
    public var policyID: String
    public var sourceEventID: String
    public var sourceOccurrenceID: String?
    public var destinationEndpoint: CalendarEndpoint
    public var destinationEventID: String
    /// The revision read from the destination provider. Update and delete use
    /// it as an If-Match precondition to avoid overwriting unrelated changes.
    public var expectedProviderRevision: String?
    public var desiredCopy: DesiredCopy?

    public var destinationCalendarID: String { destinationEndpoint.calendarID }
    public var destinationAccountID: String { destinationEndpoint.accountID }

    public init(
        idempotencyKey: String,
        operation: ProviderMutationOperation,
        policyID: String,
        sourceEventID: String,
        sourceOccurrenceID: String? = nil,
        destinationEndpoint: CalendarEndpoint,
        destinationEventID: String,
        expectedProviderRevision: String? = nil,
        desiredCopy: DesiredCopy?
    ) {
        self.idempotencyKey = idempotencyKey
        self.operation = operation
        self.policyID = policyID
        self.sourceEventID = sourceEventID
        self.sourceOccurrenceID = sourceOccurrenceID
        self.destinationEndpoint = destinationEndpoint
        self.destinationEventID = destinationEventID
        self.expectedProviderRevision = expectedProviderRevision
        self.desiredCopy = desiredCopy
    }
}

public struct ProviderMutationResult: Codable, Hashable, Sendable {
    public var destinationEventID: String
    public var providerRevision: String?

    public init(destinationEventID: String, providerRevision: String? = nil) {
        self.destinationEventID = destinationEventID
        self.providerRevision = providerRevision
    }
}

public enum ProviderError: Error, Equatable, Sendable {
    case unauthorized
    case forbidden
    case quotaLimited(retryAfter: Duration?)
    case cursorExpired
    case conflict
    case notFound
    case offline
    case malformedResponse
    case transient
    case ambiguous
    case ownershipMismatch
    case pageLimitExceeded
    case unsupportedProvider
}

public protocol CalendarProvider: Sendable {
    /// Returns exactly one page. The coordinator stages each page before
    /// requesting the next, so a full sync never accumulates all provider data
    /// in memory.
    func fetchChangePage(_ request: ProviderChangeRequest) async throws -> ProviderChangePage
    func readEvent(at endpoint: CalendarEndpoint, eventID: String) async throws -> SourceEvent?
    func apply(_ mutation: ProviderMutation) async throws -> ProviderMutationResult
}

public protocol SyncClock: Sendable {
    func now() -> Date
    func sleep(for duration: Duration) async throws
}

public struct SystemSyncClock: SyncClock {
    public init() {}

    public func now() -> Date { Date() }

    public func sleep(for duration: Duration) async throws {
        try await Task.sleep(for: duration)
    }
}
