import CryptoKit
import Foundation
import PlanipusCore

public enum GoogleEventID {
    /// Google permits lowercase base32hex characters (`0-9`, `a-v`) for event IDs.
    /// The installation identifier intentionally makes separately configured
    /// Planipus installations distinct authorities.
    public static func deterministic(
        installationID: String,
        policyID: String,
        sourceCalendarID: String,
        sourceEventID: String,
        occurrenceID: String?
    ) -> String {
        let canonical = [
            "planipus-google-event-v1",
            installationID,
            policyID,
            sourceCalendarID,
            sourceEventID,
            occurrenceID ?? "master",
        ].joined(separator: "\u{1f}")
        let digest = SHA256.hash(data: Data(canonical.utf8))
        return "p" + base32Hex(Data(digest))
    }

    private static func base32Hex(_ data: Data) -> String {
        let alphabet = Array("0123456789abcdefghijklmnopqrstuv")
        var accumulator = 0
        var bitCount = 0
        var output = ""
        output.reserveCapacity((data.count * 8 + 4) / 5)

        for byte in data {
            accumulator = (accumulator << 8) | Int(byte)
            bitCount += 8
            while bitCount >= 5 {
                bitCount -= 5
                output.append(alphabet[(accumulator >> bitCount) & 0x1f])
                accumulator &= (1 << bitCount) - 1
            }
        }
        if bitCount > 0 {
            output.append(alphabet[(accumulator << (5 - bitCount)) & 0x1f])
        }
        return output
    }
}
