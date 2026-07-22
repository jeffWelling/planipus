import Foundation
import PlanipusCore
import PlanipusGoogle
import PlanipusTestSupport
import XCTest

final class GoogleAdapterTests: XCTestCase {
    func testDeterministicIDIsStableAndGoogleSafe() {
        let first = GoogleEventID.deterministic(
            installationID: "install-a",
            policyID: "policy-a",
            sourceCalendarID: "person@example.com",
            sourceEventID: "event/with punctuation",
            occurrenceID: nil
        )
        let second = GoogleEventID.deterministic(
            installationID: "install-a",
            policyID: "policy-a",
            sourceCalendarID: "person@example.com",
            sourceEventID: "event/with punctuation",
            occurrenceID: nil
        )

        XCTAssertEqual(first, second)
        XCTAssertEqual(first.count, 53)
        XCTAssertNotNil(first.range(of: #"^p[0-9a-v]{52}$"#, options: .regularExpression))
    }

    func testCreateUsesNoInvitationsNoRemindersAndManagedMarker() async throws {
        let response = HTTPResponse(
            statusCode: 200,
            body: Data(#"{"id":"destination-id","etag":"revision-1"}"#.utf8)
        )
        let transport = ScriptedHTTPTransport(responses: [.success(response)])
        let provider = GoogleCalendarProvider(
            tokenSource: StaticTokenSource(),
            transport: transport,
            baseURL: URL(string: "https://calendar.test/v3")!
        )
        let desired = DesiredCopy(
            summary: "Busy",
            start: Date(timeIntervalSince1970: 1_700_000_000),
            end: Date(timeIntervalSince1970: 1_700_003_600),
            isAllDay: false,
            description: nil,
            location: nil,
            conferenceURL: nil,
            visibility: .private,
            transparency: .opaque,
            disclosure: ["time.start", "time.end"]
        )
        let mutation = ProviderMutation(
            idempotencyKey: "key",
            operation: .create,
            policyID: "policy",
            sourceEventID: "source",
            destinationEndpoint: CalendarEndpoint(
                accountID: "work-account",
                calendarID: "work@example.com"
            ),
            destinationEventID: "destination-id",
            desiredCopy: desired
        )

        _ = try await provider.apply(mutation)
        let requests = await transport.requests()
        let request = try XCTUnwrap(requests.first)
        XCTAssertEqual(request.method, .post)
        XCTAssertTrue(request.url.absoluteString.contains("sendUpdates=none"))
        XCTAssertEqual(request.headers["Authorization"], "Bearer token-work-account")
        let body = try XCTUnwrap(request.body)
        let object = try XCTUnwrap(JSONSerialization.jsonObject(with: body) as? [String: Any])
        let reminders = try XCTUnwrap(object["reminders"] as? [String: Any])
        XCTAssertEqual(reminders["useDefault"] as? Bool, false)
        let properties = try XCTUnwrap(object["extendedProperties"] as? [String: Any])
        let privateValues = try XCTUnwrap(properties["private"] as? [String: String])
        XCTAssertEqual(privateValues["planipus_managed"], "1")
        XCTAssertNil(object["attendees"])
    }

    func testFetchNormalizesSelfRSVPAttendeesAndConferenceWithoutCredentials() async throws {
        let body = Data(
            #"{"items":[{"id":"source","etag":"r1","summary":"Meeting","start":{"dateTime":"2026-07-20T17:00:00Z"},"end":{"dateTime":"2026-07-20T18:00:00Z"},"attendees":[{"email":"personal@example.com","responseStatus":"declined","self":true},{"email":"work@example.com","responseStatus":"accepted"}],"organizer":{"email":"organizer@example.com"},"hangoutLink":"https://meet.google.com/example"}],"nextSyncToken":"cursor-2"}"#.utf8
        )
        let transport = ScriptedHTTPTransport(
            responses: [.success(HTTPResponse(statusCode: 200, body: body))]
        )
        let provider = GoogleCalendarProvider(
            tokenSource: StaticTokenSource(),
            identitySource: StaticIdentitySource(emails: [
                "personal-account": "personal@example.com",
            ]),
            transport: transport,
            baseURL: URL(string: "https://calendar.test/v3")!
        )

        let endpoint = CalendarEndpoint(accountID: "personal-account", calendarID: "personal")
        let page = try await provider.fetchChangePage(
            ProviderChangeRequest(endpoint: endpoint, syncToken: "cursor-1")
        )
        let event = try XCTUnwrap(page.events.first)
        XCTAssertEqual(event.rsvpStatus, .declined)
        XCTAssertEqual(event.attendeeEmails, ["personal@example.com", "work@example.com"])
        XCTAssertEqual(event.conferenceURL, "https://meet.google.com/example")
        XCTAssertEqual(page.nextSyncToken, "cursor-2")
        let requests = await transport.requests()
        let request = try XCTUnwrap(requests.first)
        XCTAssertTrue(request.url.absoluteString.contains("showDeleted=true"))
        XCTAssertTrue(request.url.absoluteString.contains("singleEvents=true"))
        XCTAssertEqual(request.headers["Authorization"], "Bearer token-personal-account")
    }

    func testUpdateRoutesToDestinationAccountAndCarriesIfMatch() async throws {
        let response = HTTPResponse(
            statusCode: 200,
            body: Data(#"{"id":"destination-id","etag":"revision-2"}"#.utf8)
        )
        let transport = ScriptedHTTPTransport(responses: [.success(response)])
        let provider = GoogleCalendarProvider(
            tokenSource: StaticTokenSource(),
            transport: transport,
            baseURL: URL(string: "https://calendar.test/v3")!
        )
        let desired = DesiredCopy(
            summary: "Busy",
            start: Date(timeIntervalSince1970: 1_700_000_000),
            end: Date(timeIntervalSince1970: 1_700_003_600),
            isAllDay: false,
            description: nil,
            location: nil,
            conferenceURL: nil,
            visibility: .private,
            transparency: .opaque,
            disclosure: ["time.start", "time.end"]
        )
        _ = try await provider.apply(
            ProviderMutation(
                idempotencyKey: "update-key",
                operation: .update,
                policyID: "policy",
                sourceEventID: "source",
                destinationEndpoint: CalendarEndpoint(
                    accountID: "employer-account",
                    calendarID: "primary"
                ),
                destinationEventID: "destination-id",
                expectedProviderRevision: "revision-1",
                desiredCopy: desired
            )
        )

        let requests = await transport.requests()
        let request = try XCTUnwrap(requests.first)
        XCTAssertEqual(request.headers["Authorization"], "Bearer token-employer-account")
        XCTAssertEqual(request.headers["If-Match"], "revision-1")
    }
}

private struct StaticTokenSource: GoogleAccessTokenSource {
    func accessToken(accountID: String) async throws -> String { "token-\(accountID)" }
}

private struct StaticIdentitySource: GoogleAccountIdentitySource {
    let emails: [String: String]

    func identityEmail(accountID: String) async throws -> String? { emails[accountID] }
}
