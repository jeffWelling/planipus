import Foundation

public struct CalendarSyncFixture: Codable, Sendable {
    public var caseName: String
    public var now: Date
    public var policy: SyncPolicy
    public var source: SourceEvent
    public var existingProjection: FixtureProjection?
    public var expectedDecision: PolicyAction
    public var expectedReasonCodes: [String]
    public var expectedDisclosure: [String]
    public var expectedProviderShape: JSONValue?

    public init(
        caseName: String,
        now: Date,
        policy: SyncPolicy,
        source: SourceEvent,
        existingProjection: FixtureProjection? = nil,
        expectedDecision: PolicyAction,
        expectedReasonCodes: [String],
        expectedDisclosure: [String],
        expectedProviderShape: JSONValue? = nil
    ) {
        self.caseName = caseName
        self.now = now
        self.policy = policy
        self.source = source
        self.existingProjection = existingProjection
        self.expectedDecision = expectedDecision
        self.expectedReasonCodes = expectedReasonCodes
        self.expectedDisclosure = expectedDisclosure
        self.expectedProviderShape = expectedProviderShape
    }

    enum CodingKeys: String, CodingKey {
        case caseName = "case"
        case now, policy, source, existingProjection
        case expectedDecision, expectedReasonCodes, expectedDisclosure, expectedProviderShape
    }
}

public struct FixtureProjection: Codable, Sendable {
    public var destinationEventID: String

    public init(destinationEventID: String) {
        self.destinationEventID = destinationEventID
    }
}

public enum JSONValue: Codable, Sendable, Equatable {
    case object([String: JSONValue])
    case array([JSONValue])
    case string(String)
    case number(Double)
    case bool(Bool)
    case null

    public init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if container.decodeNil() { self = .null }
        else if let value = try? container.decode(Bool.self) { self = .bool(value) }
        else if let value = try? container.decode(Double.self) { self = .number(value) }
        else if let value = try? container.decode(String.self) { self = .string(value) }
        else if let value = try? container.decode([JSONValue].self) { self = .array(value) }
        else { self = .object(try container.decode([String: JSONValue].self)) }
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case .object(let value): try container.encode(value)
        case .array(let value): try container.encode(value)
        case .string(let value): try container.encode(value)
        case .number(let value): try container.encode(value)
        case .bool(let value): try container.encode(value)
        case .null: try container.encodeNil()
        }
    }
}

public enum ConformanceFixtureCodec {
    public static func decode(_ data: Data) throws -> CalendarSyncFixture {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return try decoder.decode(CalendarSyncFixture.self, from: data)
    }

    public static func encode(_ fixture: CalendarSyncFixture) throws -> Data {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
        return try encoder.encode(fixture)
    }
}

// MARK: - Shared calendar-sync/v1 bundle compatibility

public struct CanonicalCaseBundle: Codable, Sendable {
    public var contractVersion: Int
    public var kind: String
    public var defaults: CanonicalDefaults
    public var cases: [CanonicalCase]

    public init(
        contractVersion: Int,
        kind: String,
        defaults: CanonicalDefaults,
        cases: [CanonicalCase]
    ) {
        self.contractVersion = contractVersion
        self.kind = kind
        self.defaults = defaults
        self.cases = cases
    }

    enum CodingKeys: String, CodingKey {
        case contractVersion = "contract_version"
        case kind, defaults, cases
    }

    /// Applies RFC 7396 JSON Merge Patch. Non-object patches replace their base
    /// value, while a `null` object member removes the inherited member.
    public func materializedInput(caseID: String) throws -> JSONValue {
        guard let fixtureCase = cases.first(where: { $0.caseID == caseID }) else {
            throw CanonicalFixtureError.unknownCase(caseID)
        }
        return defaults.input.merging(fixtureCase.inputPatch)
    }
}

public struct CanonicalDefaults: Codable, Sendable {
    public var input: JSONValue

    public init(input: JSONValue) { self.input = input }
}

public struct CanonicalCase: Codable, Sendable {
    public var caseID: String
    public var title: String
    public var requirements: [String]
    public var inputPatch: JSONValue
    public var expected: JSONValue

    public init(
        caseID: String,
        title: String,
        requirements: [String],
        inputPatch: JSONValue,
        expected: JSONValue
    ) {
        self.caseID = caseID
        self.title = title
        self.requirements = requirements
        self.inputPatch = inputPatch
        self.expected = expected
    }

    enum CodingKeys: String, CodingKey {
        case caseID = "case_id"
        case title, requirements
        case inputPatch = "input_patch"
        case expected
    }
}

public enum CanonicalFixtureError: Error, Equatable, Sendable {
    case unknownCase(String)
}

public extension JSONValue {
    func merging(_ patch: JSONValue) -> JSONValue {
        guard case .object(let patchObject) = patch else { return patch }
        var merged: [String: JSONValue]
        if case .object(let baseObject) = self {
            merged = baseObject
        } else {
            merged = [:]
        }
        for (key, patchValue) in patchObject {
            if case .null = patchValue {
                merged.removeValue(forKey: key)
                continue
            }
            merged[key] = (merged[key] ?? .null).merging(patchValue)
        }
        return .object(merged)
    }
}

public enum CanonicalFixtureCodec {
    public static func decodeBundle(_ data: Data) throws -> CanonicalCaseBundle {
        try JSONDecoder().decode(CanonicalCaseBundle.self, from: data)
    }

    public static func encodeBundle(_ bundle: CanonicalCaseBundle) throws -> Data {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
        return try encoder.encode(bundle)
    }
}
