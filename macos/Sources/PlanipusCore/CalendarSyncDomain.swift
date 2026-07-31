import Foundation

public enum ISOWeekday: Int, Codable, CaseIterable, Sendable {
    case monday = 1
    case tuesday
    case wednesday
    case thursday
    case friday
    case saturday
    case sunday
}

public struct WeeklyInterval: Codable, Hashable, Sendable {
    public var weekday: ISOWeekday
    public var startMinute: Int
    public var endMinute: Int

    public init(weekday: ISOWeekday, startMinute: Int, endMinute: Int) {
        precondition((0..<1_440).contains(startMinute))
        precondition((0...1_440).contains(endMinute))
        self.weekday = weekday
        self.startMinute = startMinute
        self.endMinute = endMinute
    }
}

public enum HoursMatchMode: String, Codable, Sendable {
    case allTimes = "all_times"
    case overlapsProfile = "overlaps_profile"
    case containedInProfile = "contained_in_profile"
}

public struct HoursProfile: Codable, Hashable, Sendable {
    public var id: String
    public var name: String
    public var timezoneIdentifier: String
    public var intervals: [WeeklyInterval]

    public init(
        id: String,
        name: String,
        timezoneIdentifier: String,
        intervals: [WeeklyInterval]
    ) {
        self.id = id
        self.name = name
        self.timezoneIdentifier = timezoneIdentifier
        self.intervals = intervals
    }

    public static func weekdays(
        timezoneIdentifier: String,
        startHour: Int = 9,
        endHour: Int = 17
    ) -> HoursProfile {
        HoursProfile(
            id: "work-hours",
            name: "Work hours",
            timezoneIdentifier: timezoneIdentifier,
            intervals: ISOWeekday.allCases.prefix(5).map {
                WeeklyInterval(
                    weekday: $0,
                    startMinute: startHour * 60,
                    endMinute: endHour * 60
                )
            }
        )
    }
}

public enum PrivacyPreset: String, Codable, CaseIterable, Sendable {
    case busyOnly = "busy_only"
    case commitment
    case privateDetails = "private_details"
    case sharedDetails = "shared_details"
}

public struct PrivacyFields: Codable, Hashable, Sendable {
    public var title: Bool
    public var description: Bool
    public var location: Bool
    public var conference: Bool

    public init(
        title: Bool = false,
        description: Bool = false,
        location: Bool = false,
        conference: Bool = false
    ) {
        self.title = title
        self.description = description
        self.location = location
        self.conference = conference
    }
}

public enum AllDayBehavior: String, Codable, Sendable {
    case skip
    case busyOnly = "busy_only"
    case all
}

public enum FreeEventBehavior: String, Codable, Sendable {
    case skipWhenRedacted = "skip_when_redacted"
    case preserveFree = "preserve_free"
    case forceBusy = "force_busy"
}

public enum RSVPStatus: String, Codable, Sendable {
    case notApplicable = "not_applicable"
    case accepted
    case tentative
    case declined
    case needsAction = "needs_action"
    case organizer
}

public enum NeedsActionBehavior: String, Codable, Sendable {
    case includeFree = "include_free"
    case includeBusy = "include_busy"
    case omit
}

public enum TentativeBehavior: String, Codable, Sendable {
    case busy
    case free
    case omit
}

public enum DestinationEditMode: String, Codable, Sendable {
    case restore
    case restoreAndNotify = "restore_and_notify"
    case holdForReview = "hold_for_review"
}

/// What happens when a person edits or deletes a managed destination copy
/// directly instead of the authoritative source event. The source stays
/// authoritative in every mode; a direct copy change never silently becomes
/// the truth and Planipus never writes from a copy back to its source. The
/// modes only choose how loudly the divergence is surfaced and whether the
/// person confirms before the copy is written again.
public struct DestinationEditPolicy: Codable, Hashable, Sendable {
    public var version: Int
    public var onEdit: DestinationEditMode
    public var onDelete: DestinationEditMode

    public init(
        version: Int = 1,
        onEdit: DestinationEditMode = .restoreAndNotify,
        onDelete: DestinationEditMode = .restoreAndNotify
    ) {
        self.version = version
        self.onEdit = onEdit
        self.onDelete = onDelete
    }

    public static let `default` = DestinationEditPolicy()

    private enum CodingKeys: String, CodingKey {
        case version
        case onEdit = "on_edit"
        case onDelete = "on_delete"
    }
}

