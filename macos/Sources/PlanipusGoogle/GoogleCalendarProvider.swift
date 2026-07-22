import Foundation
import PlanipusCore

/// Routes every Google operation through the account carried by its endpoint.
/// One instance can therefore safely serve personal and employer accounts at
/// the same time; it never has a process-wide "current Google account".
public actor GoogleAccountCalendarRouter: CalendarProvider {
    private let tokenSource: any GoogleAccessTokenSource
    private let identitySource: (any GoogleAccountIdentitySource)?
    private let transport: any HTTPTransport
    private let baseURL: URL

    public init(
        tokenSource: any GoogleAccessTokenSource,
        identitySource: (any GoogleAccountIdentitySource)? = nil,
        transport: any HTTPTransport,
        baseURL: URL = URL(string: "https://www.googleapis.com/calendar/v3")!
    ) {
        self.tokenSource = tokenSource
        self.identitySource = identitySource
        self.transport = transport
        self.baseURL = baseURL
    }

    public func fetchChangePage(_ request: ProviderChangeRequest) async throws -> ProviderChangePage {
        try validate(request.endpoint)
        var components = URLComponents(
            url: endpoint(request.endpoint, suffix: "events"),
            resolvingAgainstBaseURL: false
        )!
        var queryItems = [
            URLQueryItem(name: "maxResults", value: "2500"),
            URLQueryItem(name: "showDeleted", value: "true"),
            URLQueryItem(name: "singleEvents", value: "true"),
        ]
        if let syncToken = request.syncToken {
            queryItems.append(URLQueryItem(name: "syncToken", value: syncToken))
        } else {
            if let start = request.fullSyncStart {
                queryItems.append(URLQueryItem(name: "timeMin", value: Self.timestamp(start)))
            }
            if let end = request.fullSyncEnd {
                queryItems.append(URLQueryItem(name: "timeMax", value: Self.timestamp(end)))
            }
        }
        if let pageToken = request.pageToken {
            queryItems.append(URLQueryItem(name: "pageToken", value: pageToken))
        }
        components.queryItems = queryItems

        let response = try await authorizedRequest(
            accountID: request.endpoint.accountID,
            method: .get,
            url: components.url!
        )
        try validate(response)
        let payload = try decoder.decode(GoogleEventList.self, from: response.body)
        let identityEmail = try await identitySource?.identityEmail(
            accountID: request.endpoint.accountID
        )
        return ProviderChangePage(
            events: payload.items.map {
                $0.sourceEvent(
                    calendarID: request.endpoint.calendarID,
                    sourceIdentityEmail: identityEmail
                )
            },
            nextPageToken: payload.nextPageToken,
            nextSyncToken: payload.nextSyncToken
        )
    }

    public func readEvent(at endpoint: CalendarEndpoint, eventID: String) async throws -> SourceEvent? {
        try validate(endpoint)
        let response = try await authorizedRequest(
            accountID: endpoint.accountID,
            method: .get,
            url: self.endpoint(endpoint, suffix: "events/\(escaped(eventID))")
        )
        if response.statusCode == 404 { return nil }
        try validate(response)
        let identityEmail = try await identitySource?.identityEmail(accountID: endpoint.accountID)
        return try decoder.decode(GoogleEvent.self, from: response.body).sourceEvent(
            calendarID: endpoint.calendarID,
            sourceIdentityEmail: identityEmail
        )
    }

    public func apply(_ mutation: ProviderMutation) async throws -> ProviderMutationResult {
        try validate(mutation.destinationEndpoint)
        let url: URL
        let method: HTTPMethod
        let body: Data?
        switch mutation.operation {
        case .create:
            method = .post
            url = endpoint(mutation.destinationEndpoint, suffix: "events")
            body = try encoder.encode(GoogleWriteEvent(mutation: mutation))
        case .update:
            method = .put
            url = endpoint(
                mutation.destinationEndpoint,
                suffix: "events/\(escaped(mutation.destinationEventID))"
            )
            body = try encoder.encode(GoogleWriteEvent(mutation: mutation))
        case .delete:
            method = .delete
            url = endpoint(
                mutation.destinationEndpoint,
                suffix: "events/\(escaped(mutation.destinationEventID))"
            )
            body = nil
        }

        var components = URLComponents(url: url, resolvingAgainstBaseURL: false)!
        components.queryItems = [URLQueryItem(name: "sendUpdates", value: "none")]
        var headers: [String: String] = [:]
        if mutation.operation != .create, let revision = mutation.expectedProviderRevision {
            headers["If-Match"] = revision
        }
        let response = try await authorizedRequest(
            accountID: mutation.destinationEndpoint.accountID,
            method: method,
            url: components.url!,
            additionalHeaders: headers,
            body: body
        )
        if mutation.operation == .delete, response.statusCode == 404 {
            return ProviderMutationResult(destinationEventID: mutation.destinationEventID)
        }
        try validate(response)
        if mutation.operation == .delete {
            return ProviderMutationResult(destinationEventID: mutation.destinationEventID)
        }
        let event = try decoder.decode(GoogleEvent.self, from: response.body)
        return ProviderMutationResult(destinationEventID: event.id, providerRevision: event.etag)
    }

    private func authorizedRequest(
        accountID: String,
        method: HTTPMethod,
        url: URL,
        additionalHeaders: [String: String] = [:],
        body: Data? = nil
    ) async throws -> HTTPResponse {
        let token = try await tokenSource.accessToken(accountID: accountID)
        var headers = [
            "Authorization": "Bearer \(token)",
            "Accept": "application/json",
            "Content-Type": "application/json; charset=utf-8",
        ]
        headers.merge(additionalHeaders) { _, new in new }
        return try await transport.send(
            HTTPRequest(
                method: method,
                url: url,
                headers: headers,
                body: body
            )
        )
    }

    private func endpoint(_ endpoint: CalendarEndpoint, suffix: String) -> URL {
        baseURL
            .appendingPathComponent("calendars")
            .appendingPathComponent(endpoint.calendarID)
            .appendingPathComponent(suffix)
    }

    private func escaped(_ value: String) -> String {
        value.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? value
    }

    private func validate(_ response: HTTPResponse) throws {
        switch response.statusCode {
        case 200..<300: return
        case 401: throw ProviderError.unauthorized
        case 403: throw ProviderError.forbidden
        case 404: throw ProviderError.notFound
        case 409, 412: throw ProviderError.conflict
        case 410: throw ProviderError.cursorExpired
        case 429: throw ProviderError.quotaLimited(retryAfter: nil)
        case 500..<600: throw ProviderError.transient
        default: throw ProviderError.malformedResponse
        }
    }

    private func validate(_ endpoint: CalendarEndpoint) throws {
        guard endpoint.provider == .google else { throw ProviderError.unsupportedProvider }
    }

    private static func timestamp(_ date: Date) -> String {
        ISO8601DateFormatter().string(from: date)
    }

    private var decoder: JSONDecoder {
        let value = JSONDecoder()
        value.dateDecodingStrategy = .iso8601
        return value
    }

    private var encoder: JSONEncoder {
        let value = JSONEncoder()
        value.dateEncodingStrategy = .iso8601
        value.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        return value
    }
}

