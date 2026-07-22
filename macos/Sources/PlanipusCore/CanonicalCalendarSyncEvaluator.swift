import CryptoKit
import Foundation

/// The native implementation of the language-neutral
/// `conformance/calendar-sync/v1` behavior contract.
///
/// This evaluator intentionally accepts and returns the contract's JSON shape.
/// Provider/account routing remains in the Mac-specific domain model; policy
/// behavior remains portable and can be checked against the same fixtures as
/// Planipus Server without sharing executable code.
public struct CanonicalCalendarSyncEvaluator: Sendable {
    public init() {}

    public func evaluate(kind: String, input: JSONValue) throws -> JSONValue {
        switch kind {
        case "hours_evaluation":
            return try HoursEvaluator(input: input).evaluate()
        case "policy_evaluation", "validation":
            return try PolicyContractEvaluator(input: input).evaluate()
        default:
            throw CanonicalEvaluationError.unsupportedKind(kind)
        }
    }
}

public enum CanonicalEvaluationError: Error, Equatable, Sendable {
    case unsupportedKind(String)
    case invalidInput(String)
    case invalidInstant(String)
    case invalidTimezone(String)
    case dstResolutionRejected
}

/// Canonical JSON and SHA-256 used by calendar-sync/v1 fingerprints.
public enum CanonicalJSONCodec {
    public static func encode(_ value: JSONValue) throws -> Data {
        Data(try canonicalJSON(value).utf8)
    }

    public static func fingerprint(_ value: JSONValue) throws -> String {
        let digest = SHA256.hash(data: try encode(value))
        return "sha256:" + digest.map { String(format: "%02x", $0) }.joined()
    }

    private static func canonicalJSON(_ value: JSONValue) throws -> String {
        switch value {
        case .null:
            return "null"
        case .bool(let value):
            return value ? "true" : "false"
        case .number(let value):
            guard value.isFinite,
                  value.rounded() == value,
                  abs(value) <= 9_007_199_254_740_991 else {
                throw CanonicalEvaluationError.invalidInput("Canonical JSON permits safe integers only")
            }
            if value == 0 { return "0" }
            return String(format: "%.0f", value)
        case .string(let value):
            return escapedJSONString(value.precomposedStringWithCanonicalMapping)
        case .array(let values):
            return "[" + (try values.map(canonicalJSON).joined(separator: ",")) + "]"
        case .object(let object):
            var normalized: [String: JSONValue] = [:]
            for (key, member) in object {
                let normalizedKey = key.precomposedStringWithCanonicalMapping
                guard normalized[normalizedKey] == nil else {
                    throw CanonicalEvaluationError.invalidInput(
                        "Canonical JSON contains NFC-equivalent duplicate keys"
                    )
                }
                normalized[normalizedKey] = member
            }
            let members = try normalized.keys.sorted().map { key in
                "\(escapedJSONString(key)):\(try canonicalJSON(normalized[key]!))"
            }
            return "{" + members.joined(separator: ",") + "}"
        }
    }

    private static func escapedJSONString(_ value: String) -> String {
        var output = "\""
        for scalar in value.unicodeScalars {
            switch scalar.value {
            case 0x08: output += "\\b"
            case 0x09: output += "\\t"
            case 0x0A: output += "\\n"
            case 0x0C: output += "\\f"
            case 0x0D: output += "\\r"
            case 0x22: output += "\\\""
            case 0x5C: output += "\\\\"
            case 0x00...0x1F: output += String(format: "\\u%04x", scalar.value)
            default: output.unicodeScalars.append(scalar)
            }
        }
        output += "\""
        return output
    }
}

private extension JSONValue {
    var objectValue: [String: JSONValue]? {
        guard case .object(let value) = self else { return nil }
        return value
    }

    var arrayValue: [JSONValue]? {
        guard case .array(let value) = self else { return nil }
        return value
    }

    var stringValue: String? {
        guard case .string(let value) = self else { return nil }
        return value
    }

    var boolValue: Bool? {
        guard case .bool(let value) = self else { return nil }
        return value
    }

    var intValue: Int? {
        guard case .number(let value) = self, value.isFinite, value.rounded() == value else { return nil }
        return Int(exactly: value)
    }

    subscript(key: String) -> JSONValue? {
        objectValue?[key]
    }

    func requiredObject(_ context: String) throws -> [String: JSONValue] {
        guard let objectValue else {
            throw CanonicalEvaluationError.invalidInput("\(context) must be an object")
        }
        return objectValue
    }

    func requiredArray(_ context: String) throws -> [JSONValue] {
        guard let arrayValue else {
            throw CanonicalEvaluationError.invalidInput("\(context) must be an array")
        }
        return arrayValue
    }

    func requiredString(_ context: String) throws -> String {
        guard let stringValue else {
            throw CanonicalEvaluationError.invalidInput("\(context) must be a string")
        }
        return stringValue
    }

    func requiredBool(_ context: String) throws -> Bool {
        guard let boolValue else {
            throw CanonicalEvaluationError.invalidInput("\(context) must be a boolean")
        }
        return boolValue
    }

