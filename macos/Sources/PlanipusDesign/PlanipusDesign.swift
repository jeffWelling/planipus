import SwiftUI

public enum PlanipusPalette {
    public static let ink = Color(red: 0.14, green: 0.16, blue: 0.22)
    public static let mutedInk = Color(red: 0.38, green: 0.40, blue: 0.47)
    public static let lavender = Color(red: 0.45, green: 0.38, blue: 0.78)
    public static let lavenderWash = Color(red: 0.93, green: 0.91, blue: 0.99)
    public static let mint = Color(red: 0.20, green: 0.63, blue: 0.50)
    public static let mintWash = Color(red: 0.90, green: 0.97, blue: 0.94)
    public static let warmSurface = Color(red: 0.98, green: 0.97, blue: 0.95)
    public static let line = Color.primary.opacity(0.10)
}

public struct SoftCardModifier: ViewModifier {
    public init() {}

    public func body(content: Content) -> some View {
        content
            .padding(18)
            .background(.background.opacity(0.92), in: RoundedRectangle(cornerRadius: 18))
            .overlay {
                RoundedRectangle(cornerRadius: 18)
                    .stroke(PlanipusPalette.line, lineWidth: 1)
            }
            .shadow(color: .black.opacity(0.035), radius: 12, y: 5)
    }
}

public extension View {
    func planipusCard() -> some View { modifier(SoftCardModifier()) }
}

public struct StatusLozenge: View {
    private let text: String
    private let color: Color

    public init(_ text: String, color: Color = PlanipusPalette.mint) {
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
        .background(color.opacity(0.12), in: Capsule())
    }
}

public struct PlanipusMark: View {
    public init() {}

    public var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 13)
                .fill(PlanipusPalette.lavender.gradient)
            Image(systemName: "calendar.badge.clock")
                .font(.system(size: 22, weight: .semibold))
                .foregroundStyle(.white)
        }
        .frame(width: 46, height: 46)
        .accessibilityLabel("Planipus")
    }
}
