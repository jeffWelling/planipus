import AppKit
import Foundation
import Network
import PlanipusCore
import PlanipusGoogle
import PlanipusSecrets
import PlanipusStore
import PlanipusSync

@MainActor
final class AppModel: ObservableObject {
    enum AccountRole: String, CaseIterable, Identifiable, Hashable {
        case source
        case destination
        case both

        var id: String { rawValue }

        var displayName: String {
            switch self {
            case .source: "Source only"
            case .destination: "Destination only"
            case .both: "Source and destination"
            }
        }

        var canSource: Bool { self == .source || self == .both }
        var canDestination: Bool { self == .destination || self == .both }

        var requestedCalendarScopes: Set<String> {
            switch self {
            case .source:
                [AppModel.sourceEventsScope]
            case .destination, .both:
                [AppModel.destinationEventsScope]
            }
        }

        func hasSourceCapability(in scopes: Set<String>) -> Bool {
            canSource && (
                scopes.contains(AppModel.sourceEventsScope) ||
                    scopes.contains(AppModel.destinationEventsScope)
            )
        }

        func hasDestinationCapability(in scopes: Set<String>) -> Bool {
            canDestination && scopes.contains(AppModel.destinationEventsScope)
        }

        static func restoring(_ value: String) -> AccountRole? {
            if let role = AccountRole(rawValue: value) { return role }
            switch value.lowercased() {
            case "personal": return .source
            case "work": return .destination
            default: return nil
            }
        }
    }

    struct Account: Identifiable, Hashable {
        let id: String
        let email: String
        var role: AccountRole
        let colorName: String
        var grantedScopes: Set<String>
    }

    struct Bridge: Identifiable, Hashable {
        let id: String
        var sourceAccountID: String
        var sourceCalendarID: String
        var sourceEmail: String
        var destinationAccountID: String
        var destinationCalendarID: String
        var destinationEmail: String
        var privacy: PrivacyPreset
        var hours: String
        var enabled: Bool
        var lastRun: Date?
        var issue: String?
    }

    struct Notice: Identifiable {
        let id = UUID()
        let title: String
        let message: String
    }

    @Published var hasCompletedFirstRun = false
    @Published var accounts: [Account] = []
    @Published var bridges: [Bridge] = []
    @Published var lifecycle: AppLifecycleLabel = .stopped
    @Published var oauthNotice: Notice?
    @Published var isConnectingGoogle = false

    private let googleAuthorizer: (any GoogleOAuthAuthorizing)?
    private let googleCredentialInspector: (any GoogleCredentialInspecting)?
    /// Production Google routing is composed at startup and activated only
    /// after the encrypted repository has authenticated and migrated.
    private let googleProvider: (any CalendarProvider)?
    private let googleConfigurationIssue: String?
    private var isPreviewMode = false
    private var preparedPolicies: [String: SyncPolicy] = [:]
    private var productionStore: EncryptedPlanipusRepository?
    private var syncCoordinator: SyncCoordinator?
    private var installationID: String?
    private let pathMonitor = NWPathMonitor()
    private let pathMonitorQueue = DispatchQueue(label: "org.planipus.macos.network-path")
    private var isSystemSleeping = false
    private var isNetworkAvailable = true

    nonisolated private static let sourceEventsScope =
        "https://www.googleapis.com/auth/calendar.events.readonly"
    nonisolated private static let destinationEventsScope =
        "https://www.googleapis.com/auth/calendar.events"

    enum AppLifecycleLabel: String {
        case ready = "Ready on this Mac"
        case offline = "Mac is offline"
        case sleeping = "Paused while sleeping"
        case stopped = "Not running"
    }

    init() {
        let composition = Self.makeGoogleOAuthComposition()
        googleAuthorizer = composition.authorizer
        googleCredentialInspector = composition.inspector
        googleProvider = composition.provider
        googleConfigurationIssue = composition.issue
        pathMonitor.pathUpdateHandler = { [weak self] path in
            Task { @MainActor [weak self] in
                self?.setOnline(path.status == .satisfied)
            }
        }
        pathMonitor.start(queue: pathMonitorQueue)
        Task { [weak self] in
            await self?.prepareProductionRuntime()
        }
    }

