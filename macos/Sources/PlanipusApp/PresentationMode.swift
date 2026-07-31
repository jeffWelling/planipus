import AppKit
import Combine
import PlanipusCore

// SwiftUI is deliberately not imported here: it declares its own
// `PresentationMode`, which would make every unqualified reference in this
// file ambiguous with the Planipus one. `ObservableObject` and `@Published`
// come from Combine, so nothing here needs SwiftUI.

/// Central wrapper for the `NSApp` activation calls this app makes.
///
/// Every call is a no-op under XCTest. The Swift suite constructs real
/// controllers in the test host process, and an unguarded activation-policy
/// flip or `activate(ignoringOtherApps:)` steals focus from whatever the
/// developer is doing while the suite runs.
enum AppActivation {
    static let isRunningUnderXCTest: Bool =
        ProcessInfo.processInfo.environment["XCTestConfigurationFilePath"] != nil
        || NSClassFromString("XCTestCase") != nil

    /// Load the product-owned Dock artwork rather than relying on Launch
    /// Services' bundle-icon cache, which can serve a stale image across a
    /// transition into `.regular`.
    @MainActor
    static func applicationIcon(bundle: Bundle = .main) -> NSImage? {
        for fileExtension in ["icns", "png"] {
            if let url = bundle.url(forResource: "AppIcon", withExtension: fileExtension),
                let image = NSImage(contentsOf: url)
            {
                // The Dock artwork is full colour. Only the menu-bar glyph may
                // ever be a template image; letting AppKit infer template
                // treatment here produces a silhouette in the Dock.
                image.isTemplate = false
                return image
            }
        }
        return nil
    }

    @MainActor
    static func installApplicationIcon(bundle: Bundle = .main) {
        guard !isRunningUnderXCTest, let icon = applicationIcon(bundle: bundle) else { return }
        NSApp.applicationIconImage = icon
    }

    @MainActor
    static func setActivationPolicy(_ policy: NSApplication.ActivationPolicy) {
        guard !isRunningUnderXCTest else { return }
        NSApp.setActivationPolicy(policy)
    }

    @MainActor
    static func activate() {
        guard !isRunningUnderXCTest else { return }
        NSApp.activate(ignoringOtherApps: true)
    }
}

extension PresentationMode {
    /// The only translation from the AppKit-free preference to an activation
    /// policy. Kept as a single expression so the mapping cannot drift from
    /// `showsDockIcon`, which is what the tested invariant reasons about.
    var activationPolicy: NSApplication.ActivationPolicy {
        showsDockIcon ? .regular : .accessory
    }
}

/// Owns the effect of `PresentationMode`: the `NSApp` activation policy and
/// whether the menu-bar item is inserted. This is the only place in normal
/// operation that changes the activation policy.
@MainActor
public final class PresentationModeController: ObservableObject {
    /// Bound by `PlanipusApp` to `MenuBarExtra(isInserted:)`.
    @Published public private(set) var statusItemVisible: Bool
    @Published public private(set) var mode: PresentationMode

    /// Tracks the policy actually applied so a mode change that does not alter
    /// the policy never issues a redundant `setActivationPolicy`, and so the
    /// anti-flicker activation below fires only on a real accessory-to-regular
    /// transition. `nil` means "never applied", so the first call always
    /// applies once even if it matches what launch already set.
    private var lastAppliedPolicy: NSApplication.ActivationPolicy?
    private var observer: (any NSObjectProtocol)?

    public init(mode: PresentationMode = PresentationModeStore.load()) {
        self.mode = mode
        self.statusItemVisible = mode.showsStatusItem
        apply(mode)
        observer = NotificationCenter.default.addObserver(
            forName: PresentationModeStore.didChangeNotification,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            MainActor.assumeIsolated { self?.applyCurrentMode() }
        }
    }

    public func applyCurrentMode() {
        apply(PresentationModeStore.load())
    }

    public func select(_ mode: PresentationMode) {
        PresentationModeStore.save(mode)
    }

    private func apply(_ mode: PresentationMode) {
        assert(
            mode.satisfiesVisibilityInvariant,
            "PresentationMode \(mode) hides both the Dock icon and the menu-bar item"
        )
        self.mode = mode
        statusItemVisible = mode.showsStatusItem

        let policy = mode.activationPolicy
        guard policy != lastAppliedPolicy else { return }
        let wasAccessory = lastAppliedPolicy == .accessory
        lastAppliedPolicy = policy
        if policy == .regular {
            AppActivation.installApplicationIcon()
        }
        AppActivation.setActivationPolicy(policy)
        if wasAccessory && policy == .regular {
            AppActivation.activate()
        }
    }
}

/// Applies the persisted activation policy before the app finishes launching,
/// so a `menuBarOnly` user never sees a Dock icon appear and disappear.
///
/// `applicationWillFinishLaunching` is the earliest delegate callback and runs
/// before the first window is ordered in. The menu-bar item is owned by
/// SwiftUI's `MenuBarExtra(isInserted:)` and handled by
/// `PresentationModeController`, not here.
public final class PlanipusAppDelegate: NSObject, NSApplicationDelegate {
    public func applicationWillFinishLaunching(_ notification: Notification) {
        MainActor.assumeIsolated {
            AppActivation.installApplicationIcon()
            AppActivation.setActivationPolicy(PresentationModeStore.load().activationPolicy)
        }
    }
}
