import AppKit
import PlanipusDesign
import SwiftUI

struct MenuBarContent: View {
    @EnvironmentObject private var model: AppModel
    @Environment(\.openWindow) private var openWindow

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack {
                PlanipusMark()
                VStack(alignment: .leading, spacing: 2) {
                    Text("Planipus").font(.headline)
                    Text(model.lifecycle.rawValue).font(.caption).foregroundStyle(.secondary)
                }
            }
            Divider()
            if let bridge = model.bridges.first {
                VStack(alignment: .leading, spacing: 5) {
                    Text("Personal → Work").font(.subheadline.weight(.semibold))
                    Text(bridge.enabled ? "Busy-only bridge is on" : "Bridge is paused")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            } else {
                Text("No calendar bridges yet").font(.callout).foregroundStyle(.secondary)
            }
            HStack {
                Button("Open Planipus") {
                    openWindow(id: "main")
                    NSApplication.shared.activate(ignoringOtherApps: true)
                }
                Spacer()
                Button("Quit") { model.quit() }
            }
        }
        .padding(16)
        .frame(width: 290)
    }
}
