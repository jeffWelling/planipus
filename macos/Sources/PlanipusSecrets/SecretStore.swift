import Foundation

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
    case keychainStatus(Int32)
    case randomGenerationFailed(Int32)
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
