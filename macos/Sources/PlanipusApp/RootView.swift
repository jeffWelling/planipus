import PlanipusCore
import PlanipusDesign
import SwiftUI

struct RootView: View {
    @EnvironmentObject private var model: AppModel

    var body: some View {
        Group {
            if model.hasCompletedFirstRun {
                OverviewView()
            } else {
                FirstRunView()
            }
        }
        .background(PlanipusPalette.warmSurface.ignoresSafeArea())
        .alert(item: $model.oauthNotice) { notice in
            Alert(
                title: Text(notice.title),
                message: Text(notice.message),
                dismissButton: .default(Text("OK"))
            )
        }
    }
}

private struct FirstRunView: View {
    @EnvironmentObject private var model: AppModel
    @State private var pendingRole: AppModel.AccountRole = .source

    var body: some View {
        HStack(spacing: 0) {
            VStack(alignment: .leading, spacing: 22) {
                PlanipusMark()
                Spacer()
                Text("Keep your calendars\nquietly in step.")
                    .font(.system(size: 38, weight: .bold, design: .rounded))
                    .foregroundStyle(PlanipusPalette.ink)
                Text("Planipus mirrors just enough of a personal event onto your work calendar—only during the hours you choose, and only with the details you allow.")
                    .font(.title3)
                    .foregroundStyle(PlanipusPalette.mutedInk)
                    .lineSpacing(4)
                    .frame(maxWidth: 390, alignment: .leading)
                Spacer()
                Label("Runs only while this Mac is awake and online", systemImage: "macbook")
                    .font(.callout)
                    .foregroundStyle(PlanipusPalette.mutedInk)
            }
            .padding(44)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(PlanipusPalette.lavenderWash)

            VStack(alignment: .leading, spacing: 22) {
                Spacer()
                Text("Connect your calendars")
                    .font(.title.bold())
                    .foregroundStyle(PlanipusPalette.ink)
                Text("Connect Google accounts independently, then make a one-way bridge between calendars.")
                    .foregroundStyle(PlanipusPalette.mutedInk)
                feature("arrow.left.arrow.right", "One-way, loop-safe bridges")
                feature("eye.slash", "Busy only, a generic label, or selected details")
                feature("clock", "Work-hours overlap and containment rules")

                if !model.accounts.isEmpty {
                    VStack(alignment: .leading, spacing: 8) {
                        Text("CONNECTED ON THIS MAC")
                            .font(.caption2.weight(.semibold))
                            .foregroundStyle(.secondary)
                        ForEach(model.accounts) { account in
                            HStack {
                                Label(account.email, systemImage: "checkmark.circle.fill")
                                    .foregroundStyle(PlanipusPalette.ink)
                                Spacer()
                                Text(account.role.displayName)
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                        }
                    }
                    .padding(12)
                    .background(PlanipusPalette.mintWash, in: RoundedRectangle(cornerRadius: 12))
                }

                Picker("This account can be a", selection: $pendingRole) {
                    ForEach(AppModel.AccountRole.allCases) { role in
                        Text(role.displayName).tag(role)
                    }
                }
                .pickerStyle(.menu)

                Button {
                    model.requestGoogleConnection(role: pendingRole)
                } label: {
                    if model.isConnectingGoogle {
                        HStack {
                            ProgressView().controlSize(.small)
                            Text("Waiting for Google…")
                        }
                    } else {
                        Text(model.accounts.isEmpty ?
                            "Connect a Google account" : "Connect another Google account")
                    }
                }
                .buttonStyle(.borderedProminent)
                .tint(PlanipusPalette.lavender)
                .controlSize(.large)
                .disabled(model.isConnectingGoogle)
                .onChange(of: model.accounts.count) { _, _ in
                    if model.sourceAccounts.isEmpty {
                        pendingRole = .source
                    } else if model.destinationAccounts.isEmpty {
                        pendingRole = .destination
                    }
                }

                Button("Explore with sample calendars") {
                    model.enterLocalPreview()
                }
                .buttonStyle(.link)
                .foregroundStyle(PlanipusPalette.lavender)
                Spacer()
            }
            .padding(50)
            .frame(width: 380, alignment: .leading)
        }
    }

    private func feature(_ symbol: String, _ text: String) -> some View {
        Label(text, systemImage: symbol)
            .symbolRenderingMode(.hierarchical)
            .foregroundStyle(PlanipusPalette.ink)
    }
}

private struct OverviewView: View {
    @EnvironmentObject private var model: AppModel
    @State private var editingBridge: AppModel.Bridge?
    @State private var isAddingAccount = false
    @State private var isAddingBridge = false

