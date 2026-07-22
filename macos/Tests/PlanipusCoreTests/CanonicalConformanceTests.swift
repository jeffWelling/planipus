import Foundation
import PlanipusCore
import XCTest

final class CanonicalConformanceTests: XCTestCase {
    private struct Manifest: Decodable {
        struct Entry: Decodable {
            let caseID: String
            let kind: String
            let path: String

            enum CodingKeys: String, CodingKey {
                case caseID = "case_id"
                case kind, path
            }
        }

        let contractVersion: Int
        let cases: [Entry]

        enum CodingKeys: String, CodingKey {
            case contractVersion = "contract_version"
            case cases
        }
    }

    private struct Registry: Decodable {
        struct Entry: Decodable { let id: String }
        let contractVersion: Int
        let entries: [Entry]

        enum CodingKeys: String, CodingKey {
            case contractVersion = "contract_version"
            case entries
        }
    }

    private var contractRoot: URL {
        URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .appendingPathComponent("conformance/calendar-sync/v1", isDirectory: true)
    }

    func testManifestAndBundlesAreAClosedNinetyOneCaseContract() throws {
        let manifest = try loadManifest()
        XCTAssertEqual(manifest.contractVersion, 1)
        XCTAssertEqual(manifest.cases.count, 91)
        XCTAssertEqual(Set(manifest.cases.map(\.caseID)).count, 91, "Manifest case IDs must be unique")

        let paths = Set(manifest.cases.map(\.path))
        XCTAssertEqual(
            paths,
            try caseBundlePathsOnDisk(),
            "Every cases/**/*.json bundle must be listed by the manifest"
        )
        var bundledCaseIDs: [String] = []
        for path in paths {
            let bundle = try loadBundle(path)
            XCTAssertEqual(bundle.contractVersion, 1, path)
            let manifestEntries = manifest.cases.filter { $0.path == path }
            XCTAssertEqual(Set(manifestEntries.map(\.kind)), [bundle.kind], path)
            XCTAssertEqual(
                Set(bundle.cases.map(\.caseID)),
                Set(manifestEntries.map(\.caseID)),
                "Manifest must list every and only case from \(path)"
            )
            bundledCaseIDs.append(contentsOf: bundle.cases.map(\.caseID))
        }
        XCTAssertEqual(bundledCaseIDs.count, 91)
        XCTAssertEqual(Set(bundledCaseIDs).count, 91, "Bundle case IDs must be globally unique")
        XCTAssertEqual(Set(bundledCaseIDs), Set(manifest.cases.map(\.caseID)))
    }

    func testEveryCanonicalV1CaseExecutesAndMatchesExpectedAssertions() throws {
        let manifest = try loadManifest()
        let bundles = try Dictionary(
            uniqueKeysWithValues: Set(manifest.cases.map(\.path)).map { ($0, try loadBundle($0)) }
        )
        let reasonCodes = try loadRegistry("reason-codes.json")
        let privacyPresets = try loadRegistry("privacy-presets.json")
        let disclosureFields = try loadRegistry("disclosure-fields.json")
        let evaluator = CanonicalCalendarSyncEvaluator()
        var executed: [String] = []

        for entry in manifest.cases {
            guard let bundle = bundles[entry.path] else {
                XCTFail("Missing bundle \(entry.path) for \(entry.caseID)")
                continue
            }
            guard let fixture = bundle.cases.first(where: { $0.caseID == entry.caseID }) else {
                XCTFail("Missing case \(entry.caseID) in \(entry.path)")
                continue
            }
            do {
                let input = try bundle.materializedInput(caseID: entry.caseID)
                let output = try evaluator.evaluate(kind: entry.kind, input: input)
                assertExpected(fixture.expected, output: output, caseID: entry.caseID)
                assertRegisteredVocabulary(
                    output,
                    reasonCodes: reasonCodes,
                    privacyPresets: privacyPresets,
                    disclosureFields: disclosureFields,
                    caseID: entry.caseID
                )
                executed.append(entry.caseID)
            } catch {
                XCTFail("\(entry.caseID) did not execute: \(error)")
            }
        }

        XCTAssertEqual(executed.count, 91, "Every manifest case must execute")
        XCTAssertEqual(Set(executed), Set(manifest.cases.map(\.caseID)))
    }

