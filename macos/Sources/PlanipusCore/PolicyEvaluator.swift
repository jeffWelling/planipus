import Foundation

/// Adapts the Mac account-explicit domain to the native implementation of the
/// language-neutral calendar-sync/v1 policy contract.
public struct PolicyEvaluator: Sendable {
    private let canonical = CanonicalCalendarSyncEvaluator()

    public init() {}

    public func evaluate(
        event: SourceEvent,
        policy: SyncPolicy,
        hasExistingProjection: Bool = false
    ) -> PolicyDecision {
        do {
            let output = try canonical.evaluate(
                kind: "policy_evaluation",
                input: canonicalInput(
                    event: event,
                    policy: policy,
                    hasExistingProjection: hasExistingProjection
                )
            )
            return try decision(from: output, event: event)
        } catch {
            // The coordinator's evaluator API is deliberately non-throwing.
            // Invalid adapter state fails closed and never creates a copy.
            return PolicyDecision(action: .omit, reasonCodes: [PolicyReason.invalidSourceEvent])
        }
    }

    private func canonicalInput(
        event: SourceEvent,
        policy: SyncPolicy,
        hasExistingProjection: Bool
    ) -> JSONValue {
        let timing = canonicalTiming(event)
        let horizonStart = policy.horizonStart ?? event.start.addingTimeInterval(-86_400)
        let horizonEnd = policy.horizonEnd ?? event.end.addingTimeInterval(86_400)
        let destinationInvited = destinationIdentityInvited(event: event, policy: policy)
        let relationship = canonicalRelationship(event.rsvpStatus, responseNote: event.responseNote)
        let availability = event.isFree ? "free" : "busy"

        var source: [String: JSONValue] = [
            "source_event_ref": .string(event.id),
            "source_occurrence_ref": .string(event.occurrenceID ?? event.id),
            "remote_revision": .string(event.providerRevision ?? ""),
            "lifecycle": .string(event.isDeleted ? "deleted" : "confirmed"),
            "origin": .string(event.isManagedCopy ? "planipus_managed" : "provider_original"),
            "availability": .string(availability),
            "relationship": relationship,
            "destination_identity_invited": .bool(destinationInvited),
            "content": .object([
                "summary": .string(event.title),
                "description": event.details.map(JSONValue.string) ?? .null,
                "location": event.location.map(JSONValue.string) ?? .null,
                "conference": event.conferenceURL.map(JSONValue.string) ?? .null,
            ].filter { if case .null = $0.value { return false }; return true }),
            "attendees": .array(event.attendeeEmails.map(JSONValue.string)),
        ]
        if !event.isDeleted { source["timing"] = timing }

        let genericSummary = policy.privacyPreset == .busyOnly ? "Busy" : policy.genericLabel
        let hoursProfileReference = policy.hoursProfile.id
        let input: [String: JSONValue] = [
            "now": .string(instantString(event.start)),
            "horizon": .object([
                "start": .string(instantString(horizonStart)),
                "end": .string(instantString(horizonEnd)),
            ]),
            "candidate_projection_ref": .string("\(policy.id)/\(event.id)/\(event.occurrenceID ?? "root")"),
            "policy": .object([
                "policy_ref": .string(policy.id),
                "revision": .number(Double(policy.revision)),
                "state": .string(policy.enabled ? "active" : "disabled"),
                "source_calendar_ref": .string(endpointReference(policy.sourceEndpoint)),
                "destination_calendar_ref": .string(endpointReference(policy.destinationEndpoint)),
                "hours": .object([
                    "mode": .string(policy.hoursMode.rawValue),
                    "profile_ref": .string(hoursProfileReference),
                ]),
                "privacy": .object([
                    "preset": .string(policy.privacyPreset.rawValue),
                    "preset_version": .number(Double(policy.privacyPresetVersion)),
                    "generic_summary": .string(genericSummary),
                    "copy_summary": .bool(policy.privacyFields.title),
                    "copy_description": .bool(policy.privacyFields.description),
                    "copy_location": .bool(policy.privacyFields.location),
                    "copy_conference": .bool(policy.privacyFields.conference),
                    "copy_attendees": .bool(false),
                    "copy_organizer": .bool(false),
                ]),
                "selection": .object([
                    "timed": .string(policy.timedEventsEnabled ? "include" : "skip"),
                    "all_day": .string(policy.allDayBehavior.rawValue),
                    "free_events": .string(policy.freeEventBehavior.rawValue),
                    "tentative": .string(policy.tentativeBehavior.rawValue),
                    "unanswered": .string(canonicalUnanswered(policy.needsActionBehavior)),
                    "skip_when_destination_identity_invited": .bool(policy.skipWhenDestinationInvited),
                    "source_exclusion_marker": .string(
                        policy.noSyncTokenEnabled ? policy.sourceExclusionMarker : ""
                    ),
                    "manual_exclusions": .array(
                        policy.manualExcludedSourceEventIDs.sorted().map(JSONValue.string)
                    ),
                ]),
                "destination": .object([:]),
            ]),
            "hours_profile": canonicalHoursProfile(policy.hoursProfile),
            "source": .object(source),
            "projection": .object([
                "ownership": .string(hasExistingProjection ? "attached" : "none"),
                "projection_ref": .string("\(policy.id)/\(event.id)/\(event.occurrenceID ?? "root")"),
                "generation": .number(1),
                "destination_exists": .bool(hasExistingProjection),
            ]),
            "destination_capabilities": .object([
                "writable": .bool(true),
                "private_visibility": .bool(true),
                "conference_copy": .bool(true),
                "color": .bool(true),
            ]),
        ]
        return .object(input)
    }

