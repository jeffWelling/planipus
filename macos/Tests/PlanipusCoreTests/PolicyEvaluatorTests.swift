import Foundation
import PlanipusCore
import XCTest

final class PolicyEvaluatorTests: XCTestCase {
    private let evaluator = PolicyEvaluator()

    func testBusyOnlyCopiesTimeWithoutSourceDetails() throws {
        let event = sampleEvent(title: "Dentist", details: "Dr Example, room 4")
        let decision = evaluator.evaluate(event: event, policy: policy())

        XCTAssertEqual(decision.action, .copy)
        XCTAssertEqual(decision.desiredCopy?.summary, "Busy")
        XCTAssertNil(decision.desiredCopy?.description)
        XCTAssertNil(decision.desiredCopy?.location)
        XCTAssertEqual(decision.desiredCopy?.visibility, .private)
        XCTAssertEqual(decision.desiredCopy?.remindersEnabled, false)
        XCTAssertFalse(decision.desiredCopy?.disclosure.contains("/content/summary") == true)
    }

    func testPrimaryCalendarsInDifferentAccountsAreNotASelfMap() {
        var crossAccount = policy()
        crossAccount.sourceCalendarID = "primary"
        crossAccount.destinationCalendarID = "primary"
        XCTAssertEqual(
            evaluator.evaluate(event: sampleEvent(title: "Appointment"), policy: crossAccount).action,
            .copy
        )

        crossAccount.destinationAccountID = crossAccount.sourceAccountID
        let selfMap = evaluator.evaluate(
            event: sampleEvent(title: "Appointment"),
            policy: crossAccount
        )
        XCTAssertEqual(selfMap.action, .omit)
        XCTAssertEqual(selfMap.reasonCodes, [PolicyReason.selfMap])
    }

    func testOutsideHoursDeletesAnExistingProjection() throws {
        var outside = sampleEvent(title: "Dinner")
        outside.start = try date("2026-07-20T19:00:00Z")
        outside.end = try date("2026-07-20T20:00:00Z")

        let decision = evaluator.evaluate(
            event: outside,
            policy: policy(),
            hasExistingProjection: true
        )
        XCTAssertEqual(decision.action, .delete)
        XCTAssertEqual(
            decision.reasonCodes,
            [PolicyReason.outsideHours, PolicyReason.deletePolicyExclusion]
        )
    }

    func testNoSyncTokenIsCaseInsensitiveAndBoundaryAware() {
        XCTAssertEqual(
            evaluator.evaluate(event: sampleEvent(title: "Private #NoSync"), policy: policy()).action,
            .omit
        )
        XCTAssertEqual(
            evaluator.evaluate(event: sampleEvent(title: "tag#nosyncish"), policy: policy()).action,
            .copy
        )
    }

    func testRSVPAvailabilityIsDerivedBeforeFreeFiltering() {
        var accepted = sampleEvent(title: "Accepted meeting")
        accepted.isFree = true
        accepted.rsvpStatus = .accepted
        let acceptedDecision = evaluator.evaluate(event: accepted, policy: policy())
        XCTAssertEqual(acceptedDecision.action, .copy)
        XCTAssertEqual(acceptedDecision.desiredCopy?.transparency, .opaque)

        var unanswered = accepted
        unanswered.rsvpStatus = .needsAction
        let unansweredDecision = evaluator.evaluate(event: unanswered, policy: policy())
        XCTAssertEqual(unansweredDecision.action, .omit)
        XCTAssertEqual(unansweredDecision.reasonCodes, [PolicyReason.freeSkipped])

        var organizer = accepted
        organizer.rsvpStatus = .organizer
        XCTAssertEqual(evaluator.evaluate(event: organizer, policy: policy()).action, .copy)
    }

    func testIncludedAllDayEventBypassesTimedHoursButBusyOnlyRejectsFree() throws {
        var allDay = sampleEvent(title: "Weekend away")
        allDay.isAllDay = true
        allDay.start = try date("2026-07-25T00:00:00Z")
        allDay.end = try date("2026-07-27T00:00:00Z")
        var allPolicy = policy()
        allPolicy.allDayBehavior = .all
        XCTAssertEqual(evaluator.evaluate(event: allDay, policy: allPolicy).action, .copy)

        allDay.isFree = true
        allPolicy.allDayBehavior = .busyOnly
        let decision = evaluator.evaluate(event: allDay, policy: allPolicy)
        XCTAssertEqual(decision.action, .omit)
        XCTAssertEqual(decision.reasonCodes, [PolicyReason.allDayFree])
    }