    func requiredInt(_ context: String) throws -> Int {
        guard let intValue else {
            throw CanonicalEvaluationError.invalidInput("\(context) must be an integer")
        }
        return intValue
    }
}

private extension Dictionary where Key == String, Value == JSONValue {
    func required(_ key: String, _ context: String) throws -> JSONValue {
        guard let value = self[key] else {
            throw CanonicalEvaluationError.invalidInput("\(context).\(key) is required")
        }
        return value
    }

    func requiredString(_ key: String, _ context: String) throws -> String {
        try required(key, context).requiredString("\(context).\(key)")
    }

    func requiredBool(_ key: String, _ context: String) throws -> Bool {
        try required(key, context).requiredBool("\(context).\(key)")
    }

    func requiredInt(_ key: String, _ context: String) throws -> Int {
        try required(key, context).requiredInt("\(context).\(key)")
    }

    func requiredObject(_ key: String, _ context: String) throws -> [String: JSONValue] {
        try required(key, context).requiredObject("\(context).\(key)")
    }

    func requiredArray(_ key: String, _ context: String) throws -> [JSONValue] {
        try required(key, context).requiredArray("\(context).\(key)")
    }
}

private enum ContractDateCodec {
    static func formatter(fractionalSeconds: Bool = false) -> ISO8601DateFormatter {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = fractionalSeconds
            ? [.withInternetDateTime, .withFractionalSeconds]
            : [.withInternetDateTime]
        formatter.timeZone = TimeZone(secondsFromGMT: 0)
        return formatter
    }

    static func instant(_ value: String) throws -> Date {
        guard let date = formatter(fractionalSeconds: true).date(from: value)
            ?? formatter().date(from: value) else {
            throw CanonicalEvaluationError.invalidInstant(value)
        }
        return date
    }

    static func string(_ date: Date) -> String {
        formatter().string(from: date)
    }
}

private struct LocalDate: Hashable, Comparable, Sendable {
    let year: Int
    let month: Int
    let day: Int

    init(_ value: String) throws {
        let fields = value.split(separator: "-", omittingEmptySubsequences: false)
        guard fields.count == 3,
              let year = Int(fields[0]),
              let month = Int(fields[1]),
              let day = Int(fields[2]) else {
            throw CanonicalEvaluationError.invalidInput("Invalid local date: \(value)")
        }
        self.year = year
        self.month = month
        self.day = day
    }

    init(date: Date, calendar: Calendar) {
        let values = calendar.dateComponents([.year, .month, .day], from: date)
        self.year = values.year ?? 0
        self.month = values.month ?? 0
        self.day = values.day ?? 0
    }

    var string: String {
        String(format: "%04d-%02d-%02d", year, month, day)
    }

    var components: DateComponents {
        DateComponents(year: year, month: month, day: day)
    }

    func adding(days: Int, calendar: Calendar) throws -> LocalDate {
        var noon = components
        noon.hour = 12
        guard let anchor = calendar.date(from: noon),
              let result = calendar.date(byAdding: .day, value: days, to: anchor) else {
            throw CanonicalEvaluationError.invalidInput("Invalid local date: \(string)")
        }
        return LocalDate(date: result, calendar: calendar)
    }

    static func < (left: LocalDate, right: LocalDate) -> Bool {
        (left.year, left.month, left.day) < (right.year, right.month, right.day)
    }
}

private struct LocalTime: Sendable {
    let hour: Int
    let minute: Int
    let second: Int

    init(_ value: String) throws {
        let fields = value.split(separator: ":", omittingEmptySubsequences: false)
        guard fields.count == 3,
              let hour = Int(fields[0]),
              let minute = Int(fields[1]),
              let second = Int(fields[2]),
              (0...23).contains(hour),
              (0...59).contains(minute),
              (0...59).contains(second) else {
            throw CanonicalEvaluationError.invalidInput("Invalid local time: \(value)")
        }
        self.hour = hour
        self.minute = minute
        self.second = second
    }
}

private struct InstantInterval: Equatable, Sendable {
    let start: Date
    let end: Date

    var json: JSONValue {
        .object([
            "start": .string(ContractDateCodec.string(start)),
            "end": .string(ContractDateCodec.string(end)),
        ])
    }

    func overlaps(_ other: InstantInterval) -> Bool {
        start < end && other.start < other.end && start < other.end && other.start < end
    }

    func contains(_ other: InstantInterval) -> Bool {
        start <= other.start && other.end <= end
    }
}

private struct LocalInterval: Sendable {
    let start: LocalTime
    let end: LocalTime
    let endDayOffset: Int

    init(_ value: JSONValue, context: String) throws {
        let object = try value.requiredObject(context)
        start = try LocalTime(object.requiredString("start", context))
        end = try LocalTime(object.requiredString("end", context))
        endDayOffset = try object.requiredInt("end_day_offset", context)
        guard endDayOffset == 0 || endDayOffset == 1 else {
            throw CanonicalEvaluationError.invalidInput("\(context).end_day_offset must be 0 or 1")
        }
    }
}

private func unique(_ values: [String]) -> [String] {
    var seen = Set<String>()
    return values.filter { seen.insert($0).inserted }
}