public struct SyncPolicy: Codable, Hashable, Sendable {
    public var id: String
    public var revision: Int
    public var sourceProvider: CalendarProviderKind
    public var sourceAccountID: String
    public var sourceCalendarID: String
    public var destinationProvider: CalendarProviderKind
    public var destinationAccountID: String
    public var destinationCalendarID: String
    public var destinationIdentityEmail: String?
    public var enabled: Bool
    public var timedEventsEnabled: Bool
    public var hoursMode: HoursMatchMode
    public var hoursProfile: HoursProfile
    public var privacyPreset: PrivacyPreset
    public var privacyPresetVersion: Int
    public var privacyFields: PrivacyFields
    public var genericLabel: String
    public var allDayBehavior: AllDayBehavior
    public var freeEventBehavior: FreeEventBehavior
    public var needsActionBehavior: NeedsActionBehavior
    public var tentativeBehavior: TentativeBehavior
    public var noSyncTokenEnabled: Bool
    public var sourceExclusionMarker: String
    public var manualExcludedSourceEventIDs: Set<String>
    public var skipWhenDestinationInvited: Bool
    /// Optional so policies stored before this field existed keep decoding;
    /// use `effectiveDestinationEdits` for the concrete behavior.
    public var destinationEdits: DestinationEditPolicy?
    public var horizonStart: Date?
    public var horizonEnd: Date?

    public var effectiveDestinationEdits: DestinationEditPolicy {
        destinationEdits ?? .default
    }

    public init(
        id: String,
        revision: Int = 1,
        sourceProvider: CalendarProviderKind = .google,
        sourceAccountID: String,
        sourceCalendarID: String,
        destinationProvider: CalendarProviderKind = .google,
        destinationAccountID: String,
        destinationCalendarID: String,
        destinationIdentityEmail: String? = nil,
        enabled: Bool = true,
        timedEventsEnabled: Bool = true,
        hoursMode: HoursMatchMode = .overlapsProfile,
        hoursProfile: HoursProfile,
        privacyPreset: PrivacyPreset = .busyOnly,
        privacyPresetVersion: Int = 1,
        privacyFields: PrivacyFields = PrivacyFields(),
        genericLabel: String = "Personal commitment",
        allDayBehavior: AllDayBehavior = .skip,
        freeEventBehavior: FreeEventBehavior = .skipWhenRedacted,
        needsActionBehavior: NeedsActionBehavior = .includeFree,
        tentativeBehavior: TentativeBehavior = .busy,
        noSyncTokenEnabled: Bool = true,
        sourceExclusionMarker: String = "#nosync",
        manualExcludedSourceEventIDs: Set<String> = [],
        skipWhenDestinationInvited: Bool = true,
        destinationEdits: DestinationEditPolicy? = nil,
        horizonStart: Date? = nil,
        horizonEnd: Date? = nil
    ) {
        self.id = id
        self.revision = revision
        self.sourceProvider = sourceProvider
        self.sourceAccountID = sourceAccountID
        self.sourceCalendarID = sourceCalendarID
        self.destinationProvider = destinationProvider
        self.destinationAccountID = destinationAccountID
        self.destinationCalendarID = destinationCalendarID
        self.destinationIdentityEmail = destinationIdentityEmail
        self.enabled = enabled
        self.timedEventsEnabled = timedEventsEnabled
        self.hoursMode = hoursMode
        self.hoursProfile = hoursProfile
        self.privacyPreset = privacyPreset
        self.privacyPresetVersion = privacyPresetVersion
        self.privacyFields = privacyFields
        self.genericLabel = genericLabel
        self.allDayBehavior = allDayBehavior
        self.freeEventBehavior = freeEventBehavior
        self.needsActionBehavior = needsActionBehavior
        self.tentativeBehavior = tentativeBehavior
        self.noSyncTokenEnabled = noSyncTokenEnabled
        self.sourceExclusionMarker = sourceExclusionMarker
        self.manualExcludedSourceEventIDs = manualExcludedSourceEventIDs
        self.skipWhenDestinationInvited = skipWhenDestinationInvited
        self.destinationEdits = destinationEdits
        self.horizonStart = horizonStart
        self.horizonEnd = horizonEnd
    }

    public var sourceEndpoint: CalendarEndpoint {
        CalendarEndpoint(
            provider: sourceProvider,
            accountID: sourceAccountID,
            calendarID: sourceCalendarID
        )
    }

    public var destinationEndpoint: CalendarEndpoint {
        CalendarEndpoint(
            provider: destinationProvider,
            accountID: destinationAccountID,
            calendarID: destinationCalendarID
        )
    }
}

public struct SourceEvent: Codable, Hashable, Sendable, Identifiable {
    public var id: String
    public var calendarID: String
    public var occurrenceID: String?
    public var start: Date
    public var end: Date
    public var isAllDay: Bool
    public var isFree: Bool
    public var title: String
    public var details: String?
    public var location: String?
    public var conferenceURL: String?
    public var rsvpStatus: RSVPStatus
    public var responseNote: String?
    public var attendeeEmails: [String]
    public var destinationIdentityEmail: String?
    public var isManagedCopy: Bool
    public var managedPolicyID: String?
    public var managedProjectionID: String?
    public var isDeleted: Bool
    public var providerRevision: String?

