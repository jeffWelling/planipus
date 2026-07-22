import CryptoKit
import Foundation
import PlanipusSecrets

public actor GoogleInstalledAppOAuthAuthorizer: GoogleOAuthAuthorizing, GoogleAccessTokenSource,
    GoogleAccountIdentitySource, GoogleCredentialInspecting
{
    public static let identityScopes: Set<String> = ["openid", "email"]
    public static let credentialService = "org.planipus.macos.google-oauth"

    private let configuration: GoogleInstalledAppOAuthConfiguration
    private let browserSession: any SystemWebAuthenticationSession
    private let transport: any HTTPTransport
    private let secretStore: any SecretStore
    private let entropy: any OAuthEntropyGenerating
    private let now: @Sendable () -> Date

    public init(
        configuration: GoogleInstalledAppOAuthConfiguration,
        browserSession: any SystemWebAuthenticationSession,
        transport: any HTTPTransport = URLSessionHTTPTransport(),
        secretStore: any SecretStore,
        entropy: any OAuthEntropyGenerating = SecureOAuthEntropyGenerator(),
        now: @escaping @Sendable () -> Date = Date.init
    ) {
        self.configuration = configuration
        self.browserSession = browserSession
        self.transport = transport
        self.secretStore = secretStore
        self.entropy = entropy
        self.now = now
    }

    public func authorize(scopes: Set<String>) async throws -> GoogleCredential {
        let requestedScopes = scopes
            .union(Self.identityScopes)
            .filter { !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
        let verifier = Self.base64URL(try entropy.randomBytes(count: 64))
        let challenge = Self.base64URL(Data(SHA256.hash(data: Data(verifier.utf8))))
        let state = Self.base64URL(try entropy.randomBytes(count: 32))
        let authorizationURL = try makeAuthorizationURL(
            scopes: requestedScopes,
            state: state,
            challenge: challenge
        )

        let callback = try await browserSession.authenticate(
            using: authorizationURL,
            callbackURLScheme: configuration.callbackURLScheme,
            prefersEphemeralSession: configuration.prefersEphemeralBrowserSession
        )
        let code = try authorizationCode(from: callback, expectedState: state)
        let token = try await exchangeAuthorizationCode(code, verifier: verifier)
        guard let refreshToken = token.refreshToken, !refreshToken.isEmpty else {
            throw GoogleInstalledAppOAuthError.refreshTokenMissing
        }
        let grantedScopes = try validatedScopes(
            token.scope,
            requested: requestedScopes,
            fallback: requestedScopes
        )
        let identity = try await fetchIdentity(accessToken: token.accessToken)
        guard identity.verifiedEmail else {
            throw GoogleInstalledAppOAuthError.unverifiedEmail
        }

        let stored = StoredGoogleOAuthCredential(
            providerSubject: identity.subject,
            email: identity.email,
            refreshToken: refreshToken,
            grantedScopes: grantedScopes.sorted(),
            accessToken: token.accessToken,
            accessTokenExpiresAt: expirationDate(expiresIn: token.expiresIn)
        )
        try await save(stored)

        return GoogleCredential(
            providerSubject: identity.subject,
            email: identity.email,
            refreshToken: Data(refreshToken.utf8),
            grantedScopes: grantedScopes
        )
    }

    public func accessToken(accountID: String) async throws -> String {
        let stored = try await credential(accountID: accountID)
        if let accessToken = stored.accessToken,
           let expiresAt = stored.accessTokenExpiresAt,
           expiresAt.timeIntervalSince(now()) > 60
        {
            return accessToken
        }
        return try await refreshAccessToken(accountID: accountID)
    }

    public func refreshAccessToken(accountID: String) async throws -> String {
        var stored = try await credential(accountID: accountID)
        let token = try await sendTokenRequest([
            "client_id": configuration.clientID,
            "grant_type": "refresh_token",
            "refresh_token": stored.refreshToken,
        ])
        let previousScopes = Set(stored.grantedScopes)
        let grantedScopes = try validatedScopes(
            token.scope,
            requested: previousScopes,
            fallback: previousScopes
        )
        stored.accessToken = token.accessToken
        stored.accessTokenExpiresAt = expirationDate(expiresIn: token.expiresIn)
        stored.grantedScopes = grantedScopes.sorted()
        if let rotatedRefreshToken = token.refreshToken, !rotatedRefreshToken.isEmpty {
            stored.refreshToken = rotatedRefreshToken
        }
        try await save(stored)
        return token.accessToken
    }

    public func identityEmail(accountID: String) async throws -> String? {
        try await optionalCredential(accountID: accountID)?.email
    }

    public func credentialMetadata(accountID: String) async throws -> GoogleCredentialMetadata? {
        guard let stored = try await optionalCredential(accountID: accountID) else { return nil }
        return GoogleCredentialMetadata(
            providerSubject: stored.providerSubject,
            email: stored.email,
            grantedScopes: Set(stored.grantedScopes)
        )
    }

    public func revoke(accountID: String) async throws {
        guard let stored = try await optionalCredential(accountID: accountID) else { return }
        let request = HTTPRequest(
            method: .post,
            url: configuration.revocationEndpoint,
            headers: [
                "Accept": "application/json",
                "Content-Type": "application/x-www-form-urlencoded",
            ],
            body: Self.formBody(["token": stored.refreshToken])
        )
        let response = try await transport.send(request)
        guard (200 ..< 300).contains(response.statusCode) else {
            throw endpointError(response, endpoint: "revocation")
        }
        try await secretStore.delete(Self.secretIdentifier(accountID: accountID))
    }

    public static func secretIdentifier(accountID: String) -> SecretIdentifier {
        SecretIdentifier(service: credentialService, account: accountID)
    }

    private func makeAuthorizationURL(
        scopes: Set<String>,
        state: String,
        challenge: String
    ) throws -> URL {
        guard var components = URLComponents(
            url: configuration.authorizationEndpoint,
            resolvingAgainstBaseURL: false
        ) else {
            throw GoogleInstalledAppOAuthError.invalidConfiguration(
                "Authorization endpoint is not a valid URL"
            )
        }
        var queryItems = components.queryItems ?? []
        queryItems.append(contentsOf: [
            URLQueryItem(name: "access_type", value: "offline"),
            URLQueryItem(name: "client_id", value: configuration.clientID),
            URLQueryItem(name: "code_challenge", value: challenge),
            URLQueryItem(name: "code_challenge_method", value: "S256"),
            URLQueryItem(name: "prompt", value: "consent select_account"),
            URLQueryItem(name: "redirect_uri", value: configuration.redirectURI.absoluteString),
            URLQueryItem(name: "response_type", value: "code"),
            URLQueryItem(name: "scope", value: scopes.sorted().joined(separator: " ")),
            URLQueryItem(name: "state", value: state),
        ])
        components.queryItems = queryItems
        guard let url = components.url else {
            throw GoogleInstalledAppOAuthError.invalidConfiguration(
                "Authorization request could not be constructed"
            )
        }
        return url
    }

    private func authorizationCode(from callback: URL, expectedState: String) throws -> String {
        guard
            let components = URLComponents(url: callback, resolvingAgainstBaseURL: false),
            components.fragment == nil
        else {
            throw GoogleInstalledAppOAuthError.callbackMismatch
        }
        var callbackBase = components
        callbackBase.query = nil
        callbackBase.fragment = nil
        guard callbackBase.url?.absoluteString == configuration.redirectURI.absoluteString else {
            throw GoogleInstalledAppOAuthError.callbackMismatch
        }

        let items = components.queryItems ?? []
        let state = try singleValue(named: "state", in: items)
        guard state == expectedState else {
            throw GoogleInstalledAppOAuthError.stateMismatch
        }
        if let providerError = try singleValue(named: "error", in: items) {
            throw GoogleInstalledAppOAuthError.authorizationDenied(providerError)
        }
        guard let code = try singleValue(named: "code", in: items), !code.isEmpty else {
            throw GoogleInstalledAppOAuthError.authorizationCodeMissing
        }
        return code
    }

    private func singleValue(named name: String, in items: [URLQueryItem]) throws -> String? {
        let matches = items.filter { $0.name == name }
        guard matches.count <= 1 else {
            throw GoogleInstalledAppOAuthError.duplicateCallbackParameter(name)
        }
        return matches.first?.value
    }

    private func exchangeAuthorizationCode(_ code: String, verifier: String) async throws -> TokenResponse {
        try await sendTokenRequest([
            "client_id": configuration.clientID,
            "code": code,
            "code_verifier": verifier,
            "grant_type": "authorization_code",
            "redirect_uri": configuration.redirectURI.absoluteString,
        ])
    }

    private func sendTokenRequest(_ fields: [String: String]) async throws -> TokenResponse {
        let request = HTTPRequest(
            method: .post,
            url: configuration.tokenEndpoint,
            headers: [
                "Accept": "application/json",
                "Content-Type": "application/x-www-form-urlencoded",
            ],
            body: Self.formBody(fields)
        )
        let response = try await transport.send(request)
        guard (200 ..< 300).contains(response.statusCode) else {
            throw endpointError(response, endpoint: "token")
        }
        guard
            let token = try? JSONDecoder().decode(TokenResponse.self, from: response.body),
            !token.accessToken.isEmpty
        else {
            throw GoogleInstalledAppOAuthError.malformedTokenResponse
        }
        return token
    }

    private func fetchIdentity(accessToken: String) async throws -> GoogleUserInfo {
        let request = HTTPRequest(
            method: .get,
            url: configuration.userInfoEndpoint,
            headers: [
                "Accept": "application/json",
                "Authorization": "Bearer \(accessToken)",
            ]
        )
        let response = try await transport.send(request)
        guard (200 ..< 300).contains(response.statusCode) else {
            throw endpointError(response, endpoint: "user-info")
        }
        guard
            let identity = try? JSONDecoder().decode(GoogleUserInfo.self, from: response.body),
            !identity.subject.isEmpty,
            !identity.email.isEmpty
        else {
            throw GoogleInstalledAppOAuthError.malformedUserInfo
        }
        return identity
    }

    private func validatedScopes(
        _ responseScope: String?,
        requested: Set<String>,
        fallback: Set<String>
    ) throws -> Set<String> {
        let granted: Set<String>
        if let responseScope {
            granted = Set(responseScope.split(whereSeparator: \.isWhitespace).map(String.init))
        } else {
            granted = fallback
        }
        let missing = requested.subtracting(granted).sorted()
        guard missing.isEmpty else {
            throw GoogleInstalledAppOAuthError.insufficientScopes(missing)
        }
        return granted
    }

    private func expirationDate(expiresIn: Int?) -> Date? {
        guard let expiresIn, expiresIn > 0 else { return nil }
        return now().addingTimeInterval(TimeInterval(expiresIn))
    }

    private func endpointError(_ response: HTTPResponse, endpoint: String) -> Error {
        let providerError = (try? JSONDecoder().decode(ProviderErrorResponse.self, from: response.body))?
            .error
        return GoogleInstalledAppOAuthError.endpointRejected(
            endpoint: endpoint,
            statusCode: response.statusCode,
            providerError: providerError
        )
    }

    private func credential(accountID: String) async throws -> StoredGoogleOAuthCredential {
        guard let stored = try await optionalCredential(accountID: accountID) else {
            throw GoogleInstalledAppOAuthError.credentialNotFound
        }
        return stored
    }

    private func optionalCredential(accountID: String) async throws -> StoredGoogleOAuthCredential? {
        guard let data = try await secretStore.read(Self.secretIdentifier(accountID: accountID)) else {
            return nil
        }
        guard let stored = try? JSONDecoder().decode(StoredGoogleOAuthCredential.self, from: data) else {
            throw GoogleInstalledAppOAuthError.malformedTokenResponse
        }
        return stored
    }

    private func save(_ credential: StoredGoogleOAuthCredential) async throws {
        let data = try JSONEncoder().encode(credential)
        try await secretStore.save(
            data,
            as: Self.secretIdentifier(accountID: credential.providerSubject)
        )
    }

    private static func formBody(_ fields: [String: String]) -> Data {
        let allowed = CharacterSet.alphanumerics.union(CharacterSet(charactersIn: "-._~"))
        let encoded = fields.keys.sorted().map { key in
            let encodedKey = key.addingPercentEncoding(withAllowedCharacters: allowed)!
            let encodedValue = fields[key]!.addingPercentEncoding(withAllowedCharacters: allowed)!
            return "\(encodedKey)=\(encodedValue)"
        }.joined(separator: "&")
        return Data(encoded.utf8)
    }

    private static func base64URL(_ data: Data) -> String {
        data.base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }
}

private struct TokenResponse: Decodable {
    let accessToken: String
    let expiresIn: Int?
    let refreshToken: String?
    let scope: String?

    enum CodingKeys: String, CodingKey {
        case accessToken = "access_token"
        case expiresIn = "expires_in"
        case refreshToken = "refresh_token"
        case scope
    }
}

private struct GoogleUserInfo: Decodable {
    let subject: String
    let email: String
    let verifiedEmail: Bool

    enum CodingKeys: String, CodingKey {
        case subject = "sub"
        case email
        case verifiedEmail = "verified_email"
    }
}

private struct ProviderErrorResponse: Decodable {
    let error: String?
}

private struct StoredGoogleOAuthCredential: Codable {
    let providerSubject: String
    let email: String
    var refreshToken: String
    var grantedScopes: [String]
    var accessToken: String?
    var accessTokenExpiresAt: Date?
}