    var body: some View {
        NavigationSplitView {
            List {
                Label("Overview", systemImage: "square.grid.2x2")
                Label("Calendar bridges", systemImage: "arrow.triangle.branch")
                Label("Accounts", systemImage: "person.2")
                Label("Activity", systemImage: "waveform.path.ecg")
            }
            .navigationTitle("Planipus")
            .safeAreaInset(edge: .bottom) {
                Text("Native Mac edition")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .padding()
            }
        } detail: {
            ScrollView {
                VStack(alignment: .leading, spacing: 22) {
                    HStack {
                        VStack(alignment: .leading, spacing: 5) {
                            Text("Calendar bridges").font(.largeTitle.bold())
                            Text("Small, private copies that keep people from booking over you.")
                                .foregroundStyle(PlanipusPalette.mutedInk)
                        }
                        Spacer()
                        StatusLozenge(model.lifecycle.rawValue)
                    }

                    ForEach(model.bridges) { bridge in
                        BridgeCard(bridge: bridge) { editingBridge = bridge }
                    }

                    if model.bridges.isEmpty {
                        Text("No bridge yet. Connect a source and destination account, then choose Add bridge.")
                            .foregroundStyle(PlanipusPalette.mutedInk)
                            .planipusCard()
                    }

                    HStack {
                        Button {
                            isAddingAccount = true
                        } label: {
                            Label("Add Google account", systemImage: "person.badge.plus")
                        }
                        Button {
                            isAddingBridge = true
                        } label: {
                            Label("Add bridge", systemImage: "plus")
                        }
                    }
                    .buttonStyle(.bordered)
                }
                .padding(30)
            }
            .background(PlanipusPalette.warmSurface)
        }
        .sheet(item: $editingBridge) { bridge in
            BridgeEditor(bridge: bridge) { updated in
                model.updateBridge(updated)
            }
        }
        .sheet(isPresented: $isAddingAccount) {
            AddGoogleAccountView()
                .environmentObject(model)
        }
        .sheet(isPresented: $isAddingBridge) {
            NewBridgeView()
                .environmentObject(model)
        }
    }
}

private struct BridgeCard: View {
    let bridge: AppModel.Bridge
    let edit: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack {
                VStack(alignment: .leading, spacing: 5) {
                    Text(bridge.sourceEmail).font(.headline)
                    Label("copies into \(bridge.destinationEmail)", systemImage: "arrow.right")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
                Spacer()
                StatusLozenge(bridge.issue ?? (bridge.enabled ? "Bridge on" : "Paused"))
            }
            if let issue = bridge.issue {
                Label(issue, systemImage: "exclamationmark.triangle.fill")
                    .font(.callout)
                    .foregroundStyle(.orange)
            }
            Divider()
            HStack(spacing: 26) {
                bridgeFact("Privacy", privacyName)
                bridgeFact("When", bridge.hours)
                bridgeFact("Last checked", bridge.lastRun?.formatted(date: .omitted, time: .shortened) ?? "Not yet")
                Spacer()
                Button("Edit", action: edit).buttonStyle(.bordered)
            }
        }
        .planipusCard()
    }

    private var privacyName: String {
        switch bridge.privacy {
        case .busyOnly: "Busy only"
        case .commitment: "Generic label"
        case .privateDetails: "Selected private details"
        case .sharedDetails: "Selected shared details"
        }
    }

    private func bridgeFact(_ label: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(label.uppercased()).font(.caption2.weight(.semibold)).foregroundStyle(.secondary)
            Text(value).font(.callout)
        }
    }
}