    public init(
        id: String,
        calendarID: String,
        occurrenceID: String? = nil,
        start: Date,
        end: Date,
        isAllDay: Bool = false,
        isFree: Bool = false,
        title: String,
        details: String? = nil,
        location: String? = nil,
        conferenceURL: String? = nil,
        rsvpStatus: RSVPStatus = .notApplicable,
        responseNote: String? = nil,
        attendeeEmails: [String] = [],
        destinationIdentityEmail: String? = nil,
        isManagedCopy: Bool = false,
        managedPolicyID: String? = nil,
        managedProjectionID: String? = nil,
        isDeleted: Bool = false,
        providerRevision: String? = nil
    ) {
        self.id = id
        self.calendarID = calendarID
        self.occurrenceID = occurrenceID
        self.start = start
        self.end = end
        self.isAllDay = isAllDay
        self.isFree = isFree
        self.title = title
        self.details = details
        self.location = location
        self.conferenceURL = conferenceURL
        self.rsvpStatus = rsvpStatus
        self.responseNote = responseNote
        self.attendeeEmails = attendeeEmails
        self.destinationIdentityEmail = destinationIdentityEmail
        self.isManagedCopy = isManagedCopy
        self.managedPolicyID = managedPolicyID
        self.managedProjectionID = managedProjectionID
        self.isDeleted = isDeleted
        self.providerRevision = providerRevision
    }
}

public enum DestinationVisibility: String, Codable, Sendable {
    case `private`
    case `default`
}

public enum DestinationTransparency: String, Codable, Sendable {
    case opaque
    case transparent
}

public struct DesiredCopy: Codable, Hashable, Sendable {
    public var summary: String
    public var start: Date
    public var end: Date
    public var isAllDay: Bool
    public var description: String?
    public var location: String?
    public var conferenceURL: String?
    public var visibility: DestinationVisibility
    public var transparency: DestinationTransparency
    public var remindersEnabled: Bool
    public var disclosure: [String]

    public init(
        summary: String,
        start: Date,
        end: Date,
        isAllDay: Bool,
        description: String?,
        location: String?,
        conferenceURL: String?,
        visibility: DestinationVisibility,
        transparency: DestinationTransparency,
        remindersEnabled: Bool = false,
        disclosure: [String]
    ) {
        self.summary = summary
        self.start = start
        self.end = end
        self.isAllDay = isAllDay
        self.description = description
        self.location = location
        self.conferenceURL = conferenceURL
        self.visibility = visibility
        self.transparency = transparency
        self.remindersEnabled = remindersEnabled
        self.disclosure = disclosure
    }
}

public enum PolicyAction: String, Codable, Sendable {
    case copy
    case omit
    case delete
}

public struct PolicyDecision: Codable, Hashable, Sendable {
    public var action: PolicyAction
    public var reasonCodes: [String]
    public var desiredCopy: DesiredCopy?

    public init(action: PolicyAction, reasonCodes: [String], desiredCopy: DesiredCopy? = nil) {
        self.action = action
        self.reasonCodes = reasonCodes
        self.desiredCopy = desiredCopy
    }
}

public enum PolicyReason {
    // These values are the exact calendar-sync/v1 registry IDs. Keep aliases
    // only for source compatibility with the Mac domain API.
    public static let timedEventIncluded = "timed_event_included"
    public static let included = timedEventIncluded
    public static let disabled = "policy_disabled"
    public static let selfMap = "invalid_same_calendar"
    public static let invalidSourceEvent = "invalid_source_event"
    public static let sourceDeleted = "source_deleted"
    public static let managedCopy = "managed_copy"
    public static let noSync = "nosync"
    public static let allDaySkipped = "all_day"
    public static let allDayFree = "all_day_free"
    public static let allDayBusyIncluded = "all_day_busy_included"
    public static let allDayIncluded = "all_day_included"
    public static let timedDisabled = "timed_event_disabled"
    public static let freeSkipped = "free"
    public static let declined = "rsvp_declined"
    public static let needsActionOmitted = "rsvp_unanswered_omitted"
    public static let tentativeOmitted = "rsvp_tentative_omitted"
    public static let destinationInvited = "already_invited"
    public static let manualExclusion = "manual_exclusion"
    public static let outsideHorizon = "outside_horizon"
    public static let allTimes = "all_times"
    public static let hoursOverlap = "overlaps_hours"
    public static let hoursContained = "contained_in_hours"
    public static let outsideHours = "outside_hours"
    public static let privacyBusyOnly = "privacy_busy_only"
    public static let privacyCommitment = "privacy_commitment"
    public static let privacyPrivateDetails = "privacy_private_details"
    public static let privacySharedDetails = "privacy_shared_details"
    public static let deletePolicyExclusion = "delete_policy_exclusion"
}
