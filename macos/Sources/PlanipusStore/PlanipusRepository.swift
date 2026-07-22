import Foundation
import PlanipusCore

public struct ChangeBatchHandle: Hashable, Sendable {
    public let id: UUID
    public let endpoint: CalendarEndpoint
    public let mode: ChangeBatchMode

    public init(
        id: UUID = UUID(),
        endpoint: CalendarEndpoint,
        mode: ChangeBatchMode
    ) {
        self.id = id
        self.endpoint = endpoint
        self.mode = mode
    }
}

public enum ChangeBatchMode: Hashable, Sendable {
    case incremental
    case full(start: Date, end: Date)
}

public struct ProjectionKey: Codable, Hashable, Sendable {
    public let policyID: String
    public let sourceEventID: String
    public let sourceOccurrenceID: String?

    public init(policyID: String, sourceEventID: String, sourceOccurrenceID: String?) {
        self.policyID = policyID
        self.sourceEventID = sourceEventID
        self.sourceOccurrenceID = sourceOccurrenceID
    }
}

public struct StoredProjection: Codable, Hashable, Sendable {
    public let key: ProjectionKey
    public var destinationEndpoint: CalendarEndpoint
    public var destinationEventID: String
    public var desiredFingerprint: String
    public var providerRevision: String?
    public var updatedAt: Date

    public var destinationCalendarID: String { destinationEndpoint.calendarID }
    public var destinationAccountID: String { destinationEndpoint.accountID }

    public init(
        key: ProjectionKey,
        destinationEndpoint: CalendarEndpoint,
        destinationEventID: String,
        desiredFingerprint: String,
        providerRevision: String? = nil,
        updatedAt: Date
    ) {
        self.key = key
        self.destinationEndpoint = destinationEndpoint
        self.destinationEventID = destinationEventID
        self.desiredFingerprint = desiredFingerprint
        self.providerRevision = providerRevision
        self.updatedAt = updatedAt
    }
}

public enum OutboxState: String, Codable, Sendable {
    case pending
    case applying
    case ambiguous
    /// A provider object occupied the deterministic destination ID without the
    /// complete Planipus ownership markers. This is terminal until an explicit
    /// operator recovery flow decides it is safe to retry; automatic polling
    /// must never overwrite the foreign object or let this effect starve others.
    case quarantined
    case succeeded
}

public struct OutboxEffect: Codable, Hashable, Sendable, Identifiable {
    public let id: UUID
    public let idempotencyKey: String
    public let projectionKey: ProjectionKey
    public var mutation: ProviderMutation
    public var state: OutboxState
    public var attemptCount: Int
    public var nextAttemptAt: Date
    public var lastError: String?
    public let createdAt: Date

    public init(
        id: UUID = UUID(),
        idempotencyKey: String,
        projectionKey: ProjectionKey,
        mutation: ProviderMutation,
        state: OutboxState = .pending,
        attemptCount: Int = 0,
        nextAttemptAt: Date,
        lastError: String? = nil,
        createdAt: Date
    ) {
        self.id = id
        self.idempotencyKey = idempotencyKey
        self.projectionKey = projectionKey
        self.mutation = mutation
        self.state = state
        self.attemptCount = attemptCount
        self.nextAttemptAt = nextAttemptAt
        self.lastError = lastError
        self.createdAt = createdAt
    }
}

/// Non-secret account metadata required to rebuild the native UI after a
/// relaunch. OAuth tokens remain exclusively in Keychain.
public struct StoredNativeAccount: Codable, Hashable, Sendable, Identifiable {
    public let id: String
    public var email: String
    public var role: String
    public var colorName: String
    /// Non-secret capability evidence returned by Google at consent time.
    /// Tokens remain exclusively in Keychain. This list is used to fail closed
    /// before scheduling a bridge whose account lacks its required scope.
    public var grantedScopes: [String]

    public init(
        id: String,
        email: String,
        role: String,
        colorName: String,
        grantedScopes: [String] = []
    ) {
        self.id = id
        self.email = email
        self.role = role
        self.colorName = colorName
        self.grantedScopes = Array(Set(grantedScopes)).sorted()
    }

