import Foundation
import Security

public struct SecretIdentifier: Hashable, Sendable {
    public let service: String
    public let account: String

    public init(service: String = "org.planipus.macos", account: String) {
        self.service = service
        self.account = account
    }

    /// The versioned device-local encryption key for the native database.
    ///
    /// Versioning the identifier makes a future, explicitly designed key
    /// migration possible without ever guessing which bytes encrypted an
    /// existing database.
    public static let planipusDatabaseKey = SecretIdentifier(
        service: "org.planipus.macos.database",
        account: "sqlcipher-key-v1"
    )
}

public protocol SecretStore: Sendable {
    func read(_ identifier: SecretIdentifier) async throws -> Data?
    func save(_ data: Data, as identifier: SecretIdentifier) async throws
    func delete(_ identifier: SecretIdentifier) async throws
}

public actor InMemorySecretStore: SecretStore {
    private var values: [SecretIdentifier: Data] = [:]

    public init() {}

    public func read(_ identifier: SecretIdentifier) -> Data? { values[identifier] }
    public func save(_ data: Data, as identifier: SecretIdentifier) { values[identifier] = data }
    public func delete(_ identifier: SecretIdentifier) { values.removeValue(forKey: identifier) }
}

public struct KeychainPolicy: Equatable, Sendable {
    public let usesDataProtectionKeychain: Bool
    public let synchronizable: Bool
    public let accessibility: String

    public init(
        usesDataProtectionKeychain: Bool = true,
        synchronizable: Bool = false,
        accessibility: String = "afterFirstUnlockThisDeviceOnly"
    ) {
        self.usesDataProtectionKeychain = usesDataProtectionKeychain
        self.synchronizable = synchronizable
        self.accessibility = accessibility
    }

    public static let planipus = KeychainPolicy()
}

public enum SecretStoreError: Error, Equatable, Sendable {
    case keychainStatus(OSStatus)
    case randomGenerationFailed(OSStatus)

    /// The underlying Security framework result, preserved so callers and
    /// diagnostics can distinguish a missing entitlement from an absent item.
    public var status: OSStatus {
        switch self {
        case let .keychainStatus(status), let .randomGenerationFailed(status):
            return status
        }
    }
}

/// Surfaces the `OSStatus` rather than the enum's case index.
///
/// Without these conformances Foundation bridges the enum using its
/// discriminant, so every keychain failure reaches the user as
/// `SecretStoreError error 0` and a missing entitlement is indistinguishable
/// from a corrupt item. The status is the whole diagnostic; it must survive.
extension SecretStoreError: CustomNSError, LocalizedError {
    public static var errorDomain: String { "org.planipus.macos.SecretStore" }

    public var errorCode: Int { Int(status) }

    public var errorUserInfo: [String: Any] {
        [NSLocalizedDescriptionKey: errorDescription ?? explanation]
    }

    public var errorDescription: String? { explanation }

    private var explanation: String {
        let system = SecCopyErrorMessageString(status, nil) as String?
        let detail = system.map { "\($0) (OSStatus \(status))" } ?? "OSStatus \(status)"

        switch self {
        case .keychainStatus:
            return "\(keychainAdvice)\(detail)."
        case .randomGenerationFailed:
            return "The system random number generator failed: \(detail)."
        }
    }

    private var keychainAdvice: String {
        switch status {
        case errSecMissingEntitlement:
            // Reached whenever the process is not a signed bundle carrying a
            // keychain-access-groups entitlement, because the data-protection
            // keychain scopes items by team-prefixed access group.
            return "Planipus is running as an unbundled or unsigned executable, so macOS "
                + "will not grant it access to the data protection keychain. Run a signed "
                + "application bundle instead. Underlying error: "
        case errSecInteractionNotAllowed:
            return "The keychain is locked. Unlock this Mac and try again. Underlying error: "
        case errSecUserCanceled:
            return "The keychain request was cancelled. Underlying error: "
        default:
            return "The keychain request failed: "
        }
    }
}

/// Opaque SQLCipher key material. Its textual representations are always
/// redacted so diagnostics and assertion failures cannot print the key.
public struct DatabaseKey: Sendable, CustomStringConvertible, CustomDebugStringConvertible {
    public static let byteCount = 32

    private let bytes: Data

    public init(validating bytes: Data) throws {
        guard bytes.count == Self.byteCount else {
            throw DatabaseKeyError.invalidLength(actual: bytes.count)
        }
        self.bytes = bytes
    }

    public var count: Int { bytes.count }
    public var description: String { "<Planipus database key: redacted>" }
    public var debugDescription: String { description }

    /// Supplies the bytes only to the encryption boundary. The key is not
    /// Codable and has no public byte property by design.
    public func withUnsafeData<Result>(
        _ body: (Data) throws -> Result
    ) rethrows -> Result {
        try body(bytes)
    }
}

public enum DatabaseKeyError: Error, Equatable, Sendable {
    /// An existing database must never be paired with a newly generated key.
    case missingForExistingDatabase
    case invalidLength(actual: Int)
}

/// Resolves the database key without conflating first launch and key loss.
/// A missing key is generated only when the database file does not yet exist.
public struct DatabaseKeyVault: Sendable {
    public typealias Generator = @Sendable () throws -> Data

    private let secretStore: any SecretStore
    private let identifier: SecretIdentifier
    private let generator: Generator

    public init(
        secretStore: any SecretStore,
        identifier: SecretIdentifier = .planipusDatabaseKey,
        generator: @escaping Generator = { try DatabaseKeyGenerator.make() }
    ) {
        self.secretStore = secretStore
        self.identifier = identifier
        self.generator = generator
    }

    public func resolve(databaseExists: Bool) async throws -> DatabaseKey {
        if let stored = try await secretStore.read(identifier) {
            return try DatabaseKey(validating: stored)
        }
        guard !databaseExists else {
            throw DatabaseKeyError.missingForExistingDatabase
        }

        let generated = try generator()
        let key = try DatabaseKey(validating: generated)
        try await secretStore.save(generated, as: identifier)
        return key
    }
}
