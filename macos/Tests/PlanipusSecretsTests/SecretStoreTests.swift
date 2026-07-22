import Foundation
import PlanipusSecrets
import XCTest

final class SecretStoreTests: XCTestCase {
    func testKeychainPolicyIsDeviceBoundAndNonSynchronizing() {
        let policy = KeychainPolicy.planipus
        XCTAssertTrue(policy.usesDataProtectionKeychain)
        XCTAssertFalse(policy.synchronizable)
        XCTAssertEqual(policy.accessibility, "afterFirstUnlockThisDeviceOnly")
    }

    func testInMemorySecretRoundTripWithoutTouchingUserKeychain() async throws {
        let store = InMemorySecretStore()
        let id = SecretIdentifier(account: "google:personal:refresh-token")
        let secret = Data("not-a-real-token".utf8)
        await store.save(secret, as: id)
        let loaded = await store.read(id)
        XCTAssertEqual(loaded, secret)
        await store.delete(id)
        let deleted = await store.read(id)
        XCTAssertNil(deleted)
    }

    func testDatabaseKeyGeneratorProducesRequestedEntropyLength() throws {
        XCTAssertEqual(try DatabaseKeyGenerator.make(length: 32).count, 32)
    }

    func testDatabaseKeyTextIsAlwaysRedacted() throws {
        let bytes = Data(repeating: 0x5A, count: DatabaseKey.byteCount)
        let key = try DatabaseKey(validating: bytes)

        XCTAssertEqual(key.count, 32)
        XCTAssertEqual(String(describing: key), "<Planipus database key: redacted>")
        XCTAssertEqual(String(reflecting: key), "<Planipus database key: redacted>")
        XCTAssertFalse(String(describing: key).contains(bytes.base64EncodedString()))
    }

    func testDatabaseKeyVaultGeneratesOnlyForANewDatabase() async throws {
        let store = InMemorySecretStore()
        let expected = Data(repeating: 0x33, count: DatabaseKey.byteCount)
        let vault = DatabaseKeyVault(secretStore: store, generator: { expected })

        let generated = try await vault.resolve(databaseExists: false)
        XCTAssertEqual(generated.count, 32)
        let stored = await store.read(.planipusDatabaseKey)
        XCTAssertEqual(stored, expected)

        await store.delete(.planipusDatabaseKey)
        do {
            _ = try await vault.resolve(databaseExists: true)
            XCTFail("A missing key for an existing database must fail closed")
        } catch let error as DatabaseKeyError {
            XCTAssertEqual(error, .missingForExistingDatabase)
        }
        let replacement = await store.read(.planipusDatabaseKey)
        XCTAssertNil(replacement)
    }
}
