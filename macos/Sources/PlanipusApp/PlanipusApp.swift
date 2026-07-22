import AppKit
import SwiftUI

@main
struct PlanipusApp: App {
    @StateObject private var model = AppModel()

    var body: some Scene {
        WindowGroup("Planipus", id: "main") {
            RootView()
                .environmentObject(model)
                .frame(minWidth: 760, minHeight: 560)
                .onReceive(
                    NSWorkspace.shared.notificationCenter.publisher(
                        for: NSWorkspace.willSleepNotification
                    )
                ) { _ in
                    model.setSleeping(true)
                }
                .onReceive(
                    NSWorkspace.shared.notificationCenter.publisher(
                        for: NSWorkspace.didWakeNotification
                    )
                ) { _ in
                    model.setSleeping(false)
                }
        }
        .windowResizability(.contentMinSize)

        MenuBarExtra("Planipus", systemImage: "calendar.badge.clock") {
            MenuBarContent()
                .environmentObject(model)
        }
        .menuBarExtraStyle(.window)
    }
}
