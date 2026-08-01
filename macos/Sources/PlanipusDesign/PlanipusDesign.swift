import SwiftUI

/// The Planipus palette, sampled from the Pip artwork.
///
/// Every value here exists somewhere on the mascot, which is what makes the
/// two editions read as one product. The neutral is deliberately not grey:
/// Pip is outlined in a deep teal-navy, never black, so rules and body text
/// inherit that hue and the interface belongs to him even on screens where he
/// does not appear.
///
/// The web edition carries the same six values as CSS custom properties in
/// `web/src/styles.css`. Changing a colour means changing it in both places;
/// there is no shared build step between the editions by design.
public enum PlanipusPalette {

    // MARK: Ground

    /// Window background. A shade deeper than `paper` so raised surfaces read.
    public static let canvas = Color(.sRGB, red: 0.969, green: 0.933, blue: 0.867)
    /// Raised surfaces: cards, sheets, popovers. Pip's own cream — it is his
    /// eye-whites and the card he holds.
    public static let paper = Color(.sRGB, red: 0.992, green: 0.965, blue: 0.910)
    /// Recessed wells and table headers.
    public static let paperDeep = Color(.sRGB, red: 0.937, green: 0.878, blue: 0.776)

    // MARK: Ink

    /// Body text and Pip's outline colour.
    public static let ink = Color(.sRGB, red: 0.071, green: 0.227, blue: 0.278)
    /// Secondary text.
    public static let mutedInk = Color(.sRGB, red: 0.424, green: 0.561, blue: 0.608)
    /// Hairlines. Ink at low opacity rather than a separate grey, so rules
    /// stay in the same hue family as the text they separate.
    public static let rule = Color(.sRGB, red: 0.071, green: 0.227, blue: 0.278).opacity(0.16)

    // MARK: Signal

    /// You act here. Pip's body colour, reserved for primary actions.
    public static let accent = Color(.sRGB, red: 0.949, green: 0.396, blue: 0.133)
    /// Pressed and hover states for `accent`.
    public static let accentDeep = Color(.sRGB, red: 0.784, green: 0.271, blue: 0.102)
    /// Tint behind an accent element.
    public static let accentWash = Color(.sRGB, red: 0.992, green: 0.929, blue: 0.894)

    /// Sensed, not read. Pip's bill and feet: the colour of knowing an event
    /// is there without reading it. Used for free/busy, availability and any
    /// state derived from opaque provider data.
    public static let sensed = Color(.sRGB, red: 0.106, green: 0.604, blue: 0.682)
    /// Held private — deepest disclosure tier, never leaves the machine.
    public static let held = Color(.sRGB, red: 0.055, green: 0.443, blue: 0.510)
    /// Tint behind a sensed element.
    public static let sensedWash = Color(.sRGB, red: 0.863, green: 0.929, blue: 0.941)

    /// Needs a look. Pip's belly. Never used alone to convey state — every
    /// status carries a word as well as a colour.
    public static let attention = Color(.sRGB, red: 0.976, green: 0.698, blue: 0.200)

    // MARK: Compatibility

    @available(*, deprecated, renamed: "paper")
    public static let warmSurface = paper
    @available(*, deprecated, renamed: "rule")
    public static let line = rule
    @available(*, deprecated, renamed: "accent", message: "Planipus is no longer purple; see DESIGN-DIRECTIONS.md")
    public static let lavender = accent
    @available(*, deprecated, renamed: "accentWash")
    public static let lavenderWash = accentWash
    @available(*, deprecated, renamed: "sensed")
    public static let mint = sensed
    @available(*, deprecated, renamed: "sensedWash")
    public static let mintWash = sensedWash
}

/// Display face for headings. Superclarendon is a slab serif that ships with
/// macOS — sturdy and a little Victorian-naturalist, which answers Pip's
/// glasses. No webfont is loaded on either edition, so nothing phones home.
public enum PlanipusType {
    public static func display(_ size: CGFloat, weight: Font.Weight = .semibold) -> Font {
        .custom("Superclarendon", size: size).weight(weight)
    }