/// Compatibility spelling retained for callers that do not need to emphasize
/// the multi-account routing behavior.
public typealias GoogleCalendarProvider = GoogleAccountCalendarRouter

private struct GoogleEventList: Decodable {
    var items: [GoogleEvent]
    var nextPageToken: String?
    var nextSyncToken: String?

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        items = try container.decodeIfPresent([GoogleEvent].self, forKey: .items) ?? []
        nextPageToken = try container.decodeIfPresent(String.self, forKey: .nextPageToken)
        nextSyncToken = try container.decodeIfPresent(String.self, forKey: .nextSyncToken)
    }

    enum CodingKeys: CodingKey { case items, nextPageToken, nextSyncToken }
}

private struct GoogleEvent: Codable {
    var id: String
    var etag: String?
    var status: String?
    var summary: String?
    var description: String?
    var location: String?
    var start: GoogleEventTime?
    var end: GoogleEventTime?
    var transparency: String?
    var visibility: String?
    var recurringEventId: String?
    var originalStartTime: GoogleEventTime?
    var extendedProperties: GoogleExtendedProperties?
    var attendees: [GoogleAttendee]?
    var organizer: GooglePerson?
    var hangoutLink: String?

    func sourceEvent(calendarID: String, sourceIdentityEmail: String?) -> SourceEvent {
        let normalizedIdentity = sourceIdentityEmail?.lowercased()
        let sourceAttendee = attendees?.first(where: { attendee in
            attendee.isSelf == true
                || normalizedIdentity.map { attendee.email.lowercased() == $0 } == true
        })
        let sourceIsOrganizer = organizer?.isSelf == true
            || normalizedIdentity.flatMap { identity in
                organizer?.email.map { $0.lowercased() == identity }
            } == true
        let rsvpStatus: RSVPStatus
        if let sourceAttendee {
            switch sourceAttendee.responseStatus {
            case "accepted": rsvpStatus = .accepted
            case "tentative": rsvpStatus = .tentative
            case "declined": rsvpStatus = .declined
            case "needsAction": rsvpStatus = .needsAction
            default: rsvpStatus = .notApplicable
            }
        } else if sourceIsOrganizer {
            rsvpStatus = .organizer
        } else {
            rsvpStatus = .notApplicable
        }
        return SourceEvent(
            id: id,
            calendarID: calendarID,
            occurrenceID: originalStartTime?.dateTime ?? originalStartTime?.date ?? recurringEventId,
            start: start?.instant ?? .distantPast,
            end: end?.instant ?? .distantPast,
            isAllDay: start?.date != nil,
            isFree: transparency == "transparent",
            title: summary ?? "",
            details: description,
            location: location,
            conferenceURL: hangoutLink,
            rsvpStatus: rsvpStatus,
            attendeeEmails: attendees?.map(\.email) ?? [],
            isManagedCopy: extendedProperties?.privateValues?["planipus_managed"] == "1",
            managedPolicyID: extendedProperties?.privateValues?["planipus_policy"],
            managedProjectionID: extendedProperties?.privateValues?["planipus_projection"],
            isDeleted: status == "cancelled",
            providerRevision: etag
        )
    }
}

