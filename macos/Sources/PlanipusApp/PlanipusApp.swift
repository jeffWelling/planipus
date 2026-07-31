import AppKit
import SwiftUI

@main
struct PlanipusApp: App {
    @NSApplicationDelegateAdaptor(PlanipusAppDelegate.self) private var appDelegate
    @StateObject private var model = AppModel()
    @StateObject private var presentation = PresentationModeController()

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

        MenuBarExtra(
            "Planipus",
            systemImage: "calendar.badge.clock",
            isInserted: Binding(
                get: { presentation.statusItemVisible },
                // The menu-bar item is removed only by choosing Dock Only in
                // Settings, which keeps the Dock icon. Nothing else may drop
                // it, because in Menu Bar Only it is the sole indication that
                // sync is still running.
                set: { _ in }
            )
        ) {
            MenuBarContent()
                .environmentObject(model)
                .environmentObject(presentation)
        }
        .menuBarExtraStyle(.window)
    }
}
