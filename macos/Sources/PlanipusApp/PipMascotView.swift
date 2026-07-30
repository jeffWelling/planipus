import AppKit
import SwiftUI

enum PipMascotState: String {
    case idle
    case attention
    case syncing

    var accessibilityLabel: String {
        switch self {
        case .idle:
            "Pip is happy and content"
        case .attention:
            "Pip wants your attention"
        case .syncing:
            "Pip is comparing three calendars"
        }
    }
}

struct PipMascotView: View {
    let state: PipMascotState
    var size: CGFloat = 150

    var body: some View {
        Group {
            if let image = Self.image(for: state) {
                Image(nsImage: image)
                    .resizable()
                    .interpolation(.high)
                    .scaledToFit()
            } else {
                Image(systemName: "calendar.badge.clock")
                    .resizable()
                    .scaledToFit()
                    .padding(size * 0.22)
                    .foregroundStyle(.secondary)
            }
        }
        .frame(width: size, height: size)
        .id(state)
        .transition(.opacity.combined(with: .scale(scale: 0.97)))
        .accessibilityLabel(state.accessibilityLabel)
    }

    private static func image(for state: PipMascotState) -> NSImage? {
        let resourceName = "pip-\(state.rawValue)"
        let url = Bundle.module.url(
            forResource: resourceName,
            withExtension: "png",
            subdirectory: "Mascot"
        ) ?? Bundle.module.url(forResource: resourceName, withExtension: "png")
        return url.flatMap(NSImage.init(contentsOf:))
    }
}