private func strings(_ values: [String]) -> JSONValue {
    .array(values.map(JSONValue.string))
}

private struct HoursProfileContract: Sendable {
    enum AmbiguousResolution: String, Sendable {
        case earlier = "earlier_offset"
        case later = "later_offset"
    }

    enum NonexistentResolution: String, Sendable {
        case reject
        case shift = "shift_forward_by_gap"
    }

    struct Weekly: Sendable {
        let weekday: Int
        let interval: LocalInterval
    }

    enum ExceptionKind: String, Sendable {
        case closed
        case replace
        case add
        case remove
    }

    struct Exception: Sendable {
        let date: LocalDate
        let kind: ExceptionKind
        let intervals: [LocalInterval]
    }

    let reference: String
    let timezone: TimeZone
    let ambiguous: AmbiguousResolution
    let nonexistent: NonexistentResolution
    let weekly: [Weekly]
    let exceptions: [Exception]

    init(_ value: JSONValue) throws {
        let object = try value.requiredObject("profile")
        reference = try object.requiredString("profile_ref", "profile")
        let timezoneIdentifier = try object.requiredString("timezone", "profile")
        guard let timezone = TimeZone(identifier: timezoneIdentifier) else {
            throw CanonicalEvaluationError.invalidTimezone(timezoneIdentifier)
        }
        self.timezone = timezone

        let resolution = try object.requiredObject("dst_resolution", "profile")
        let ambiguousValue = try resolution.requiredString("ambiguous", "profile.dst_resolution")
        let nonexistentValue = try resolution.requiredString("nonexistent", "profile.dst_resolution")
        guard let ambiguous = AmbiguousResolution(rawValue: ambiguousValue),
              let nonexistent = NonexistentResolution(rawValue: nonexistentValue) else {
            throw CanonicalEvaluationError.invalidInput("Invalid profile.dst_resolution")
        }
        self.ambiguous = ambiguous
        self.nonexistent = nonexistent

        weekly = try object.requiredArray("weekly", "profile").enumerated().map { index, value in
            let entry = try value.requiredObject("profile.weekly[\(index)]")
            let weekday = try entry.requiredInt("weekday", "profile.weekly[\(index)]")
            guard (1...7).contains(weekday) else {
                throw CanonicalEvaluationError.invalidInput("Invalid ISO weekday: \(weekday)")
            }
            return Weekly(
                weekday: weekday,
                interval: try LocalInterval(value, context: "profile.weekly[\(index)]")
            )
        }

        exceptions = try object.requiredArray("exceptions", "profile").enumerated().map { index, value in
            let context = "profile.exceptions[\(index)]"
            let entry = try value.requiredObject(context)
            let kindValue = try entry.requiredString("kind", context)
            guard let kind = ExceptionKind(rawValue: kindValue) else {
                throw CanonicalEvaluationError.invalidInput("Invalid \(context).kind")
            }
            let intervalValues = entry["intervals"]?.arrayValue ?? []
            let intervals = try intervalValues.enumerated().map {
                try LocalInterval($0.element, context: "\(context).intervals[\($0.offset)]")
            }
            return Exception(
                date: try LocalDate(entry.requiredString("date", context)),
                kind: kind,
                intervals: intervals
            )
        }
    }
}

private struct HoursEvaluator {
    private let input: [String: JSONValue]

    init(input: JSONValue) throws {
        self.input = try input.requiredObject("input")
    }

    func evaluate() throws -> JSONValue {
        let mode = try input.requiredString("mode", "input")
        let eventObject = try input.requiredObject("event", "input")
        let event = InstantInterval(
            start: try ContractDateCodec.instant(eventObject.requiredString("start", "input.event")),
            end: try ContractDateCodec.instant(eventObject.requiredString("end", "input.event"))
        )
        guard event.start < event.end else {
            return output(
                included: false,
                reason: "invalid_hours_profile",
                concrete: [],
                matched: [],
                diagnostics: []
            )
        }
        if mode == "all_times" {
            return output(
                included: true,
                reason: "all_times",
                concrete: [],
                matched: [],
                diagnostics: []
            )
        }
        guard mode == "overlaps_profile" || mode == "contained_in_profile",
              let profileValue = input["profile"] else {
            return output(
                included: false,
                reason: "invalid_hours_profile",
                concrete: [],
                matched: [],
                diagnostics: []
            )
        }

        do {
            let profile = try HoursProfileContract(profileValue)
            var calendar = Calendar(identifier: .gregorian)
            calendar.timeZone = profile.timezone
            var date = try LocalDate(date: event.start, calendar: calendar).adding(days: -1, calendar: calendar)
            let finalDate = LocalDate(date: event.end, calendar: calendar)
            var concrete: [InstantInterval] = []
            var diagnostics: [String] = []
            var visitedDays = 0
            while date <= finalDate {
                guard visitedDays <= 370 else {
                    throw CanonicalEvaluationError.invalidInput("Hours evaluation exceeds bounded range")
                }
                concrete.append(contentsOf: try intervals(for: date, profile: profile, diagnostics: &diagnostics))
                date = try date.adding(days: 1, calendar: calendar)
                visitedDays += 1
            }

            concrete = deduplicated(concrete)
            let overlaps = concrete.filter { $0.overlaps(event) }
            let contained = concrete.filter { $0.contains(event) }
            let matched = mode == "overlaps_profile" ? overlaps : contained
            let included = !matched.isEmpty
            let reason: String
            if mode == "overlaps_profile" {
                reason = included ? "overlaps_hours" : "outside_hours"
            } else {
                reason = included ? "contained_in_hours" : "not_contained_in_hours"
            }
            return output(
                included: included,
                reason: reason,
                concrete: concrete,
                matched: matched,
                diagnostics: unique(diagnostics)
            )
        } catch CanonicalEvaluationError.dstResolutionRejected {
            return output(
                included: false,
                reason: "dst_resolution_rejected",
                concrete: [],
                matched: [],
                diagnostics: ["dst_resolution_rejected"]
            )
        } catch is CanonicalEvaluationError {
            return output(
                included: false,
                reason: "invalid_hours_profile",
                concrete: [],
                matched: [],
                diagnostics: []
            )
        }
    }

