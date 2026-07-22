import Foundation

public struct GoogleCredential: Sendable, Equatable {
    public var providerSubject: String
    public var email: String
    public var refreshToken: Data
    public var grantedScopes: Set<String>

    public init(
        providerSubject: String,
        email: String,
        refreshToken: Data,
        grantedScopes: Set<String>
    ) {
        self.providerSubject = providerSubject
        self.email = email
        self.refreshToken = refreshToken
        self.grantedScopes = grantedScopes
    }
}

public protocol GoogleOAuthAuthorizing: Sendable {
    func authorize(scopes: Set<String>) async throws -> GoogleCredential
    func refreshAccessToken(accountID: String) async throws -> String
    func revoke(accountID: String) async throws
}

public struct GoogleCredentialMetadata: Sendable, Equatable {
    public let providerSubject: String
    public let email: String
    public let grantedScopes: Set<String>

    public init(providerSubject: String, email: String, grantedScopes: Set<String>) {
        self.providerSubject = providerSubject
        self.email = email
        self.grantedScopes = grantedScopes
    }
}

/// Read-only inspection of device credentials. It deliberately exposes no
/// access token or refresh token.
public protocol GoogleCredentialInspecting: Sendable {
    func credentialMetadata(accountID: String) async throws -> GoogleCredentialMetadata?
}

public protocol GoogleAccessTokenSource: Sendable {
    func accessToken(accountID: String) async throws -> String
}

public protocol GoogleAccountIdentitySource: Sendable {
    func identityEmail(accountID: String) async throws -> String?
}

public enum GoogleOAuthGateError: Error, Equatable, Sendable {
    case configurationMissing
}

/// Explicit fail-closed implementation for previews and unconfigured builds.
/// Production app composition replaces this value only after a valid installed-
/// app client ID and exact custom redirect URI have been supplied.
public actor GatedGoogleOAuthAuthorizer: GoogleOAuthAuthorizing, GoogleAccessTokenSource,
    GoogleAccountIdentitySource
{
    public init() {}

    public func authorize(scopes: Set<String>) async throws -> GoogleCredential {
        _ = scopes
        throw GoogleOAuthGateError.configurationMissing
    }

    public func refreshAccessToken(accountID: String) async throws -> String {
        _ = accountID
        throw GoogleOAuthGateError.configurationMissing
    }

    public func accessToken(accountID: String) async throws -> String {
        try await refreshAccessToken(accountID: accountID)
    }

    public func identityEmail(accountID: String) async throws -> String? {
        _ = accountID
        throw GoogleOAuthGateError.configurationMissing
    }

    public func revoke(accountID: String) async throws {
        _ = accountID
        throw GoogleOAuthGateError.configurationMissing
    }
}
