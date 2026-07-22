import Foundation
import PlanipusGoogle
import PlanipusSecrets
import PlanipusTestSupport
import XCTest

private let testCalendarScope = "https://www.googleapis.com/auth/calendar.events"
private let testFixedNow = Date(timeIntervalSince1970: 1_800_000_000)

@MainActor
final class GoogleInstalledAppOAuthTests: XCTestCase {
    func testAuthorizationUsesSystemBrowserPKCEExactRedirectAndDeviceSecretStore() async throws {
        let configuration = try makeConfiguration()
        let browser = callbackBrowser(redirectURI: configuration.redirectURI)
        let transport = ScriptedHTTPTransport(responses: [
            .success(tokenResponse()),
            .success(userInfoResponse()),
        ])
        let secrets = InMemorySecretStore()
        let authorizer = GoogleInstalledAppOAuthAuthorizer(
            configuration: configuration,
            browserSession: browser,
            transport: transport,
            secretStore: secrets,
            entropy: DeterministicEntropy(),
            now: { testFixedNow }
        )

        let credential = try await authorizer.authorize(scopes: [testCalendarScope])

        XCTAssertEqual(credential.providerSubject, "google-subject-1")
        XCTAssertEqual(credential.email, "person@example.com")
        XCTAssertEqual(String(data: credential.refreshToken, encoding: .utf8), "refresh-token-1")
        XCTAssertEqual(
            credential.grantedScopes,
            [testCalendarScope, "email", "openid"]
        )

        let browserRequest = try XCTUnwrap(browser.requests().first)
        XCTAssertEqual(browserRequest.callbackURLScheme, "com.googleusercontent.apps.planipus-test")
        XCTAssertFalse(browserRequest.prefersEphemeralSession)
        let authorizationFields = queryFields(browserRequest.authorizationURL)
        XCTAssertEqual(authorizationFields["client_id"], "planipus-test.apps.googleusercontent.com")
        XCTAssertEqual(authorizationFields["redirect_uri"], configuration.redirectURI.absoluteString)
        XCTAssertEqual(authorizationFields["response_type"], "code")
        XCTAssertEqual(authorizationFields["code_challenge_method"], "S256")
        XCTAssertEqual(authorizationFields["access_type"], "offline")
        XCTAssertEqual(authorizationFields["prompt"], "consent select_account")
        XCTAssertEqual(authorizationFields["state"]?.count, 43)
        XCTAssertEqual(authorizationFields["code_challenge"]?.count, 43)

        let requests = await transport.requests()
        XCTAssertEqual(requests.count, 2)
        let tokenRequest = requests[0]
        XCTAssertEqual(tokenRequest.url, configuration.tokenEndpoint)
        XCTAssertEqual(tokenRequest.headers["Content-Type"], "application/x-www-form-urlencoded")
        let tokenFields = formFields(try XCTUnwrap(tokenRequest.body))
        XCTAssertEqual(tokenFields["code"], "authorization-code")
        XCTAssertEqual(tokenFields["grant_type"], "authorization_code")
        XCTAssertEqual(tokenFields["redirect_uri"], configuration.redirectURI.absoluteString)
        XCTAssertEqual(tokenFields["code_verifier"]?.count, 86)
        XCTAssertNil(tokenFields["client_secret"])
        XCTAssertEqual(requests[1].headers["Authorization"], "Bearer access-token-1")

        let stored = await secrets.read(
            GoogleInstalledAppOAuthAuthorizer.secretIdentifier(accountID: "google-subject-1")
        )
        XCTAssertNotNil(stored)
        let cachedAccessToken = try await authorizer.accessToken(accountID: "google-subject-1")
        let routedIdentity = try await authorizer.identityEmail(accountID: "google-subject-1")
        let metadata = try await authorizer.credentialMetadata(accountID: "google-subject-1")
        XCTAssertEqual(
            cachedAccessToken,
            "access-token-1",
            "A non-expired access token should be read from the device secret without a network call"
        )
        XCTAssertEqual(routedIdentity, "person@example.com")
        XCTAssertEqual(
            metadata,
            GoogleCredentialMetadata(
                providerSubject: "google-subject-1",
                email: "person@example.com",
                grantedScopes: [testCalendarScope, "email", "openid"]
            )
        )
        let finalRequests = await transport.requests()
        XCTAssertEqual(finalRequests.count, 2)
    }