    private func intervals(
        for date: LocalDate,
        profile: HoursProfileContract,
        diagnostics: inout [String]
    ) throws -> [InstantInterval] {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = profile.timezone
        var noonComponents = date.components
        noonComponents.hour = 12
        guard let noon = calendar.date(from: noonComponents) else {
            throw CanonicalEvaluationError.invalidInput("Invalid local date: \(date.string)")
        }
        let appleWeekday = calendar.component(.weekday, from: noon)
        let isoWeekday = appleWeekday == 1 ? 7 : appleWeekday - 1
        let weekly = profile.weekly
            .filter { $0.weekday == isoWeekday }
            .map(\.interval)
        let exception = profile.exceptions.first { $0.date == date }
        if exception?.kind == .closed { return [] }

        let local: [LocalInterval]
        switch exception?.kind {
        case .replace: local = exception?.intervals ?? []
        case .add: local = weekly + (exception?.intervals ?? [])
        default: local = weekly
        }
        var concrete = try local.compactMap {
            try materialize($0, on: date, profile: profile, diagnostics: &diagnostics)
        }

        if exception?.kind == .remove {
            let removals = try (exception?.intervals ?? []).compactMap {
                try materialize($0, on: date, profile: profile, diagnostics: &diagnostics)
            }
            for removal in removals {
                concrete = concrete.flatMap { subtract(base: $0, removal: removal) }
            }
        }
        return concrete
    }

    private func materialize(
        _ interval: LocalInterval,
        on date: LocalDate,
        profile: HoursProfileContract,
        diagnostics: inout [String]
    ) throws -> InstantInterval? {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = profile.timezone
        let start = try resolve(date: date, time: interval.start, profile: profile)
        let endDate = try date.adding(days: interval.endDayOffset, calendar: calendar)
        let end = try resolve(date: endDate, time: interval.end, profile: profile)
        if let diagnostic = start.diagnostic { diagnostics.append(diagnostic) }
        if let diagnostic = end.diagnostic { diagnostics.append(diagnostic) }
        guard start.instant < end.instant else { return nil }
        return InstantInterval(start: start.instant, end: end.instant)
    }

    private func resolve(
        date: LocalDate,
        time: LocalTime,
        profile: HoursProfileContract
    ) throws -> (instant: Date, diagnostic: String?) {
        var utc = Calendar(identifier: .gregorian)
        utc.timeZone = TimeZone(secondsFromGMT: 0)!
        var components = date.components
        components.hour = time.hour
        components.minute = time.minute
        components.second = time.second
        guard let naive = utc.date(from: components) else {
            throw CanonicalEvaluationError.invalidInput("Invalid local date-time")
        }

        var offsets = Set<Int>()
        for hour in stride(from: -48, through: 48, by: 6) {
            offsets.insert(profile.timezone.secondsFromGMT(for: naive.addingTimeInterval(Double(hour * 3_600))))
        }
        let candidates = offsets.compactMap { offset -> Date? in
            let candidate = naive.addingTimeInterval(Double(-offset))
            return localComponents(of: candidate, in: profile.timezone) == componentsTuple(date: date, time: time)
                ? candidate
                : nil
        }.sorted()

        if let candidate = candidates.first, candidates.count == 1 {
            return (candidate, nil)
        }
        if candidates.count > 1 {
            if profile.ambiguous == .earlier {
                return (candidates[0], "dst_ambiguous_earlier")
            }
            return (candidates[candidates.count - 1], "dst_ambiguous_later")
        }
        guard profile.nonexistent == .shift else {
            throw CanonicalEvaluationError.dstResolutionRejected
        }

        let beforeOffset = profile.timezone.secondsFromGMT(for: naive.addingTimeInterval(-43_200))
        let afterOffset = profile.timezone.secondsFromGMT(for: naive.addingTimeInterval(43_200))
        let gap = afterOffset - beforeOffset
        guard gap > 0 else {
            throw CanonicalEvaluationError.invalidInput("Unable to resolve nonexistent local time")
        }
        let shiftedNaive = naive.addingTimeInterval(Double(gap))
        let shifted = shiftedNaive.addingTimeInterval(Double(-afterOffset))
        return (shifted, "dst_nonexistent_shifted")
    }