    func enterLocalPreview() {
        isPreviewMode = true
        let coordinator = syncCoordinator
        let store = productionStore
        syncCoordinator = nil
        productionStore = nil
        installationID = nil
        Task {
            if let coordinator { await coordinator.setLifecycle(.stopped) }
            try? await store?.close()
        }
        accounts = [
            Account(
                id: "personal",
                email: "you@personal.example",
                role: .source,
                colorName: "purple",
                grantedScopes: [Self.sourceEventsScope]
            ),
            Account(
                id: "work",
                email: "you@work.example",
                role: .destination,
                colorName: "green",
                grantedScopes: [Self.destinationEventsScope]
            ),
        ]
        bridges = [
            Bridge(
                id: "personal-to-work",
                sourceAccountID: "personal",
                sourceCalendarID: "primary",
                sourceEmail: "you@personal.example",
                destinationAccountID: "work",
                destinationCalendarID: "primary",
                destinationEmail: "you@work.example",
                privacy: .busyOnly,
                hours: "Weekdays, 9:00–5:00",
                enabled: true,
                lastRun: Date(),
                issue: nil
            )
        ]
        hasCompletedFirstRun = true
        lifecycle = .ready
    }

    func requestGoogleConnection(role: AccountRole) {
        guard !isConnectingGoogle else { return }
        guard productionStore != nil else {
            oauthNotice = Notice(
                title: "Local encrypted storage is not ready",
                message: Self.productionStoreMessage
            )
            return
        }
        guard let googleAuthorizer else {
            oauthNotice = Notice(
                title: "Google connection needs configuration",
                message: googleConfigurationIssue ??
                    "This build does not contain a Google installed-app client ID and redirect URI."
            )
            return
        }

        isConnectingGoogle = true
        Task { [weak self] in
            guard let self else { return }
            defer { isConnectingGoogle = false }
            do {
                let credential = try await googleAuthorizer.authorize(
                    scopes: role.requestedCalendarScopes
                )
                await register(credential, role: role)
            } catch let error as LocalizedError {
                oauthNotice = Notice(
                    title: "Google account not connected",
                    message: error.errorDescription ?? String(describing: error)
                )
            } catch {
                oauthNotice = Notice(
                    title: "Google account not connected",
                    message: "The connection could not be completed. \(error.localizedDescription)"
                )
            }
        }
    }

    func updateBridge(_ bridge: Bridge) {
        guard let index = bridges.firstIndex(where: { $0.id == bridge.id }) else { return }
        if !isPreviewMode, bridge.enabled, productionStore == nil {
            var safeBridge = bridge
            safeBridge.enabled = false
            bridges[index] = safeBridge
            oauthNotice = Notice(
                title: "Sync is not enabled in this build",
                message: Self.productionStoreMessage
            )
            return
        }
        var checkedBridge = bridge
        checkedBridge.issue = bridgeAuthorizationIssue(bridge)
        if bridge.enabled, checkedBridge.issue != nil {
            checkedBridge.enabled = false
            oauthNotice = Notice(
                title: "This bridge needs different account access",
                message: checkedBridge.issue ?? "Reconnect the affected Google account."
            )
        }
        bridges[index] = checkedBridge
        preparedPolicies[bridge.id] = syncPolicy(for: checkedBridge)
        if !isPreviewMode {
            Task { [weak self] in await self?.persistConfigurationAndReschedule() }
        }
    }

    var sourceAccounts: [Account] {
        accounts.filter { $0.role.hasSourceCapability(in: $0.grantedScopes) }
    }

    var destinationAccounts: [Account] {
        accounts.filter { $0.role.hasDestinationCapability(in: $0.grantedScopes) }
    }

    func createBridge(sourceAccountID: String, destinationAccountID: String) {
        guard sourceAccountID != destinationAccountID,
              let source = accounts.first(where: { $0.id == sourceAccountID }),
              let destination = accounts.first(where: { $0.id == destinationAccountID }),
              source.role.hasSourceCapability(in: source.grantedScopes),
              destination.role.hasDestinationCapability(in: destination.grantedScopes)
        else {
            oauthNotice = Notice(
                title: "Choose two compatible accounts",
                message: "A source needs read access and a different destination needs write access."
            )
            return
        }
        guard !bridges.contains(where: {
            $0.sourceAccountID == source.id &&
                $0.sourceCalendarID == "primary" &&
                $0.destinationAccountID == destination.id &&
                $0.destinationCalendarID == "primary"
        }) else {
            oauthNotice = Notice(
                title: "That bridge already exists",
                message: "Edit the existing bridge instead of creating a duplicate."
            )
            return
        }
        let bridge = makeBridge(source: source, destination: destination)
        bridges.append(bridge)
        preparedPolicies[bridge.id] = syncPolicy(for: bridge)
        hasCompletedFirstRun = true
        Task { [weak self] in await self?.persistConfigurationAndReschedule() }
    }

