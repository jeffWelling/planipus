import Foundation

/// How Planipus presents itself while running.
///
/// The app's *static* identity is always a regular application: the bundle's
/// `Info.plist` deliberately omits `LSUIElement`, so Launchpad, Spotlight,
/// `open -a` and automation tooling can always see Planipus. This preference
/// controls only the *runtime* activation policy and menu-bar item visibility,
/// and takes effect without a relaunch.
///
/// Deliberately AppKit-free so the safety invariant below is directly
/// assertable. The translation to `NSApplication.ActivationPolicy` lives in
/// the app target.
public enum PresentationMode: String, CaseIterable, Sendable {
    /// Dock icon, Command-Tab entry, and a menu-bar item. Default.
    case dockAndMenuBar
    /// Menu-bar item only. No Dock icon and no Command-Tab entry.
    case menuBarOnly
    /// Dock icon and Command-Tab entry only. No menu-bar item.
    case dockOnly

    public var displayName: String {
        switch self {
        case .dockAndMenuBar: return "Dock and Menu Bar"
        case .menuBarOnly: return "Menu Bar Only"
        case .dockOnly: return "Dock Only"
        }
    }

    /// Shown beneath the Settings picker. Each explanation says plainly where
    /// the user will still be able to see that sync is running, because that
    /// is the property this preference is most able to damage.
    public var explanation: String {
        switch self {
        case .dockAndMenuBar:
            return "Planipus appears in the Dock, Launchpad and Command-Tab, and keeps a "
                + "menu-bar item. Both show you that sync is still running."
        case .menuBarOnly:
            return "Planipus runs from the menu bar only, with no Dock icon. The menu-bar "
                + "item is then the only sign that sync is still running."
        case .dockOnly:
            return "Planipus behaves like a standard Dock application, with no menu-bar "
                + "item. Closing the window does not stop sync; quitting does."
        }
    }

    /// Whether this mode places Planipus in the Dock and Command-Tab.
    public var showsDockIcon: Bool {
        switch self {
        case .dockAndMenuBar, .dockOnly: return true
        case .menuBarOnly: return false
        }
    }

    /// Whether this mode keeps the menu-bar item inserted.
    public var showsStatusItem: Bool {
        switch self {
        case .dockAndMenuBar, .menuBarOnly: return true
        case .dockOnly: return false
        }
    }

    /// Safety invariant: no mode may hide both the Dock icon and the menu-bar
    /// item, which would leave a running app with no way back into it.
    ///
    /// For Planipus this is stronger than a usability guard. The Mac edition
    /// keeps syncing after its window is closed and stops only on an explicit
    /// Quit, so the Dock icon and the menu-bar item are the only two signals
    /// that sync is still running. A mode showing neither would leave Planipus
    /// mutating a real calendar with nothing on screen to say so.
    ///
    /// It holds by construction for every current case. It is stated here as
    /// an explicit, tested property so that a case added later cannot silently
    /// violate it.
    public var satisfiesVisibilityInvariant: Bool {
        showsDockIcon || showsStatusItem
    }
}

/// Non-secret presentation preference storage.
///
/// Deliberately `UserDefaults` rather than the encrypted store. Presentation
/// must be decidable before, and independently of, the SQLCipher database
/// opening: a user whose database fails to open still has to be able to see
/// and reach the app in order to do anything about it.
public enum PresentationModeStore {
    public static let defaultsKey = "org.planipus.macos.presentationMode"

    /// Posted after a successful save so a live controller can re-apply
    /// without a relaunch.
    public static let didChangeNotification = Notification.Name(
        "org.planipus.macos.presentationModeChanged"
    )

    public static func load(from defaults: UserDefaults = .standard) -> PresentationMode {
        guard let raw = defaults.string(forKey: defaultsKey),
            let mode = PresentationMode(rawValue: raw)
        else {
            return .dockAndMenuBar
        }
        return mode
    }

    public static func save(_ mode: PresentationMode, to defaults: UserDefaults = .standard) {
        defaults.set(mode.rawValue, forKey: defaultsKey)
        NotificationCenter.default.post(name: didChangeNotification, object: nil)
    }
}