    private func componentsTuple(date: LocalDate, time: LocalTime) -> [Int] {
        [date.year, date.month, date.day, time.hour, time.minute, time.second]
    }

    private func localComponents(of instant: Date, in timezone: TimeZone) -> [Int] {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = timezone
        let value = calendar.dateComponents([.year, .month, .day, .hour, .minute, .second], from: instant)
        return [value.year, value.month, value.day, value.hour, value.minute, value.second].map { $0 ?? -1 }
    }

    private func subtract(base: InstantInterval, removal: InstantInterval) -> [InstantInterval] {
        guard removal.end > base.start, removal.start < base.end else { return [base] }
        var result: [InstantInterval] = []
        if removal.start > base.start {
            result.append(InstantInterval(start: base.start, end: removal.start))
        }
        if removal.end < base.end {
            result.append(InstantInterval(start: removal.end, end: base.end))
        }
        return result
    }

    private func deduplicated(_ intervals: [InstantInterval]) -> [InstantInterval] {
        var byKey: [String: InstantInterval] = [:]
        for interval in intervals {
            byKey["\(ContractDateCodec.string(interval.start))/\(ContractDateCodec.string(interval.end))"] = interval
        }
        return byKey.values.sorted {
            $0.start == $1.start ? $0.end < $1.end : $0.start < $1.start
        }
    }

    private func output(
        included: Bool,
        reason: String,
        concrete: [InstantInterval],
        matched: [InstantInterval],
        diagnostics: [String]
    ) -> JSONValue {
        .object([
            "included": .bool(included),
            "reason_code": .string(reason),
            "concrete_intervals": .array(concrete.map(\.json)),
            "matched_intervals": .array(matched.map(\.json)),
            "diagnostics": strings(diagnostics),
        ])
    }
}

private struct PolicyContractEvaluator {
    private static let omittedSourceFields = [
        "/attachments",
        "/attendees",
        "/content/description",
        "/content/summary",
        "/content/location",
        "/content/conference",
        "/organizer",
        "/provider_metadata",
        "/source_url",
    ]

    private let input: [String: JSONValue]

    init(input: JSONValue) throws {
        self.input = try input.requiredObject("input")
    }