    func setSleeping(_ sleeping: Bool) {
        isSystemSleeping = sleeping
        if isPreviewMode {
            updateVisibleLifecycle()
            return
        }
        applyLifecycleToCoordinator()
    }

    func setOnline(_ online: Bool) {
        isNetworkAvailable = online
        if isPreviewMode {
            updateVisibleLifecycle()
            return
        }
        applyLifecycleToCoordinator()
    }

    func quit() {
        lifecycle = .stopped
        guard !isPreviewMode else {
            NSApplication.shared.terminate(nil)
            return
        }
        let coordinator = syncCoordinator
        let store = productionStore
        Task {
            if let coordinator { await coordinator.setLifecycle(.stopped) }
            try? await store?.close()
            NSApplication.shared.terminate(nil)
        }
    }

    private func register(_ credential: GoogleCredential, role: AccountRole) async {
        let hasRequiredCapability = role == .source
            ? role.hasSourceCapability(in: credential.grantedScopes)
            : role.hasDestinationCapability(in: credential.grantedScopes)
        guard hasRequiredCapability else {
            oauthNotice = Notice(
                title: "Google did not grant the requested access",
                message: "Planipus left the account disconnected. Try again and approve the " +
                    "calendar access shown by Google."
            )
            return
        }

        if let existingIndex = accounts.firstIndex(where: { $0.id == credential.providerSubject }) {
            accounts[existingIndex].role = role
            accounts[existingIndex].grantedScopes = credential.grantedScopes
            await persistConfigurationAndReschedule()
            oauthNotice = Notice(
                title: "Google account reconnected",
                message: "\(credential.email) now has \(role.displayName.lowercased()) access."
            )
            return
        }

        accounts.append(Account(
            id: credential.providerSubject,
            email: credential.email,
            role: role,
            colorName: role == .source ? "purple" : "green",
            grantedScopes: credential.grantedScopes
        ))

        guard accounts.count >= 2 else {
            await persistConfigurationAndReschedule()
            oauthNotice = Notice(
                title: "Google account connected",
                message: "Now connect another account with the complementary source or destination role."
            )
            return
        }

        if bridges.isEmpty {
            if let source = accounts.first(where: {
                $0.role.hasSourceCapability(in: $0.grantedScopes)
            }), let destination = accounts.first(where: {
                $0.id != source.id && $0.role.hasDestinationCapability(in: $0.grantedScopes)
            }) {
                bridges.append(makeBridge(source: source, destination: destination))
            }
        }
        if let bridge = bridges.first {
            let policy = syncPolicy(for: bridge)
            preparedPolicies[bridge.id] = policy
        }
        hasCompletedFirstRun = true
        updateVisibleLifecycle()
        if productionStore == nil {
            oauthNotice = Notice(
                title: "Accounts connected; sync remains off",
                message: Self.productionStoreMessage
            )
            return
        }
        await persistConfigurationAndReschedule()
    }

    private func prepareProductionRuntime() async {
        guard !isPreviewMode else { return }
        do {
            let store = try await ProductionStoreGate.open(databaseURL: Self.productionDatabaseURL())
            var configuration = try await store.loadAppConfiguration()
            if configuration == nil {
                let freshConfiguration = NativeAppConfiguration(
                    installationID: UUID().uuidString.lowercased()
                )
                try await store.saveAppConfiguration(freshConfiguration)
                configuration = freshConfiguration
            }
            guard let configuration, !configuration.installationID.isEmpty else {
                throw AppCompositionError.invalidInstallationIdentity
            }
            guard !isPreviewMode else {
                try await store.close()
                return
            }

            productionStore = store
            installationID = configuration.installationID
            try restore(configuration)

            guard let googleProvider else {
                lifecycle = .stopped
                if !configuration.bridges.isEmpty {
                    oauthNotice = Notice(
                        title: "Calendar sync needs Google configuration",
                        message: googleConfigurationIssue ??
                            "This build does not contain its installed-app OAuth configuration."
                    )
                }
                return
            }

            let coordinator = SyncCoordinator(
                provider: googleProvider,
                repository: store,
                installationID: configuration.installationID
            )
            syncCoordinator = coordinator
            await coordinator.setLifecycle(coordinatorLifecycle)
            guard !isPreviewMode else {
                syncCoordinator = nil
                productionStore = nil
                installationID = nil
                await coordinator.setLifecycle(.stopped)
                try await store.close()
                return
            }
            let runnablePolicies = await validateCredentialBackedPolicies()
            await coordinator.startPolling(policies: runnablePolicies)
            guard !isPreviewMode else {
                syncCoordinator = nil
                productionStore = nil
                installationID = nil
                await coordinator.setLifecycle(.stopped)
                try await store.close()
                return
            }
            updateVisibleLifecycle()
        } catch {
            productionStore = nil
            syncCoordinator = nil
            installationID = nil
            lifecycle = .stopped
            oauthNotice = Notice(
                title: "Planipus could not open its encrypted database",
                message: Self.storeFailureMessage(for: error)
            )
        }
    }