    func testRefreshReadsPersistedCredentialAndPersistsRotatedToken() async throws {
        let configuration = try makeConfiguration()
        let secrets = InMemorySecretStore()
        let initialTransport = ScriptedHTTPTransport(responses: [
            .success(tokenResponse()),
            .success(userInfoResponse()),
        ])
        let initial = GoogleInstalledAppOAuthAuthorizer(
            configuration: configuration,
            browserSession: callbackBrowser(redirectURI: configuration.redirectURI),
            transport: initialTransport,
            secretStore: secrets,
            entropy: DeterministicEntropy(),
            now: { testFixedNow }
        )
        _ = try await initial.authorize(scopes: [testCalendarScope])

        let refreshTransport = ScriptedHTTPTransport(responses: [
            .success(tokenResponse(
                accessToken: "access-token-2",
                refreshToken: "refresh-token-2"
            )),
            .success(HTTPResponse(statusCode: 200)),
        ])
        let restored = GoogleInstalledAppOAuthAuthorizer(
            configuration: configuration,
            browserSession: unusedBrowser(),
            transport: refreshTransport,
            secretStore: secrets,
            entropy: DeterministicEntropy(),
            now: { testFixedNow.addingTimeInterval(7_200) }
        )

        let refreshedAccessToken = try await restored.refreshAccessToken(
            accountID: "google-subject-1"
        )
        XCTAssertEqual(
            refreshedAccessToken,
            "access-token-2"
        )
        var requests = await refreshTransport.requests()
        XCTAssertEqual(requests.count, 1)
        var fields = formFields(try XCTUnwrap(requests[0].body))
        XCTAssertEqual(fields["grant_type"], "refresh_token")
        XCTAssertEqual(fields["refresh_token"], "refresh-token-1")
        XCTAssertNil(fields["client_secret"])

        try await restored.revoke(accountID: "google-subject-1")
        requests = await refreshTransport.requests()
        XCTAssertEqual(requests.count, 2)
        fields = formFields(try XCTUnwrap(requests[1].body))
        XCTAssertEqual(fields["token"], "refresh-token-2")
        let deletedSecret = await secrets.read(
            GoogleInstalledAppOAuthAuthorizer.secretIdentifier(accountID: "google-subject-1")
        )
        XCTAssertNil(deletedSecret)

        try await restored.revoke(accountID: "google-subject-1")
        let finalRefreshRequests = await refreshTransport.requests()
        XCTAssertEqual(finalRefreshRequests.count, 2)
    }

    func testMismatchedStateStopsBeforeTokenExchange() async throws {
        let configuration = try makeConfiguration()
        let browser = ScriptedWebAuthenticationSession { _ in
            URL(string: "com.googleusercontent.apps.planipus-test:/oauthredirect?code=a&state=wrong")!
        }
        let transport = ScriptedHTTPTransport(responses: [])
        let authorizer = makeAuthorizer(
            configuration: configuration,
            browser: browser,
            transport: transport,
            secrets: InMemorySecretStore()
        )

        await XCTAssertThrowsErrorAsync(
            try await authorizer.authorize(scopes: [testCalendarScope])
        ) { error in
            XCTAssertEqual(error as? GoogleInstalledAppOAuthError, .stateMismatch)
        }
        let requests = await transport.requests()
        XCTAssertTrue(requests.isEmpty)
    }

    func testCallbackMustMatchConfiguredRedirectPathExactly() async throws {
        let configuration = try makeConfiguration()
        let browser = ScriptedWebAuthenticationSession { request in
            let state = self.queryFields(request.authorizationURL)["state"]!
            return URL(
                string: "com.googleusercontent.apps.planipus-test:/different?code=a&state=\(state)"
            )!
        }
        let transport = ScriptedHTTPTransport(responses: [])
        let authorizer = makeAuthorizer(
            configuration: configuration,
            browser: browser,
            transport: transport,
            secrets: InMemorySecretStore()
        )

        await XCTAssertThrowsErrorAsync(
            try await authorizer.authorize(scopes: [testCalendarScope])
        ) { error in
            XCTAssertEqual(error as? GoogleInstalledAppOAuthError, .callbackMismatch)
        }
        let requests = await transport.requests()
        XCTAssertTrue(requests.isEmpty)
    }

    func testProviderDenialIsReportedOnlyAfterStateValidation() async throws {
        let configuration = try makeConfiguration()
        let browser = ScriptedWebAuthenticationSession { request in
            let state = self.queryFields(request.authorizationURL)["state"]!
            return URL(
                string: "com.googleusercontent.apps.planipus-test:/oauthredirect?error=access_denied&state=\(state)"
            )!
        }
        let authorizer = makeAuthorizer(
            configuration: configuration,
            browser: browser,
            transport: ScriptedHTTPTransport(responses: []),
            secrets: InMemorySecretStore()
        )

        await XCTAssertThrowsErrorAsync(
            try await authorizer.authorize(scopes: [testCalendarScope])
        ) { error in
            XCTAssertEqual(
                error as? GoogleInstalledAppOAuthError,
                .authorizationDenied("access_denied")
            )
        }
    }

    func testMissingRefreshTokenFailsWithoutPersistingAccount() async throws {
        let configuration = try makeConfiguration()
        let secrets = InMemorySecretStore()
        let transport = ScriptedHTTPTransport(responses: [
            .success(tokenResponse(refreshToken: nil)),
        ])
        let authorizer = makeAuthorizer(
            configuration: configuration,
            browser: callbackBrowser(redirectURI: configuration.redirectURI),
            transport: transport,
            secrets: secrets
        )

        await XCTAssertThrowsErrorAsync(
            try await authorizer.authorize(scopes: [testCalendarScope])
        ) { error in
            XCTAssertEqual(error as? GoogleInstalledAppOAuthError, .refreshTokenMissing)
        }
        let absentSecret = await secrets.read(
            GoogleInstalledAppOAuthAuthorizer.secretIdentifier(accountID: "google-subject-1")
        )
        XCTAssertNil(absentSecret)
        let requests = await transport.requests()
        XCTAssertEqual(requests.count, 1)
    }