private struct AddGoogleAccountView: View {
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var model: AppModel
    @State private var role: AppModel.AccountRole = .source

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            Text("Add a Google account").font(.title.bold())
            Text("Choose the account's job before Google asks for access. Source-only accounts stay read-only.")
                .foregroundStyle(.secondary)
            Picker("Account role", selection: $role) {
                ForEach(AppModel.AccountRole.allCases) { candidate in
                    Text(candidate.displayName).tag(candidate)
                }
            }
            .pickerStyle(.radioGroup)
            HStack {
                Spacer()
                Button("Cancel") { dismiss() }
                Button("Continue to Google") {
                    model.requestGoogleConnection(role: role)
                    dismiss()
                }
                .buttonStyle(.borderedProminent)
                .disabled(model.isConnectingGoogle)
            }
        }
        .padding(28)
        .frame(width: 460)
    }
}

private struct NewBridgeView: View {
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var model: AppModel
    @State private var sourceAccountID = ""
    @State private var destinationAccountID = ""

    private var destinations: [AppModel.Account] {
        model.destinationAccounts.filter { $0.id != sourceAccountID }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            Text("Add a calendar bridge").font(.title.bold())
            Text("The source stays authoritative. Planipus writes a privacy-filtered copy to the other account's primary calendar.")
                .foregroundStyle(.secondary)
            if model.sourceAccounts.isEmpty || destinations.isEmpty {
                Label(
                    "Connect at least one source and one different destination account first.",
                    systemImage: "info.circle"
                )
                .foregroundStyle(PlanipusPalette.mutedInk)
            } else {
                Picker("Source account", selection: $sourceAccountID) {
                    ForEach(model.sourceAccounts) { account in
                        Text(account.email).tag(account.id)
                    }
                }
                Picker("Destination account", selection: $destinationAccountID) {
                    ForEach(destinations) { account in
                        Text(account.email).tag(account.id)
                    }
                }
            }
            HStack {
                Spacer()
                Button("Cancel") { dismiss() }
                Button("Create bridge") {
                    model.createBridge(
                        sourceAccountID: sourceAccountID,
                        destinationAccountID: destinationAccountID
                    )
                    dismiss()
                }
                .buttonStyle(.borderedProminent)
                .disabled(
                    sourceAccountID.isEmpty || destinationAccountID.isEmpty ||
                        sourceAccountID == destinationAccountID
                )
            }
        }
        .padding(28)
        .frame(width: 520)
        .onAppear { selectDefaults() }
        .onChange(of: sourceAccountID) { _, _ in selectDestination() }
    }

    private func selectDefaults() {
        if sourceAccountID.isEmpty { sourceAccountID = model.sourceAccounts.first?.id ?? "" }
        selectDestination()
    }

    private func selectDestination() {
        if !destinations.contains(where: { $0.id == destinationAccountID }) {
            destinationAccountID = destinations.first?.id ?? ""
        }
    }
}

private struct BridgeEditor: View {
    @Environment(\.dismiss) private var dismiss
    @State private var bridge: AppModel.Bridge
    let onSave: (AppModel.Bridge) -> Void

    init(bridge: AppModel.Bridge, onSave: @escaping (AppModel.Bridge) -> Void) {
        _bridge = State(initialValue: bridge)
        self.onSave = onSave
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            Text("Bridge settings").font(.title.bold())
            Text("\(bridge.sourceEmail) → \(bridge.destinationEmail)")
                .foregroundStyle(.secondary)
            Picker("Privacy", selection: $bridge.privacy) {
                Text("Busy only").tag(PrivacyPreset.busyOnly)
                Text("Generic label").tag(PrivacyPreset.commitment)
                Text("Private details").tag(PrivacyPreset.privateDetails)
                Text("Shared details").tag(PrivacyPreset.sharedDetails)
            }
            .pickerStyle(.radioGroup)
            Text("Preview: coworkers see the event time and “\(bridge.privacy == .busyOnly ? "Busy" : "Personal commitment")”. Reminders and attendees are never copied.")
                .font(.callout)
                .foregroundStyle(.secondary)
                .padding()
                .background(PlanipusPalette.mintWash, in: RoundedRectangle(cornerRadius: 12))
            HStack {
                Spacer()
                Button("Cancel") { dismiss() }
                Button("Done") {
                    onSave(bridge)
                    dismiss()
                }
                .buttonStyle(.borderedProminent)
            }
        }
        .padding(28)
        .frame(width: 480)
    }
}