    private func restore(_ configuration: NativeAppConfiguration) throws {
        let accountIDs = configuration.accounts.map(\.id)
        guard accountIDs.allSatisfy({ !$0.isEmpty }),
              configuration.accounts.allSatisfy({ !$0.email.isEmpty }),
              Set(accountIDs).count == accountIDs.count
        else {
            throw AppCompositionError.invalidStoredConfiguration
        }
        var restoredPolicies: [String: SyncPolicy] = [:]
        let knownAccounts = Set(accountIDs)
        for bridge in configuration.bridges {
            let policy = bridge.policy
            guard !bridge.id.isEmpty,
                  restoredPolicies[bridge.id] == nil,
                  bridge.id == policy.id,
                  knownAccounts.contains(policy.sourceAccountID),
                  knownAccounts.contains(policy.destinationAccountID),
                  !policy.sourceCalendarID.isEmpty,
                  !policy.destinationCalendarID.isEmpty
            else {
                throw AppCompositionError.invalidStoredConfiguration
            }
            restoredPolicies[bridge.id] = policy
        }
        accounts = try configuration.accounts.map {
            guard let role = AccountRole.restoring($0.role) else {
                throw AppCompositionError.invalidStoredConfiguration
            }
            return Account(
                id: $0.id,
                email: $0.email,
                role: role,
                colorName: $0.colorName,
                grantedScopes: Set($0.grantedScopes)
            )
        }
        bridges = configuration.bridges.map { stored in
            Bridge(
                id: stored.id,
                sourceAccountID: stored.policy.sourceAccountID,
                sourceCalendarID: stored.policy.sourceCalendarID,
                sourceEmail: stored.sourceEmail,
                destinationAccountID: stored.policy.destinationAccountID,
                destinationCalendarID: stored.policy.destinationCalendarID,
                destinationEmail: stored.destinationEmail,
                privacy: stored.policy.privacyPreset,
                hours: stored.hoursSummary,
                enabled: stored.policy.enabled,
                lastRun: stored.lastRun,
                issue: nil
            )
        }
        preparedPolicies = restoredPolicies
        hasCompletedFirstRun = accounts.count >= 2
    }

    private func persistConfigurationAndReschedule() async {
        guard !isPreviewMode,
              let productionStore,
              let installationID
        else { return }

        let storedAccounts = accounts.map {
            StoredNativeAccount(
                id: $0.id,
                email: $0.email,
                role: $0.role.rawValue,
                colorName: $0.colorName,
                grantedScopes: $0.grantedScopes.sorted()
            )
        }
        let storedBridges = bridges.map { bridge -> StoredNativeBridge in
            let policy = syncPolicy(for: bridge)
            return StoredNativeBridge(
                id: bridge.id,
                sourceEmail: bridge.sourceEmail,
                destinationEmail: bridge.destinationEmail,
                hoursSummary: bridge.hours,
                policy: policy,
                lastRun: bridge.lastRun
            )
        }
        let nextPolicies = Dictionary(
            uniqueKeysWithValues: storedBridges.map { ($0.id, $0.policy) }
        )
        do {
            try await productionStore.saveAppConfiguration(
                NativeAppConfiguration(
                    installationID: installationID,
                    accounts: storedAccounts,
                    bridges: storedBridges
                )
            )
            preparedPolicies = nextPolicies
            if let syncCoordinator {
                let runnablePolicies = await validateCredentialBackedPolicies()
                await syncCoordinator.stopPolling()
                await syncCoordinator.startPolling(policies: runnablePolicies)
            }
        } catch {
            oauthNotice = Notice(
                title: "Calendar settings were not saved",
                message: "Sync was left in its previous safe state. " + error.localizedDescription
            )
        }
    }