    func testConfigurationRejectsWebCallbacksAndUnexpandedClientPlaceholder() throws {
        XCTAssertThrowsError(
            try GoogleInstalledAppOAuthConfiguration(
                clientID: "real-client",
                redirectURI: URL(string: "https://localhost/oauthredirect")!
            )
        )
        XCTAssertThrowsError(
            try GoogleInstalledAppOAuthConfiguration(
                clientID: "$(PLANIPUS_GOOGLE_CLIENT_ID)",
                redirectURI: URL(string: "planipus:/oauthredirect")!
            )
        )
    }

    func testUnconfiguredAuthorizerFailsClosed() async {
        let gated = GatedGoogleOAuthAuthorizer()
        do {
            _ = try await gated.authorize(scopes: [testCalendarScope])
            XCTFail("An unconfigured build must never start OAuth")
        } catch {
            XCTAssertEqual(error as? GoogleOAuthGateError, .configurationMissing)
        }
    }

    private func makeConfiguration() throws -> GoogleInstalledAppOAuthConfiguration {
        try GoogleInstalledAppOAuthConfiguration(
            clientID: "planipus-test.apps.googleusercontent.com",
            redirectURI: URL(
                string: "com.googleusercontent.apps.planipus-test:/oauthredirect"
            )!,
            authorizationEndpoint: URL(string: "https://accounts.test/authorize")!,
            tokenEndpoint: URL(string: "https://accounts.test/token")!,
            revocationEndpoint: URL(string: "https://accounts.test/revoke")!,
            userInfoEndpoint: URL(string: "https://accounts.test/userinfo")!
        )
    }

    private func makeAuthorizer(
        configuration: GoogleInstalledAppOAuthConfiguration,
        browser: ScriptedWebAuthenticationSession,
        transport: ScriptedHTTPTransport,
        secrets: InMemorySecretStore
    ) -> GoogleInstalledAppOAuthAuthorizer {
        GoogleInstalledAppOAuthAuthorizer(
            configuration: configuration,
            browserSession: browser,
            transport: transport,
            secretStore: secrets,
            entropy: DeterministicEntropy(),
            now: { testFixedNow }
        )
    }

    private func callbackBrowser(redirectURI: URL) -> ScriptedWebAuthenticationSession {
        ScriptedWebAuthenticationSession { request in
            let state = self.queryFields(request.authorizationURL)["state"]!
            return URL(string: "\(redirectURI.absoluteString)?code=authorization-code&state=\(state)")!
        }
    }

    private func unusedBrowser() -> ScriptedWebAuthenticationSession {
        ScriptedWebAuthenticationSession { _ in
            throw UnusedBrowserError.unexpectedInvocation
        }
    }

    private func tokenResponse(
        accessToken: String = "access-token-1",
        refreshToken: String? = "refresh-token-1"
    ) -> HTTPResponse {
        var object: [String: Any] = [
            "access_token": accessToken,
            "expires_in": 3_600,
            "scope": "email openid \(testCalendarScope)",
            "token_type": "Bearer",
        ]
        object["refresh_token"] = refreshToken
        return HTTPResponse(
            statusCode: 200,
            body: try! JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])
        )
    }

    private func userInfoResponse() -> HTTPResponse {
        HTTPResponse(
            statusCode: 200,
            body: Data(
                #"{"sub":"google-subject-1","email":"person@example.com","verified_email":true}"#.utf8
            )
        )
    }

    private func queryFields(_ url: URL) -> [String: String] {
        Dictionary(
            uniqueKeysWithValues: (URLComponents(url: url, resolvingAgainstBaseURL: false)?
                .queryItems ?? []).compactMap { item in
                    item.value.map { (item.name, $0) }
                }
        )
    }

    private func formFields(_ data: Data) -> [String: String] {
        let body = String(decoding: data, as: UTF8.self)
        return Dictionary(uniqueKeysWithValues: body.split(separator: "&").map { field in
            let parts = field.split(separator: "=", maxSplits: 1, omittingEmptySubsequences: false)
            return (
                String(parts[0]).removingPercentEncoding!,
                String(parts[1]).removingPercentEncoding!
            )
        })
    }
}

private struct DeterministicEntropy: OAuthEntropyGenerating {
    func randomBytes(count: Int) -> Data {
        Data(repeating: count == 64 ? 0xA5 : 0x5A, count: count)
    }
}

private enum UnusedBrowserError: Error {
    case unexpectedInvocation
}

@MainActor
private func XCTAssertThrowsErrorAsync<T: Sendable>(
    _ expression: @autoclosure () async throws -> T,
    _ errorHandler: (any Error) -> Void = { _ in },
    file: StaticString = #filePath,
    line: UInt = #line
) async {
    do {
        _ = try await expression()
        XCTFail("Expected an error to be thrown", file: file, line: line)
    } catch {
        errorHandler(error)
    }
}