    func testCanonicalFingerprintMatchesTheLanguageNeutralKnownVector() throws {
        let value: JSONValue = .object([
            "b": .number(2),
            "a": .string("e\u{0301}"),
        ])
        XCTAssertEqual(
            String(decoding: try CanonicalJSONCodec.encode(value), as: UTF8.self),
            #"{"a":"é","b":2}"#
        )
        XCTAssertEqual(
            try CanonicalJSONCodec.fingerprint(value),
            "sha256:06c264c46ad5ada9493abd3aa2383fb205ae99d7d0bad40b03a43bfec8a1b8de"
        )
        XCTAssertThrowsError(try CanonicalJSONCodec.encode(.number(9_007_199_254_740_992)))
    }

    private func loadManifest() throws -> Manifest {
        let data = try Data(contentsOf: contractRoot.appendingPathComponent("manifest.json"))
        return try JSONDecoder().decode(Manifest.self, from: data)
    }

    private func caseBundlePathsOnDisk() throws -> Set<String> {
        let casesRoot = contractRoot.appendingPathComponent("cases", isDirectory: true)
        guard let enumerator = FileManager.default.enumerator(
            at: casesRoot,
            includingPropertiesForKeys: [.isRegularFileKey],
            options: [.skipsHiddenFiles]
        ) else {
            throw CocoaError(.fileReadNoSuchFile)
        }
        var paths: Set<String> = []
        for case let url as URL in enumerator {
            guard url.pathExtension == "json",
                  try url.resourceValues(forKeys: [.isRegularFileKey]).isRegularFile == true
            else { continue }
            let prefix = contractRoot.standardizedFileURL.path + "/"
            guard url.standardizedFileURL.path.hasPrefix(prefix) else {
                throw CocoaError(.fileReadInvalidFileName)
            }
            paths.insert(String(url.standardizedFileURL.path.dropFirst(prefix.count)))
        }
        return paths
    }

    private func loadBundle(_ path: String) throws -> CanonicalCaseBundle {
        try CanonicalFixtureCodec.decodeBundle(
            Data(contentsOf: contractRoot.appendingPathComponent(path))
        )
    }

    private func loadRegistry(_ name: String) throws -> Set<String> {
        let data = try Data(contentsOf: contractRoot.appendingPathComponent("registries/\(name)"))
        let registry = try JSONDecoder().decode(Registry.self, from: data)
        XCTAssertEqual(registry.contractVersion, 1, name)
        XCTAssertEqual(Set(registry.entries.map(\.id)).count, registry.entries.count, "Duplicate ID in \(name)")
        return Set(registry.entries.map(\.id))
    }

