import Foundation
import Security

/// Device-bound secret storage. Items are never synchronised through iCloud Keychain.
public actor KeychainSecretStore: SecretStore {
    public let accessGroup: String?
    public let policy = KeychainPolicy.planipus

    public init(accessGroup: String? = nil) {
        self.accessGroup = accessGroup
    }

    public func read(_ identifier: SecretIdentifier) throws -> Data? {
        var query = baseQuery(identifier)
        query[kSecReturnData] = true
        query[kSecMatchLimit] = kSecMatchLimitOne

        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess else { throw SecretStoreError.keychainStatus(status) }
        return result as? Data
    }

    public func save(_ data: Data, as identifier: SecretIdentifier) throws {
        let query = baseQuery(identifier)
        let update: [CFString: Any] = [
            kSecValueData: data,
            kSecAttrAccessible: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
        ]
        let updateStatus = SecItemUpdate(query as CFDictionary, update as CFDictionary)
        if updateStatus == errSecSuccess { return }
        guard updateStatus == errSecItemNotFound else {
            throw SecretStoreError.keychainStatus(updateStatus)
        }

        var insertion = query
        insertion[kSecValueData] = data
        insertion[kSecAttrAccessible] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        let addStatus = SecItemAdd(insertion as CFDictionary, nil)
        guard addStatus == errSecSuccess else { throw SecretStoreError.keychainStatus(addStatus) }
    }

    public func delete(_ identifier: SecretIdentifier) throws {
        let status = SecItemDelete(baseQuery(identifier) as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else {
            throw SecretStoreError.keychainStatus(status)
        }
    }

    private func baseQuery(_ identifier: SecretIdentifier) -> [CFString: Any] {
        var query: [CFString: Any] = [
            kSecClass: kSecClassGenericPassword,
            kSecAttrService: identifier.service,
            kSecAttrAccount: identifier.account,
            kSecUseDataProtectionKeychain: true,
            kSecAttrSynchronizable: false,
        ]
        if let accessGroup {
            query[kSecAttrAccessGroup] = accessGroup
        }
        return query
    }
}

public enum DatabaseKeyGenerator {
    public static func make(length: Int = 32) throws -> Data {
        precondition(length > 0)
        var bytes = [UInt8](repeating: 0, count: length)
        let status = SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes)
        guard status == errSecSuccess else {
            throw SecretStoreError.randomGenerationFailed(status)
        }
        return Data(bytes)
    }
}