    private static func makeGoogleOAuthComposition() -> (
        authorizer: (any GoogleOAuthAuthorizing)?,
        inspector: (any GoogleCredentialInspecting)?,
        provider: (any CalendarProvider)?,
        issue: String?
    ) {
        let environment = ProcessInfo.processInfo.environment
        let clientID = configuredValue(
            bundleKey: "PlanipusGoogleClientID",
            environmentKey: "PLANIPUS_GOOGLE_CLIENT_ID",
            environment: environment
        )
        let redirectValue = configuredValue(
            bundleKey: "PlanipusGoogleRedirectURI",
            environmentKey: "PLANIPUS_GOOGLE_REDIRECT_URI",
            environment: environment
        )
        guard let clientID, let redirectValue else {
            return (
                nil,
                nil,
                nil,
                "Set PlanipusGoogleClientID and PlanipusGoogleRedirectURI in the app bundle, or PLANIPUS_GOOGLE_CLIENT_ID and PLANIPUS_GOOGLE_REDIRECT_URI while developing. Planipus never uses a client secret."
            )
        }
        guard let redirectURI = URL(string: redirectValue) else {
            return (nil, nil, nil, "The configured Google redirect URI is not a valid URL.")
        }

        do {
            let configuration = try GoogleInstalledAppOAuthConfiguration(
                clientID: clientID,
                redirectURI: redirectURI
            )
            let browserSession = ASWebAuthenticationSessionRunner {
                NSApplication.shared.keyWindow ??
                    NSApplication.shared.windows.first(where: { $0.isVisible })
            }
            let authorizer = GoogleInstalledAppOAuthAuthorizer(
                configuration: configuration,
                browserSession: browserSession,
                secretStore: KeychainSecretStore()
            )
            let provider = GoogleAccountCalendarRouter(
                tokenSource: authorizer,
                identitySource: authorizer,
                transport: URLSessionHTTPTransport()
            )
            return (authorizer, authorizer, provider, nil)
        } catch {
            return (
                nil,
                nil,
                nil,
                "The Google OAuth configuration was rejected: \(error.localizedDescription)"
            )
        }
    }

    private func makeBridge(source: Account, destination: Account) -> Bridge {
        Bridge(
            id: "bridge-\(UUID().uuidString.lowercased())",
            sourceAccountID: source.id,
            sourceCalendarID: "primary",
            sourceEmail: source.email,
            destinationAccountID: destination.id,
            destinationCalendarID: "primary",
            destinationEmail: destination.email,
            privacy: .busyOnly,
            hours: "Weekdays, 9:00–5:00",
            enabled: productionStore != nil,
            lastRun: nil,
            issue: nil
        )
    }

    private func bridgeAuthorizationIssue(
        _ bridge: Bridge,
        liveScopes: [String: Set<String>] = [:],
        missingCredentialIDs: Set<String> = []
    ) -> String? {
        guard bridge.sourceAccountID != bridge.destinationAccountID else {
            return "Source and destination must be different Google accounts."
        }
        guard let source = accounts.first(where: { $0.id == bridge.sourceAccountID }),
              let destination = accounts.first(where: { $0.id == bridge.destinationAccountID })
        else {
            return "One of this bridge's Google accounts is no longer configured."
        }
        if missingCredentialIDs.contains(source.id) || missingCredentialIDs.contains(destination.id) {
            return "Reconnect the affected Google account before this bridge can run."
        }
        let sourceScopes = liveScopes[source.id] ?? source.grantedScopes
        let destinationScopes = liveScopes[destination.id] ?? destination.grantedScopes
        guard source.role.hasSourceCapability(in: sourceScopes) else {
            return "Reconnect \(source.email) with source read access."
        }
        guard destination.role.hasDestinationCapability(in: destinationScopes) else {
            return "Reconnect \(destination.email) with destination write access."
        }
        return nil
    }

