import Foundation

public struct GoogleInstalledAppOAuthConfiguration: Sendable, Equatable {
    public static let standardAuthorizationEndpoint = URL(
        string: "https://accounts.google.com/o/oauth2/v2/auth"
    )!
    public static let standardTokenEndpoint = URL(
        string: "https://oauth2.googleapis.com/token"
    )!
    public static let standardRevocationEndpoint = URL(
        string: "https://oauth2.googleapis.com/revoke"
    )!
    public static let standardUserInfoEndpoint = URL(
        string: "https://openidconnect.googleapis.com/v1/userinfo"
    )!

    public let clientID: String
    public let redirectURI: URL
    public let authorizationEndpoint: URL
    public let tokenEndpoint: URL
    public let revocationEndpoint: URL
    public let userInfoEndpoint: URL
    public let prefersEphemeralBrowserSession: Bool

    public var callbackURLScheme: String { redirectURI.scheme! }

    public init(
        clientID: String,
        redirectURI: URL,
        authorizationEndpoint: URL = standardAuthorizationEndpoint,
        tokenEndpoint: URL = standardTokenEndpoint,
        revocationEndpoint: URL = standardRevocationEndpoint,
        userInfoEndpoint: URL = standardUserInfoEndpoint,
        prefersEphemeralBrowserSession: Bool = false
    ) throws {
        let trimmedClientID = clientID.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedClientID.isEmpty, !trimmedClientID.contains("$(") else {
            throw GoogleInstalledAppOAuthError.invalidConfiguration("Google client ID is missing")
        }
        try Self.validateRedirectURI(redirectURI)
        try Self.validateHTTPS(authorizationEndpoint, name: "authorization endpoint")
        try Self.validateHTTPS(tokenEndpoint, name: "token endpoint")
        try Self.validateHTTPS(revocationEndpoint, name: "revocation endpoint")
        try Self.validateHTTPS(userInfoEndpoint, name: "user-info endpoint")

        self.clientID = trimmedClientID
        self.redirectURI = redirectURI
        self.authorizationEndpoint = authorizationEndpoint
        self.tokenEndpoint = tokenEndpoint
        self.revocationEndpoint = revocationEndpoint
        self.userInfoEndpoint = userInfoEndpoint
        self.prefersEphemeralBrowserSession = prefersEphemeralBrowserSession
    }

    private static func validateRedirectURI(_ url: URL) throws {
        guard
            let components = URLComponents(url: url, resolvingAgainstBaseURL: false),
            let scheme = components.scheme,
            !scheme.isEmpty,
            scheme.lowercased() != "http",
            scheme.lowercased() != "https",
            components.user == nil,
            components.password == nil,
            components.port == nil,
            components.query == nil,
            components.fragment == nil,
            url.absoluteString == components.url?.absoluteString
        else {
            throw GoogleInstalledAppOAuthError.invalidConfiguration(
                "Redirect URI must be an exact custom-scheme URL without credentials, port, query, or fragment"
            )
        }
    }

    private static func validateHTTPS(_ url: URL, name: String) throws {
        guard
            let components = URLComponents(url: url, resolvingAgainstBaseURL: false),
            components.scheme == "https",
            components.host != nil,
            components.user == nil,
            components.password == nil,
            components.fragment == nil
        else {
            throw GoogleInstalledAppOAuthError.invalidConfiguration("The \(name) must be HTTPS")
        }
    }
}

public enum GoogleInstalledAppOAuthError: Error, Equatable, Sendable {
    case invalidConfiguration(String)
    case randomGenerationFailed(Int32)
    case browserSessionInProgress
    case browserPresentationUnavailable
    case browserSessionCouldNotStart
    case authorizationCancelled
    case callbackMismatch
    case stateMismatch
    case duplicateCallbackParameter(String)
    case authorizationDenied(String)
    case authorizationCodeMissing
    case endpointRejected(endpoint: String, statusCode: Int, providerError: String?)
    case malformedTokenResponse
    case refreshTokenMissing
    case insufficientScopes([String])
    case malformedUserInfo
    case unverifiedEmail
    case credentialNotFound
}

extension GoogleInstalledAppOAuthError: LocalizedError {
    public var errorDescription: String? {
        switch self {
        case let .invalidConfiguration(reason): reason
        case .randomGenerationFailed: "Secure random generation failed."
        case .browserSessionInProgress: "A Google sign-in is already in progress."
        case .browserPresentationUnavailable: "Planipus could not find a window for Google sign-in."
        case .browserSessionCouldNotStart: "The system browser could not start Google sign-in."
        case .authorizationCancelled: "Google sign-in was cancelled."
        case .callbackMismatch: "Google returned to an unexpected callback address."
        case .stateMismatch: "Google sign-in state validation failed."
        case let .duplicateCallbackParameter(name):
            "Google returned more than one \(name) parameter."
        case let .authorizationDenied(reason): "Google sign-in was not completed: \(reason)"
        case .authorizationCodeMissing: "Google did not return an authorization code."
        case let .endpointRejected(endpoint, status, providerError):
            if let providerError {
                "Google's \(endpoint) request failed (HTTP \(status), \(providerError))."
            } else {
                "Google's \(endpoint) request failed (HTTP \(status))."
            }
        case .malformedTokenResponse: "Google returned an invalid token response."
        case .refreshTokenMissing: "Google did not issue an offline refresh token."
        case let .insufficientScopes(scopes):
            "Google did not grant the required permissions: \(scopes.joined(separator: ", "))."
        case .malformedUserInfo: "Google returned an invalid account identity."
        case .unverifiedEmail: "Google did not confirm this account's email address."
        case .credentialNotFound: "This Google account is not connected on this Mac."
        }
    }
}