    private func decision(from output: JSONValue, event: SourceEvent) throws -> PolicyDecision {
        guard case .object(let object) = output else {
            throw CanonicalEvaluationError.invalidInput("Canonical policy output must be an object")
        }
        let operation = string(object["operation"]) ?? "none"
        let selection = string(object["selection"]) ?? "invalid"
        let reasons = stringArray(object["reason_codes"])
        if operation == "delete" {
            return PolicyDecision(action: .delete, reasonCodes: reasons)
        }
        guard selection == "included",
              case .object(let desired) = object["desired_copy"] else {
            return PolicyDecision(action: .omit, reasonCodes: reasons)
        }

        let visibility = DestinationVisibility(rawValue: string(desired["visibility"]) ?? "private") ?? .private
        let transparency = DestinationTransparency(
            rawValue: string(desired["transparency"]) ?? "opaque"
        ) ?? .opaque
        let disclosure = objectValue(object["disclosure_manifest"])
            .map { stringArray($0["source_fields_disclosed"]) }
            ?? []
        return PolicyDecision(
            action: .copy,
            reasonCodes: reasons,
            desiredCopy: DesiredCopy(
                summary: string(desired["summary"]) ?? "",
                start: event.start,
                end: event.end,
                isAllDay: event.isAllDay,
                description: string(desired["description"]),
                location: string(desired["location"]),
                conferenceURL: string(desired["conference"]),
                visibility: visibility,
                transparency: transparency,
                disclosure: disclosure
            )
        )
    }

    private func canonicalHoursProfile(_ profile: HoursProfile) -> JSONValue {
        .object([
            "profile_ref": .string(profile.id),
            "revision": .number(1),
            "timezone": .string(profile.timezoneIdentifier),
            "dst_resolution": .object([
                "ambiguous": .string("earlier_offset"),
                "nonexistent": .string("shift_forward_by_gap"),
            ]),
            "weekly": .array(profile.intervals.map { interval in
                let endRollsToNextDay = interval.endMinute == 1_440
                    || interval.endMinute <= interval.startMinute
                return .object([
                    "weekday": .number(Double(interval.weekday.rawValue)),
                    "start": .string(localTime(interval.startMinute)),
                    "end": .string(localTime(interval.endMinute % 1_440)),
                    "end_day_offset": .number(endRollsToNextDay ? 1 : 0),
                ])
            }),
            "exceptions": .array([]),
        ])
    }

    private func canonicalTiming(_ event: SourceEvent) -> JSONValue {
        if event.isAllDay {
            return .object([
                "kind": .string("all_day"),
                "start_date": .string(localDateString(event.start)),
                "end_date": .string(localDateString(event.end)),
                "timezone": .string("UTC"),
            ])
        }
        return .object([
            "kind": .string("timed"),
            "start_instant": .string(instantString(event.start)),
            "end_instant": .string(instantString(event.end)),
            "start_tzid": .string("UTC"),
            "end_tzid": .string("UTC"),
        ])
    }

    private func canonicalRelationship(_ status: RSVPStatus, responseNote: String?) -> JSONValue {
        var relationship: [String: JSONValue]
        switch status {
        case .organizer:
            relationship = ["role": .string("organizer"), "response": .string("not_applicable")]
        case .notApplicable:
            relationship = ["role": .string("none"), "response": .string("not_applicable")]
        case .accepted:
            relationship = ["role": .string("attendee"), "response": .string("accepted")]
        case .tentative:
            relationship = ["role": .string("attendee"), "response": .string("tentative")]
        case .declined:
            relationship = ["role": .string("attendee"), "response": .string("declined")]
        case .needsAction:
            relationship = ["role": .string("attendee"), "response": .string("needs_action")]
        }
        if let responseNote { relationship["response_note"] = .string(responseNote) }
        return .object(relationship)
    }

    private func destinationIdentityInvited(event: SourceEvent, policy: SyncPolicy) -> Bool {
        guard let destination = (policy.destinationIdentityEmail ?? event.destinationIdentityEmail)?.lowercased()
        else { return false }
        return event.attendeeEmails.contains { $0.lowercased() == destination }
    }

    private func endpointReference(_ endpoint: CalendarEndpoint) -> String {
        let account = endpoint.accountID
        let calendar = endpoint.calendarID
        return "\(endpoint.provider.rawValue):\(account.utf8.count):\(account):\(calendar.utf8.count):\(calendar)"
    }

    private func canonicalUnanswered(_ behavior: NeedsActionBehavior) -> String {
        switch behavior {
        case .includeFree: "free"
        case .includeBusy: "busy"
        case .omit: "omit"
        }
    }

    private func localTime(_ minute: Int) -> String {
        String(format: "%02d:%02d:00", minute / 60, minute % 60)
    }

    private func localDateString(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(secondsFromGMT: 0)
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter.string(from: date)
    }

    private func instantString(_ date: Date) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.timeZone = TimeZone(secondsFromGMT: 0)
        formatter.formatOptions = [.withInternetDateTime]
        return formatter.string(from: date)
    }

    private func objectValue(_ value: JSONValue?) -> [String: JSONValue]? {
        guard case .object(let object) = value else { return nil }
        return object
    }

    private func string(_ value: JSONValue?) -> String? {
        guard case .string(let string) = value else { return nil }
        return string
    }

    private func stringArray(_ value: JSONValue?) -> [String] {
        guard case .array(let array) = value else { return [] }
        return array.compactMap(string)
    }
}