    public static func body(_ size: CGFloat, weight: Font.Weight = .regular) -> Font {
        .custom("Seravek", size: size).weight(weight)
    }

    /// Times, counts and reason codes. Tabular figures so columns line up.
    public static func data(_ size: CGFloat) -> Font {
        .system(size: size, design: .monospaced).monospacedDigit()
    }
}

public struct SoftCardModifier: ViewModifier {
    public init() {}

    public func body(content: Content) -> some View {
        content
            .padding(18)
            .background(PlanipusPalette.paper, in: RoundedRectangle(cornerRadius: 14))
            .overlay {
                RoundedRectangle(cornerRadius: 14)
                    .stroke(PlanipusPalette.rule, lineWidth: 1)
            }
            .shadow(color: PlanipusPalette.ink.opacity(0.06), radius: 10, y: 4)
    }
}

public extension View {
    func planipusCard() -> some View { modifier(SoftCardModifier()) }
}

public struct StatusLozenge: View {
    private let text: String
    private let color: Color

    public init(_ text: String, color: Color = PlanipusPalette.sensed) {
        self.text = text
        self.color = color
    }

    public var body: some View {
        HStack(spacing: 6) {
            Circle().fill(color).frame(width: 7, height: 7)
            Text(text).font(.caption.weight(.medium))
        }
        .foregroundStyle(PlanipusPalette.ink)
        .padding(.horizontal, 10)
        .padding(.vertical, 6)
        .background(color.opacity(0.14), in: Capsule())
    }
}

/// The small Planipus mark used where the full mascot would be too large.
///
/// Previously a lavender gradient, which matched neither Pip nor the web
/// edition. It is now Pip's outline colour carrying his orange, so the mark
/// belongs to the same world as the mascot standing beside it.
public struct PlanipusMark: View {
    private let size: CGFloat

    public init(size: CGFloat = 46) {
        self.size = size
    }

    public var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: size * 0.28)
                .fill(PlanipusPalette.ink)
            Image(systemName: "calendar.badge.clock")
                .font(.system(size: size * 0.48, weight: .semibold))
                .foregroundStyle(PlanipusPalette.accent)
        }
        .frame(width: size, height: size)
        .accessibilityLabel("Planipus")
    }
}

/// How much of an event reaches the destination, drawn as depth in water.
///
/// The signature device of the Riverbank direction: how far a band sits from
/// the surface *is* its disclosure tier, so the privacy model is legible
/// without a legend. Surface is what anyone can see; the deepest band never
/// leaves this machine.
public struct DisclosureDepth: View {
    private let surfaceLabel: String
    private let shallowLabel: String
    private let deepLabel: String

    public init(surface: String, shallow: String, deep: String) {
        self.surfaceLabel = surface
        self.shallowLabel = shallow
        self.deepLabel = deep
    }

    public var body: some View {
        VStack(spacing: 0) {
            band(surfaceLabel, fill: PlanipusPalette.attention.opacity(0.30), text: PlanipusPalette.ink)
            band(shallowLabel, fill: PlanipusPalette.sensed.opacity(0.32), text: PlanipusPalette.ink)
            band(deepLabel, fill: PlanipusPalette.held.opacity(0.85), text: PlanipusPalette.paper)
        }
        .clipShape(RoundedRectangle(cornerRadius: 8))
        .overlay {
            RoundedRectangle(cornerRadius: 8).stroke(PlanipusPalette.rule, lineWidth: 1)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(
            "Disclosure. Published: \(surfaceLabel). Label only: \(shallowLabel). Never sent: \(deepLabel)."
        )
    }

    private func band(_ label: String, fill: Color, text: Color) -> some View {
        Text(label)
            .font(PlanipusType.data(10))
            .foregroundStyle(text)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 10)
            .padding(.vertical, 7)
            .background(fill)
    }
}
