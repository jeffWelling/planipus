import XCTest

@testable import PlanipusCore

final class PresentationModeTests: XCTestCase {

    /// The safety property this whole type exists to guarantee. Enumerating
    /// `allCases` means a mode added later is covered without editing a list,
    /// which is the point: the invariant must not be something a future case
    /// can silently opt out of.
    func testNoModeHidesBothTheDockIconAndTheMenuBarItem() {
        for mode in PresentationMode.allCases {
            XCTAssertTrue(
                mode.satisfiesVisibilityInvariant,
                "\(mode.rawValue) hides both the Dock icon and the menu-bar item, "
                    + "leaving sync running with nothing on screen to say so"
            )
            XCTAssertTrue(
                mode.showsDockIcon || mode.showsStatusItem,
                "\(mode.rawValue) is unreachable once the window is closed"
            )
        }
    }

    func testDockAndMenuBarShowsBoth() {
        XCTAssertTrue(PresentationMode.dockAndMenuBar.showsDockIcon)
        XCTAssertTrue(PresentationMode.dockAndMenuBar.showsStatusItem)
    }

    func testMenuBarOnlyHidesTheDockIconAndKeepsTheItem() {
        XCTAssertFalse(PresentationMode.menuBarOnly.showsDockIcon)
        XCTAssertTrue(PresentationMode.menuBarOnly.showsStatusItem)
    }

    func testDockOnlyKeepsTheDockIconAndHidesTheItem() {
        XCTAssertTrue(PresentationMode.dockOnly.showsDockIcon)
        XCTAssertFalse(PresentationMode.dockOnly.showsStatusItem)
    }

    /// The default must put Planipus in the Dock. A background-only default is
    /// what made the unbundled build invisible to Launch Services.
    func testDefaultIsDockAndMenuBar() {
        let defaults = Self.emptyDefaults()
        XCTAssertEqual(PresentationModeStore.load(from: defaults), .dockAndMenuBar)
        XCTAssertTrue(PresentationModeStore.load(from: defaults).showsDockIcon)
    }

    func testUnrecognisedStoredValueFallsBackToTheDefault() {
        let defaults = Self.emptyDefaults()
        defaults.set("somethingElse", forKey: PresentationModeStore.defaultsKey)
        XCTAssertEqual(PresentationModeStore.load(from: defaults), .dockAndMenuBar)
    }

    func testEveryModeRoundTripsThroughStorage() {
        let defaults = Self.emptyDefaults()
        for mode in PresentationMode.allCases {
            PresentationModeStore.save(mode, to: defaults)
            XCTAssertEqual(PresentationModeStore.load(from: defaults), mode)
        }
    }

    /// Every mode needs user-facing copy; an empty string would ship a blank
    /// row in Settings.
    func testEveryModeHasDisplayNameAndExplanation() {
        for mode in PresentationMode.allCases {
            XCTAssertFalse(mode.displayName.isEmpty, "\(mode.rawValue) has no display name")
            XCTAssertFalse(mode.explanation.isEmpty, "\(mode.rawValue) has no explanation")
        }
    }

    private static func emptyDefaults() -> UserDefaults {
        let suite = "org.planipus.macos.tests.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suite)!
        defaults.removePersistentDomain(forName: suite)
        return defaults
    }
}