    func testExclusionMarkerNormalizesUnicodeAndHorizonUsesPositiveOverlap() throws {
        var customPolicy = policy()
        customPolicy.sourceExclusionMarker = "#nösync"
        XCTAssertEqual(
            evaluator.evaluate(event: sampleEvent(title: "Private #no\u{0308}sync"), policy: customPolicy).action,
            .omit
        )

        customPolicy.horizonStart = try date("2026-07-20T11:00:00Z")
        let boundary = evaluator.evaluate(event: sampleEvent(title: "Ends at boundary"), policy: customPolicy)
        XCTAssertEqual(boundary.action, .omit)
        XCTAssertEqual(boundary.reasonCodes, [PolicyReason.outsideHorizon])
    }

    func testCanonicalFixtureRoundTripsCaseKeyAndISODate() throws {
        let event = sampleEvent(title: "A quiet appointment")
        let fixture = CalendarSyncFixture(
            caseName: "busy-only-inside-hours",
            now: try date("2026-07-20T08:00:00Z"),
            policy: policy(),
            source: event,
            expectedDecision: .copy,
            expectedReasonCodes: [PolicyReason.hoursOverlap, PolicyReason.included],
            expectedDisclosure: ["/timing"]
        )

        let encoded = try ConformanceFixtureCodec.encode(fixture)
        let object = try XCTUnwrap(JSONSerialization.jsonObject(with: encoded) as? [String: Any])
        XCTAssertEqual(object["case"] as? String, "busy-only-inside-hours")
        XCTAssertNil(object["caseName"])
        let decoded = try ConformanceFixtureCodec.decode(encoded)
        XCTAssertEqual(decoded.caseName, fixture.caseName)
        XCTAssertEqual(decoded.source, event)
    }

    func testSharedV1CaseBundleDecodesSnakeCaseAndAppliesDeepPatch() throws {
        let data = Data(
            #"{"contract_version":1,"kind":"policy_evaluation","defaults":{"input":{"policy":{"privacy":{"preset":"busy_only","copy_summary":false}},"source":{"availability":"busy"}}},"cases":[{"case_id":"privacy.private_title_only","title":"Private title","requirements":["CAL-011"],"input_patch":{"policy":{"privacy":{"preset":"private_details","copy_summary":true}}},"expected":{"selection":"included"}}]}"#.utf8
        )
        let bundle = try CanonicalFixtureCodec.decodeBundle(data)
        XCTAssertEqual(bundle.contractVersion, 1)
        XCTAssertEqual(bundle.cases.first?.caseID, "privacy.private_title_only")
        XCTAssertEqual(
            try bundle.materializedInput(caseID: "privacy.private_title_only"),
            .object([
                "policy": .object([
                    "privacy": .object([
                        "preset": .string("private_details"),
                        "copy_summary": .bool(true),
                    ]),
                ]),
                "source": .object(["availability": .string("busy")]),
            ])
        )
    }

    func testSharedV1CaseBundleUsesRFC7396NullDeletion() throws {
        let data = Data(
            #"{"contract_version":1,"kind":"policy_evaluation","defaults":{"input":{"source":{"summary":"Dentist","description":"Private","nested":{"keep":true,"remove":"me"}}}},"cases":[{"case_id":"merge.null-deletes","title":"Null deletes","requirements":["CAL-011"],"input_patch":{"source":{"description":null,"missing":null,"nested":{"remove":null,"added":"yes"}}},"expected":{}}]}"#.utf8
        )
        let bundle = try CanonicalFixtureCodec.decodeBundle(data)

        XCTAssertEqual(
            try bundle.materializedInput(caseID: "merge.null-deletes"),
            .object([
                "source": .object([
                    "summary": .string("Dentist"),
                    "nested": .object([
                        "keep": .bool(true),
                        "added": .string("yes"),
                    ]),
                ]),
            ])
        )
    }

    private func policy() -> SyncPolicy {
        SyncPolicy(
            id: "personal-to-work",
            sourceAccountID: "personal-account",
            sourceCalendarID: "personal",
            destinationAccountID: "work-account",
            destinationCalendarID: "work",
            hoursProfile: .weekdays(timezoneIdentifier: "UTC"),
            privacyPreset: .busyOnly
        )
    }

    private func sampleEvent(
        title: String,
        details: String? = nil
    ) -> SourceEvent {
        SourceEvent(
            id: "source-1",
            calendarID: "personal",
            start: try! date("2026-07-20T10:00:00Z"),
            end: try! date("2026-07-20T11:00:00Z"),
            title: title,
            details: details,
            location: "A location",
            conferenceURL: "https://meet.example/secret",
            providerRevision: "rev-1"
        )
    }

    private func date(_ value: String) throws -> Date {
        try XCTUnwrap(ISO8601DateFormatter().date(from: value))
    }
}