private struct GoogleAttendee: Codable {
    var email: String
    var responseStatus: String?
    var isSelf: Bool?

    enum CodingKeys: String, CodingKey {
        case email, responseStatus
        case isSelf = "self"
    }
}

private struct GooglePerson: Codable {
    var email: String?
    var isSelf: Bool?

    enum CodingKeys: String, CodingKey {
        case email
        case isSelf = "self"
    }
}

private struct GoogleWriteEvent: Encodable {
    var id: String
    var summary: String
    var description: String?
    var location: String?
    var start: GoogleEventTime
    var end: GoogleEventTime
    var visibility: String
    var transparency: String
    var reminders: GoogleReminders
    var extendedProperties: GoogleExtendedProperties

    init(mutation: ProviderMutation) throws {
        guard let desired = mutation.desiredCopy else { throw ProviderError.malformedResponse }
        id = mutation.destinationEventID
        summary = desired.summary
        description = desired.description
        location = desired.location
        start = GoogleEventTime(dateTime: desired.isAllDay ? nil : desired.start, date: desired.isAllDay ? desired.start : nil)
        end = GoogleEventTime(dateTime: desired.isAllDay ? nil : desired.end, date: desired.isAllDay ? desired.end : nil)
        visibility = desired.visibility.rawValue
        transparency = desired.transparency.rawValue
        reminders = GoogleReminders(useDefault: false, overrides: [])
        extendedProperties = GoogleExtendedProperties(
            privateValues: [
                "planipus_managed": "1",
                "planipus_policy": mutation.policyID,
                "planipus_projection": mutation.destinationEventID,
            ]
        )
    }
}

private struct GoogleEventTime: Codable {
    var dateTime: String?
    var date: String?

    init(dateTime: Date?, date: Date?) {
        if let dateTime {
            self.dateTime = ISO8601DateFormatter().string(from: dateTime)
            self.date = nil
        } else if let date {
            let formatter = DateFormatter()
            formatter.calendar = Calendar(identifier: .gregorian)
            formatter.locale = Locale(identifier: "en_US_POSIX")
            formatter.timeZone = TimeZone(secondsFromGMT: 0)
            formatter.dateFormat = "yyyy-MM-dd"
            self.date = formatter.string(from: date)
            self.dateTime = nil
        } else {
            self.dateTime = nil
            self.date = nil
        }
    }

    var instant: Date? {
        if let dateTime { return ISO8601DateFormatter().date(from: dateTime) }
        if let date {
            let formatter = DateFormatter()
            formatter.calendar = Calendar(identifier: .gregorian)
            formatter.locale = Locale(identifier: "en_US_POSIX")
            formatter.timeZone = TimeZone(secondsFromGMT: 0)
            formatter.dateFormat = "yyyy-MM-dd"
            return formatter.date(from: date)
        }
        return nil
    }
}

private struct GoogleExtendedProperties: Codable {
    var privateValues: [String: String]?

    enum CodingKeys: String, CodingKey { case privateValues = "private" }
}

private struct GoogleReminders: Codable {
    var useDefault: Bool
    var overrides: [GoogleReminderOverride]
}

private struct GoogleReminderOverride: Codable {}