    func evaluate() throws -> JSONValue {
        if let invalid = try validationReason() {
            return result(selection: "invalid", operation: "none", primary: invalid, reasons: [invalid])
        }

        let policy = try input.requiredObject("policy", "input")
        let state = try policy.requiredString("state", "input.policy")
        switch state {
        case "paused":
            return result(selection: "held", operation: "none", primary: "policy_paused", reasons: ["policy_paused"])
        case "disabled":
            return result(selection: "excluded", operation: "none", primary: "policy_disabled", reasons: ["policy_disabled"])
        case "review_required":
            return result(
                selection: "held",
                operation: "none",
                primary: "policy_review_required",
                reasons: ["policy_review_required"]
            )
        default: break
        }

        let source = try input.requiredObject("source", "input")
        let lifecycle = try source.requiredString("lifecycle", "input.source")
        if lifecycle == "deleted" { return try excluded("source_deleted", sourceRemoved: true) }
        if lifecycle == "cancelled" { return try excluded("source_cancelled", sourceRemoved: true) }
        if try source.requiredString("origin", "input.source") == "planipus_managed" {
            return try excluded("managed_copy")
        }

        let selection = try policy.requiredObject("selection", "input.policy")
        let sourceEventReference = try source.requiredString("source_event_ref", "input.source")
        let manual = try selection.requiredArray("manual_exclusions", "input.policy.selection")
            .compactMap(\.stringValue)
        if manual.contains(sourceEventReference) { return try excluded("manual_exclusion") }
        if try containsNoSync(source: source, selection: selection) { return try excluded("nosync") }
        if try selection.requiredBool("skip_when_destination_identity_invited", "input.policy.selection"),
           try source.requiredBool("destination_identity_invited", "input.source") {
            return try excluded("already_invited")
        }

        let availabilityResult = try effectiveAvailability(source: source, selection: selection)
        if let omitted = availabilityResult.omitted { return try excluded(omitted) }
        var availability = availabilityResult.availability ?? "busy"
        guard let timing = source["timing"]?.objectValue else {
            return result(
                selection: "invalid",
                operation: "none",
                primary: "invalid_source_event",
                reasons: ["invalid_source_event"]
            )
        }
        let horizon = try input.requiredObject("horizon", "input")
        if try !timingInterval(timing).overlaps(
            InstantInterval(
                start: ContractDateCodec.instant(horizon.requiredString("start", "input.horizon")),
                end: ContractDateCodec.instant(horizon.requiredString("end", "input.horizon"))
            )
        ) {
            return try excluded("outside_horizon")
        }

        var selectionReasons: [String] = []
        if let reason = availabilityResult.reason { selectionReasons.append(reason) }
        let timingKind = try timing.requiredString("kind", "input.source.timing")
        if timingKind == "timed" {
            if try selection.requiredString("timed", "input.policy.selection") == "skip" {
                return try excluded("timed_event_disabled")
            }
            selectionReasons.append("timed_event_included")
        } else {
            let allDay = try selection.requiredString("all_day", "input.policy.selection")
            if allDay == "skip" { return try excluded("all_day") }
            if allDay == "busy_only", availability == "free" { return try excluded("all_day_free") }
            selectionReasons.append(allDay == "busy_only" ? "all_day_busy_included" : "all_day_included")
        }

        var warnings: [String] = []
        if availability == "free" {
            let privacy = try policy.requiredObject("privacy", "input.policy")
            let preset = try privacy.requiredString("preset", "input.policy.privacy")
            let redacted = preset == "busy_only" || preset == "commitment"
            switch try selection.requiredString("free_events", "input.policy.selection") {
            case "skip_when_redacted":
                if redacted { return try excluded("free") }
                selectionReasons.append("free_preserved")
            case "preserve_free":
                selectionReasons.append("free_preserved")
            case "force_busy":
                availability = "busy"
                selectionReasons.append("free_forced_busy")
                warnings.append("free_forced_busy")
            default:
                throw CanonicalEvaluationError.invalidInput("Invalid input.policy.selection.free_events")
            }
        }

        if timingKind == "timed" {
            let hoursPolicy = try policy.requiredObject("hours", "input.policy")
            let hoursInput = JSONValue.object([
                "mode": try hoursPolicy.required("mode", "input.policy.hours"),
                "event": .object([
                    "start": try timing.required("start_instant", "input.source.timing"),
                    "end": try timing.required("end_instant", "input.source.timing"),
                ]),
                "profile": input["hours_profile"] ?? .null,
            ])
            let hoursOutput = try HoursEvaluator(input: hoursInput).evaluate().requiredObject("hours result")
            let included = try hoursOutput.requiredBool("included", "hours result")
            let reason = try hoursOutput.requiredString("reason_code", "hours result")
            if !included { return try excluded(reason) }
            let diagnostics = try hoursOutput.requiredArray("diagnostics", "hours result").compactMap(\.stringValue)
            selectionReasons.append(contentsOf: diagnostics)
            selectionReasons.append(reason)
        }

        let projection = try input.requiredObject("projection", "input")
        let ownership = try projection.requiredString("ownership", "input.projection")
        if ownership == "detached" {
            return result(
                selection: "included",
                operation: "none",
                primary: "detached_no_action",
                reasons: selectionReasons + ["detached_no_action"],
                warnings: warnings
            )
        }
        if ownership == "ambiguous" {
            return result(
                selection: "held",
                operation: "none",
                primary: "ambiguous_ownership",
                reasons: selectionReasons + ["ambiguous_ownership"],
                warnings: warnings
            )
        }

        let transformed = try transform(
            policy: policy,
            source: source,
            timing: timing,
            projection: projection,
            availability: availability
        )
        let desiredFingerprint = try fingerprint(transformed.desired)
        let operation: String
        let operationReason: String
        if ownership == "none" {
            operation = "create"
            operationReason = "create_missing_copy"
        } else if projection["destination_exists"]?.boolValue == false {
            operation = "create"
            operationReason = "restore_destination_missing"
        } else if let observed = projection["observed_copy"], observed != transformed.desired {
            operation = "update"
            operationReason = "restore_destination_drift"
        } else if let previousFingerprint = projection["desired_fingerprint"]?.stringValue,
                  previousFingerprint != desiredFingerprint {
            operation = "update"
            operationReason = "update_source_change"
        } else {
            operation = "none"
            operationReason = "no_change"
        }

        let privacy = try policy.requiredObject("privacy", "input.policy")
        let privacyReason = switch try privacy.requiredString("preset", "input.policy.privacy") {
        case "busy_only": "privacy_busy_only"
        case "commitment": "privacy_commitment"
        case "private_details": "privacy_private_details"
        case "shared_details": "privacy_shared_details"
        default: throw CanonicalEvaluationError.invalidInput("Invalid privacy preset")
        }
        return .object([
            "selection": .string("included"),
            "operation": .string(operation),
            "primary_reason_code": .string(operationReason),
            "reason_codes": strings(unique(selectionReasons + [privacyReason, operationReason])),
            "desired_copy": transformed.desired,
            "desired_fingerprint": .string(desiredFingerprint),
            "disclosure_manifest": transformed.disclosure,
            "warnings": strings(unique(warnings)),
        ])
    }

