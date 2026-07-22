import Foundation
import Security

public protocol OAuthEntropyGenerating: Sendable {
    func randomBytes(count: Int) throws -> Data
}

public struct SecureOAuthEntropyGenerator: OAuthEntropyGenerating {
    public init() {}

    public func randomBytes(count: Int) throws -> Data {
        precondition(count > 0)
        var bytes = [UInt8](repeating: 0, count: count)
        let status = SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes)
        guard status == errSecSuccess else {
            throw GoogleInstalledAppOAuthError.randomGenerationFailed(status)
        }
        return Data(bytes)
    }
}