    private enum CodingKeys: String, CodingKey {
        case id, email, role, colorName, grantedScopes
    }

    public init(from decoder: any Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(String.self, forKey: .id)
        email = try container.decode(String.self, forKey: .email)
        role = try container.decode(String.self, forKey: .role)
        colorName = try container.decode(String.self, forKey: .colorName)
        grantedScopes = Array(Set(
            try container.decodeIfPresent([String].self, forKey: .grantedScopes) ?? []
        )).sorted()
    }
}

/// Durable presentation metadata paired with the complete executable policy.
/// Keeping the policy whole prevents a relaunch from silently reverting
/// privacy, hours, or explicit source/destination account identities.
public struct StoredNativeBridge: Codable, Hashable, Sendable, Identifiable {
    public let id: String
    public var sourceEmail: String
    public var destinationEmail: String
    public var hoursSummary: String
    public var policy: SyncPolicy
    public var lastRun: Date?

    public init(
        id: String,
        sourceEmail: String,
        destinationEmail: String,
        hoursSummary: String,
        policy: SyncPolicy,
        lastRun: Date? = nil
    ) {
        self.id = id
        self.sourceEmail = sourceEmail
        self.destinationEmail = destinationEmail
        self.hoursSummary = hoursSummary
        self.policy = policy
        self.lastRun = lastRun
    }
}

public struct NativeAppConfiguration: Codable, Hashable, Sendable {
    /// Stable input to deterministic managed-copy IDs. It must survive every
    /// relaunch for as long as this local database is in use.
    public var installationID: String
    public var accounts: [StoredNativeAccount]
    public var bridges: [StoredNativeBridge]

    public init(
        installationID: String,
        accounts: [StoredNativeAccount] = [],
        bridges: [StoredNativeBridge] = []
    ) {
        self.installationID = installationID
        self.accounts = accounts
        self.bridges = bridges
    }
}

/// Persistence boundary shared by the native SQLCipher store and compileable
/// test store. Both implementations preserve the same cursor/batch/outbox
/// transaction semantics; only the encrypted implementation may be composed
/// into the production app.
public protocol PlanipusRepository: Sendable {
    func loadAppConfiguration() async throws -> NativeAppConfiguration?
    func saveAppConfiguration(_ configuration: NativeAppConfiguration) async throws

    func syncToken(for endpoint: CalendarEndpoint) async throws -> String?
    func clearSyncToken(for endpoint: CalendarEndpoint) async throws
    func beginChangeBatch(
        endpoint: CalendarEndpoint,
        mode: ChangeBatchMode
    ) async throws -> ChangeBatchHandle
    func stage(_ events: [SourceEvent], in batch: ChangeBatchHandle) async throws
    @discardableResult
    func commit(_ batch: ChangeBatchHandle, nextSyncToken: String?) async throws -> [SourceEvent]
    func abandon(_ batch: ChangeBatchHandle) async
    func observations(at endpoint: CalendarEndpoint) async throws -> [SourceEvent]

    func projection(for key: ProjectionKey) async throws -> StoredProjection?
    func saveProjection(_ projection: StoredProjection) async throws
    func deleteProjection(for key: ProjectionKey) async throws

    @discardableResult
    func enqueue(_ effect: OutboxEffect) async throws -> Bool
    func dueEffects(at date: Date, limit: Int) async throws -> [OutboxEffect]
    func markApplying(id: UUID) async throws
    func markSucceeded(id: UUID) async throws
    func markAmbiguous(id: UUID, error: String) async throws
    func markQuarantined(id: UUID, error: String) async throws
    func hasQuarantinedEffects() async throws -> Bool
    func scheduleRetry(id: UUID, at date: Date, error: String) async throws
    func reviseEffect(
        id: UUID,
        mutation: ProviderMutation,
        at date: Date,
        error: String
    ) async throws
}

public enum RepositoryError: Error, Equatable, Sendable {
    case unknownBatch
    case mismatchedCalendar
    case unknownEffect
    case productionPersistenceUnavailable
}