    private func validationReason() throws -> String? {
        let policy = try input.requiredObject("policy", "input")
        if try policy.requiredString("source_calendar_ref", "input.policy")
            == policy.requiredString("destination_calendar_ref", "input.policy") {
            return "invalid_same_calendar"
        }
        let capabilities = try input.requiredObject("destination_capabilities", "input")
        if try !capabilities.requiredBool("writable", "input.destination_capabilities") {
            return "invalid_unwritable_destination"
        }
        let privacy = try policy.requiredObject("privacy", "input.policy")
        if try privacy.requiredBool("copy_attendees", "input.policy.privacy")
            || privacy.requiredBool("copy_organizer", "input.policy.privacy") {
            return "invalid_privacy_transform"
        }
        let preset = try privacy.requiredString("preset", "input.policy.privacy")
        if preset == "busy_only" || preset == "commitment" {
            if try privacy.requiredBool("copy_summary", "input.policy.privacy")
                || privacy.requiredBool("copy_description", "input.policy.privacy")
                || privacy.requiredBool("copy_location", "input.policy.privacy")
                || privacy.requiredBool("copy_conference", "input.policy.privacy") {
                return "invalid_privacy_transform"
            }
        }
        if try privacy.requiredString("generic_summary", "input.policy.privacy")
            .precomposedStringWithCanonicalMapping
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .isEmpty {
            return "invalid_privacy_transform"
        }
        if preset != "shared_details",
           try !capabilities.requiredBool("private_visibility", "input.destination_capabilities") {
            return "unsupported_destination_capability"
        }
        if try privacy.requiredBool("copy_conference", "input.policy.privacy"),
           try !capabilities.requiredBool("conference_copy", "input.destination_capabilities") {
            return "unsupported_destination_capability"
        }
        if policy["destination"]?.objectValue?["color"] != nil,
           try !capabilities.requiredBool("color", "input.destination_capabilities") {
            return "unsupported_destination_capability"
        }
        let source = try input.requiredObject("source", "input")
        if try source.requiredString("lifecycle", "input.source") == "confirmed", source["timing"] == nil {
            return "invalid_source_event"
        }
        let hours = try policy.requiredObject("hours", "input.policy")
        if try hours.requiredString("mode", "input.policy.hours") != "all_times" {
            guard let profile = input["hours_profile"]?.objectValue,
                  let expectedReference = hours["profile_ref"]?.stringValue,
                  profile["profile_ref"]?.stringValue == expectedReference else {
                return "invalid_hours_profile"
            }
        }
        return nil
    }

    private func excluded(_ reason: String, sourceRemoved: Bool = false) throws -> JSONValue {
        let projection = try input.requiredObject("projection", "input")
        switch try projection.requiredString("ownership", "input.projection") {
        case "detached":
            return result(
                selection: "excluded",
                operation: "none",
                primary: "detached_no_action",
                reasons: [reason, "detached_no_action"]
            )
        case "ambiguous":
            return result(
                selection: "held",
                operation: "none",
                primary: "ambiguous_ownership",
                reasons: [reason, "ambiguous_ownership"]
            )
        case "attached":
            let effect = sourceRemoved ? "delete_source_removed" : "delete_policy_exclusion"
            return result(selection: "excluded", operation: "delete", primary: effect, reasons: [reason, effect])
        default:
            return result(selection: "excluded", operation: "none", primary: reason, reasons: [reason])
        }
    }

    private func result(
        selection: String,
        operation: String,
        primary: String,
        reasons: [String],
        warnings: [String] = []
    ) -> JSONValue {
        .object([
            "selection": .string(selection),
            "operation": .string(operation),
            "primary_reason_code": .string(primary),
            "reason_codes": strings(unique(reasons)),
            "warnings": strings(unique(warnings)),
        ])
    }

    private func containsNoSync(
        source: [String: JSONValue],
        selection: [String: JSONValue]
    ) throws -> Bool {
        let marker = try selection.requiredString("source_exclusion_marker", "input.policy.selection")
            .precomposedStringWithCanonicalMapping
            .lowercased()
        guard !marker.isEmpty else { return false }
        let escaped = NSRegularExpression.escapedPattern(for: marker)
        let expression = try NSRegularExpression(
            pattern: "(?<![\\p{L}\\p{N}_])\(escaped)(?![\\p{L}\\p{N}_])",
            options: [.caseInsensitive]
        )
        let content = try source.requiredObject("content", "input.source")
        let relationship = try source.requiredObject("relationship", "input.source")
        let fields = [
            content["summary"]?.stringValue,
            content["description"]?.stringValue,
            relationship["response_note"]?.stringValue,
        ].compactMap { $0?.precomposedStringWithCanonicalMapping.lowercased() }
        return fields.contains { value in
            expression.firstMatch(in: value, range: NSRange(value.startIndex..., in: value)) != nil
        }
    }

    private func effectiveAvailability(
        source: [String: JSONValue],
        selection: [String: JSONValue]
    ) throws -> (availability: String?, reason: String?, omitted: String?) {
        let relationship = try source.requiredObject("relationship", "input.source")
        switch try relationship.requiredString("role", "input.source.relationship") {
        case "organizer":
            return ("busy", "organizer_assumed_accepted", nil)
        case "attendee":
            switch try relationship.requiredString("response", "input.source.relationship") {
            case "declined": return (nil, nil, "rsvp_declined")
            case "accepted": return ("busy", "rsvp_accepted", nil)
            case "tentative":
                switch try selection.requiredString("tentative", "input.policy.selection") {
                case "omit": return (nil, nil, "rsvp_tentative_omitted")
                case "busy": return ("busy", "rsvp_tentative_busy", nil)
                case "free": return ("free", "rsvp_tentative_free", nil)
                default: throw CanonicalEvaluationError.invalidInput("Invalid tentative selection")
                }
            case "needs_action":
                switch try selection.requiredString("unanswered", "input.policy.selection") {
                case "omit": return (nil, nil, "rsvp_unanswered_omitted")
                case "busy": return ("busy", "rsvp_unanswered_busy", nil)
                case "free": return ("free", "rsvp_unanswered_free", nil)
                default: throw CanonicalEvaluationError.invalidInput("Invalid unanswered selection")
                }
            default: break
            }
        default: break
        }
        return (source["availability"]?.stringValue ?? "busy", nil, nil)
    }