    private func assertExpected(_ expectedValue: JSONValue, output: JSONValue, caseID: String) {
        guard case .object(let expected) = expectedValue,
              case .object(let actual) = output else {
            XCTFail("\(caseID): expected and output must be objects")
            return
        }

        for key in ["included", "reason_code", "selection", "operation", "primary_reason_code"] {
            if let expectedValue = expected[key] {
                XCTAssertEqual(actual[key], expectedValue, "\(caseID): \(key)")
            }
        }
        assertIncludes(expected["diagnostics_include"], in: actual["diagnostics"], caseID: caseID, field: "diagnostics")
        assertIncludes(expected["reason_codes_include"], in: actual["reason_codes"], caseID: caseID, field: "reason_codes")
        assertIncludes(expected["warnings_include"], in: actual["warnings"], caseID: caseID, field: "warnings")

        if let expectedIntervals = expected["matched_intervals"] {
            XCTAssertEqual(actual["matched_intervals"], expectedIntervals, "\(caseID): matched_intervals")
        }

        let desired = object(actual["desired_copy"])
        if let fields = object(expected["desired_fields"]) {
            XCTAssertNotNil(desired, "\(caseID): desired_copy is required")
            for (field, expectedValue) in fields {
                XCTAssertEqual(desired?[field], expectedValue, "\(caseID): desired_copy.\(field)")
            }
        }
        if let absentFields = array(expected["desired_absent_fields"])?.compactMap(string) {
            for field in absentFields {
                XCTAssertNil(desired?[field], "\(caseID): desired_copy.\(field) must be absent")
            }
        }
        if let timing = expected["desired_timing"] {
            XCTAssertEqual(desired?["timing"], timing, "\(caseID): desired_copy.timing")
        }
        if let transparency = expected["desired_transparency"] {
            XCTAssertEqual(desired?["transparency"], transparency, "\(caseID): desired_copy.transparency")
        }

        if let disclosed = array(expected["disclosed_fields_include"])?.compactMap(string) {
            let manifest = object(actual["disclosure_manifest"])
            let actualDisclosed = Set(array(manifest?["source_fields_disclosed"])?.compactMap(string) ?? [])
            for field in disclosed {
                XCTAssertTrue(actualDisclosed.contains(field), "\(caseID): missing disclosed field \(field)")
            }
        }

        if let forbidden = array(expected["forbidden_values"])?.compactMap(string) {
            let outputStrings = recursivelyCollectedStrings(output)
            for sentinel in forbidden {
                XCTAssertFalse(
                    outputStrings.contains(where: { $0.contains(sentinel) }),
                    "\(caseID): output disclosed forbidden value \(sentinel)"
                )
            }
        }
    }

    private func assertRegisteredVocabulary(
        _ output: JSONValue,
        reasonCodes: Set<String>,
        privacyPresets: Set<String>,
        disclosureFields: Set<String>,
        caseID: String
    ) {
        guard let actual = object(output) else { return }
        var emittedReasons = array(actual["reason_codes"])?.compactMap(string) ?? []
        if let primary = string(actual["primary_reason_code"]) { emittedReasons.append(primary) }
        if let hoursReason = string(actual["reason_code"]) { emittedReasons.append(hoursReason) }
        emittedReasons.append(contentsOf: array(actual["diagnostics"])?.compactMap(string) ?? [])
        emittedReasons.append(contentsOf: array(actual["warnings"])?.compactMap(string) ?? [])
        for reason in emittedReasons {
            XCTAssertTrue(reasonCodes.contains(reason), "\(caseID): unregistered reason code \(reason)")
        }

        guard let disclosure = object(actual["disclosure_manifest"]) else { return }
        let preset = object(disclosure["preset"]).flatMap { string($0["id"]) }
        if let preset {
            XCTAssertTrue(privacyPresets.contains(preset), "\(caseID): unregistered privacy preset \(preset)")
        }
        let disclosed = array(disclosure["source_fields_disclosed"])?.compactMap(string) ?? []
        let omitted = array(disclosure["source_fields_omitted"])?.compactMap(string) ?? []
        for field in disclosed + omitted {
            XCTAssertTrue(disclosureFields.contains(field), "\(caseID): unregistered disclosure field \(field)")
        }
    }

    private func assertIncludes(
        _ expectedValue: JSONValue?,
        in actualValue: JSONValue?,
        caseID: String,
        field: String
    ) {
        guard let expected = array(expectedValue) else { return }
        let actual = array(actualValue) ?? []
        for value in expected {
            XCTAssertTrue(actual.contains(value), "\(caseID): \(field) must include \(value)")
        }
    }

    private func object(_ value: JSONValue?) -> [String: JSONValue]? {
        guard case .object(let object) = value else { return nil }
        return object
    }

    private func array(_ value: JSONValue?) -> [JSONValue]? {
        guard case .array(let array) = value else { return nil }
        return array
    }

    private func string(_ value: JSONValue?) -> String? {
        guard case .string(let string) = value else { return nil }
        return string
    }

    private func recursivelyCollectedStrings(_ value: JSONValue) -> [String] {
        switch value {
        case .string(let value): return [value]
        case .array(let values): return values.flatMap(recursivelyCollectedStrings)
        case .object(let values): return values.values.flatMap(recursivelyCollectedStrings)
        default: return []
        }
    }
}