    private func validateCredentialBackedPolicies() async -> [SyncPolicy] {
        guard let googleCredentialInspector else {
            for index in bridges.indices where bridges[index].enabled {
                bridges[index].issue = "Google credential inspection is unavailable in this build."
            }
            return []
        }

        let referencedAccountIDs = Set(
            bridges.filter(\.enabled).flatMap { [$0.sourceAccountID, $0.destinationAccountID] }
        )
        var liveScopes: [String: Set<String>] = [:]
        var missingCredentialIDs: Set<String> = []
        for accountID in referencedAccountIDs {
            do {
                guard let metadata = try await googleCredentialInspector.credentialMetadata(
                    accountID: accountID
                ), metadata.providerSubject == accountID else {
                    missingCredentialIDs.insert(accountID)
                    continue
                }
                liveScopes[accountID] = metadata.grantedScopes
            } catch {
                missingCredentialIDs.insert(accountID)
            }
        }

        var runnable: [SyncPolicy] = []
        var firstIssue: String?
        for index in bridges.indices {
            guard bridges[index].enabled else {
                bridges[index].issue = nil
                continue
            }
            let issue = bridgeAuthorizationIssue(
                bridges[index],
                liveScopes: liveScopes,
                missingCredentialIDs: missingCredentialIDs
            )
            bridges[index].issue = issue
            if let issue {
                firstIssue = firstIssue ?? issue
            } else if let policy = preparedPolicies[bridges[index].id] {
                runnable.append(policy)
            }
        }
        if let firstIssue {
            oauthNotice = Notice(
                title: "A calendar bridge needs attention",
                message: firstIssue
            )
        }
        return runnable
    }

    private var coordinatorLifecycle: AppLifecycle {
        if isSystemSleeping { return .sleeping }
        if !isNetworkAvailable { return .offline }
        return .online
    }

    private func updateVisibleLifecycle() {
        if isSystemSleeping {
            lifecycle = .sleeping
        } else if !isNetworkAvailable {
            lifecycle = .offline
        } else if isPreviewMode || syncCoordinator != nil {
            lifecycle = .ready
        } else {
            lifecycle = .stopped
        }
    }

    private func applyLifecycleToCoordinator() {
        updateVisibleLifecycle()
        guard let syncCoordinator else { return }
        let nextLifecycle = coordinatorLifecycle
        Task {
            await syncCoordinator.setLifecycle(nextLifecycle)
        }
    }

    /// Converts presentation state to the same account-explicit policy the
    /// production coordinator consumes.
    private func syncPolicy(for bridge: Bridge) -> SyncPolicy {
        SyncPolicy(
            id: bridge.id,
            sourceAccountID: bridge.sourceAccountID,
            sourceCalendarID: bridge.sourceCalendarID,
            destinationAccountID: bridge.destinationAccountID,
            destinationCalendarID: bridge.destinationCalendarID,
            destinationIdentityEmail: bridge.destinationEmail,
            enabled: bridge.enabled,
            hoursProfile: .weekdays(timezoneIdentifier: TimeZone.current.identifier),
            privacyPreset: bridge.privacy
        )
    }

    private static let productionStoreMessage =
        "Planipus must open its SQLCipher database with this Mac's device-bound Keychain key " +
        "before it connects an account or enables calendar sync. It never falls back to memory."

    private static func productionDatabaseURL() throws -> URL {
        guard let applicationSupport = FileManager.default.urls(
            for: .applicationSupportDirectory,
            in: .userDomainMask
        ).first else {
            throw AppCompositionError.applicationSupportUnavailable
        }
        return applicationSupport
            .appendingPathComponent("Planipus", isDirectory: true)
            .appendingPathComponent("planipus.sqlite")
    }

    private static func storeFailureMessage(for error: Error) -> String {
        if let keyError = error as? DatabaseKeyError,
           keyError == .missingForExistingDatabase
        {
            return "The database exists, but its device-bound Keychain key is missing. " +
                "Planipus will not generate a replacement or overwrite the database. " +
                "Key recovery and import are not implemented."
        }
        if let storeError = error as? EncryptedStoreError,
           storeError == .invalidDatabaseKey
        {
            return "The device-bound Keychain key cannot decrypt the existing database. " +
                "Planipus left the file untouched. Key recovery and rotation are not implemented."
        }
        return "Planipus left sync stopped and did not use temporary storage. " +
            "The local database error was: " + error.localizedDescription
    }

    private static func configuredValue(
        bundleKey: String,
        environmentKey: String,
        environment: [String: String]
    ) -> String? {
        let candidates = [
            Bundle.main.object(forInfoDictionaryKey: bundleKey) as? String,
            environment[environmentKey],
        ]
        for candidate in candidates.compactMap({ $0 }) {
            let trimmed = candidate.trimmingCharacters(in: .whitespacesAndNewlines)
            if !trimmed.isEmpty, !trimmed.contains("$(") { return trimmed }
        }
        return nil
    }
}

private enum AppCompositionError: Error {
    case applicationSupportUnavailable
    case invalidInstallationIdentity
    case invalidStoredConfiguration
}