    private func timingInterval(_ timing: [String: JSONValue]) throws -> InstantInterval {
        let kind = try timing.requiredString("kind", "input.source.timing")
        if kind == "timed" {
            return InstantInterval(
                start: try ContractDateCodec.instant(timing.requiredString("start_instant", "input.source.timing")),
                end: try ContractDateCodec.instant(timing.requiredString("end_instant", "input.source.timing"))
            )
        }
        let timezoneIdentifier = try timing.requiredString("timezone", "input.source.timing")
        guard let timezone = TimeZone(identifier: timezoneIdentifier) else {
            throw CanonicalEvaluationError.invalidTimezone(timezoneIdentifier)
        }
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = timezone
        let startDate = try LocalDate(timing.requiredString("start_date", "input.source.timing"))
        let endDate = try LocalDate(timing.requiredString("end_date", "input.source.timing"))
        guard let start = calendar.date(from: startDate.components),
              let end = calendar.date(from: endDate.components) else {
            throw CanonicalEvaluationError.invalidInput("Invalid all-day timing")
        }
        return InstantInterval(start: start, end: end)
    }

    private func transform(
        policy: [String: JSONValue],
        source: [String: JSONValue],
        timing: [String: JSONValue],
        projection: [String: JSONValue],
        availability: String
    ) throws -> (desired: JSONValue, disclosure: JSONValue) {
        let privacy = try policy.requiredObject("privacy", "input.policy")
        let preset = try privacy.requiredString("preset", "input.policy.privacy")
        let details = preset == "private_details" || preset == "shared_details"
        let content = try source.requiredObject("content", "input.source")
        let copySummary = try privacy.requiredBool("copy_summary", "input.policy.privacy")
        let genericSummary = try privacy.requiredString("generic_summary", "input.policy.privacy")
        let copyDescription = try privacy.requiredBool("copy_description", "input.policy.privacy")
        let copyLocation = try privacy.requiredBool("copy_location", "input.policy.privacy")
        let copyConference = try privacy.requiredBool("copy_conference", "input.policy.privacy")
        var desired: [String: JSONValue] = [
            "timing": .object(timing),
            "summary": .string(
                details && copySummary
                    ? (content["summary"]?.stringValue ?? "")
                    : genericSummary
            ),
            "transparency": .string(availability == "free" ? "transparent" : "opaque"),
            "visibility": .string(preset == "shared_details" ? "default" : "private"),
            "reminders": .array([]),
            "write_controls": .object(["send_notifications": .bool(false)]),
            "provenance": .object([
                "version": .number(1),
                "policy_ref": .string(try policy.requiredString("policy_ref", "input.policy")),
                "projection_ref": .string(
                    projection["projection_ref"]?.stringValue
                        ?? input["candidate_projection_ref"]?.stringValue
                        ?? ""
                ),
                "generation": .number(Double(projection["generation"]?.intValue ?? 1)),
            ]),
        ]
        if details,
           copyDescription,
           let value = content["description"] {
            desired["description"] = value
        }
        if details,
           copyLocation,
           let value = content["location"] {
            desired["location"] = value
        }
        if details,
           copyConference,
           let value = content["conference"] {
            desired["conference"] = value
        }
        if let color = policy["destination"]?.objectValue?["color"] {
            desired["color"] = color
        }

        var sourceFieldsRead = [
            "/availability",
            "/content/description",
            "/content/summary",
            "/destination_identity_invited",
            "/origin",
            "/relationship",
            "/timing",
        ]
        if source["recurrence"] != nil { sourceFieldsRead.append("/recurrence") }
        var disclosed = ["/timing"]
        if details && copySummary { disclosed.append("/content/summary") }
        if details && copyDescription {
            disclosed.append("/content/description")
        }
        if details && copyLocation {
            disclosed.append("/content/location")
            sourceFieldsRead.append("/content/location")
        }
        if details && copyConference {
            disclosed.append("/content/conference")
            sourceFieldsRead.append("/content/conference")
        }
        let destinationFields = desired.keys.map { "/\($0)" }.sorted()
        let omitted = Self.omittedSourceFields.filter { !disclosed.contains($0) }.sorted()
        let disclosure: JSONValue = .object([
            "version": .number(1),
            "preset": .object(["id": .string(preset), "version": .number(1)]),
            "source_fields_read": strings(Array(Set(sourceFieldsRead)).sorted()),
            "source_fields_disclosed": strings(Array(Set(disclosed)).sorted()),
            "destination_fields_written": strings(destinationFields),
            "source_fields_omitted": strings(omitted),
        ])
        return (.object(desired), disclosure)
    }

    private func fingerprint(_ value: JSONValue) throws -> String {
        try CanonicalJSONCodec.fingerprint(value)
    }
}
