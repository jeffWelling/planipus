package domain

import "time"

type ItemKind string

const (
	KindTask  ItemKind = "task"
	KindHabit ItemKind = "habit"
	KindFocus ItemKind = "focus"
)

type Energy string

const (
	EnergyAny    Energy = "any"
	EnergyLow    Energy = "low"
	EnergyMedium Energy = "medium"
	EnergyHigh   Energy = "high"
)

type PlanStatus string

const (
	PlanPending PlanStatus = "pending"
	PlanApplied PlanStatus = "applied"
	PlanStale   PlanStatus = "stale"
)

type DailyWindow struct {
	Weekday    time.Weekday `json:"weekday"`
	StartMinute int         `json:"startMinute"`
	EndMinute   int         `json:"endMinute"`
}

type EnergyWindow struct {
	Weekday    time.Weekday `json:"weekday"`
	StartMinute int         `json:"startMinute"`
	EndMinute   int         `json:"endMinute"`
	Energy      Energy      `json:"energy"`
}

type Settings struct {
	Timezone       string         `json:"timezone"`
	SlotMinutes    int            `json:"slotMinutes"`
	HorizonDays    int            `json:"horizonDays"`
	WorkingWindows []DailyWindow  `json:"workingWindows"`
	EnergyWindows  []EnergyWindow `json:"energyWindows"`
}

type WorkItem struct {
	ID              string        `json:"id"`
	Title           string        `json:"title"`
	Kind            ItemKind      `json:"kind"`
	Priority        int           `json:"priority"`
	DurationMinutes int           `json:"durationMinutes"`
	Earliest        time.Time     `json:"earliest"`
	Deadline        time.Time     `json:"deadline"`
	IdealMinute     int           `json:"idealMinute"`
	Energy          Energy        `json:"energy"`
	Context         string        `json:"context,omitempty"`
	Windows         []DailyWindow `json:"windows,omitempty"`
	BufferBefore    int           `json:"bufferBefore,omitempty"`
	BufferAfter     int           `json:"bufferAfter,omitempty"`
	Locked          bool          `json:"locked"`
	Completed       bool          `json:"completed"`
	CreatedAt       time.Time     `json:"createdAt"`
}

type CalendarEvent struct {
	ID       string    `json:"id"`
	Title    string    `json:"title"`
	Start    time.Time `json:"start"`
	End      time.Time `json:"end"`
	Category string    `json:"category"`
	Locked   bool      `json:"locked"`
}

type ScoreFactor struct {
	Name   string  `json:"name"`
	Value  float64 `json:"value"`
	Detail string  `json:"detail"`
}

type Placement struct {
	ID          string        `json:"id"`
	ItemID      string        `json:"itemId"`
	Title       string        `json:"title"`
	Kind        ItemKind      `json:"kind"`
	Start       time.Time     `json:"start"`
	End         time.Time     `json:"end"`
	Score       float64       `json:"score"`
	Factors     []ScoreFactor `json:"factors"`
	Explanation string        `json:"explanation"`
	Committed   bool          `json:"committed"`
}

type UnscheduledItem struct {
	ItemID         string `json:"itemId"`
	Title          string `json:"title"`
	Reason         string `json:"reason"`
	ShortfallMins  int    `json:"shortfallMinutes"`
}

type Plan struct {
	ID          string            `json:"id"`
	BaseRevision uint64           `json:"baseRevision"`
	CreatedAt   time.Time         `json:"createdAt"`
	HorizonStart time.Time        `json:"horizonStart"`
	HorizonEnd  time.Time         `json:"horizonEnd"`
	Placements  []Placement       `json:"placements"`
	Unscheduled []UnscheduledItem `json:"unscheduled"`
	Score       float64           `json:"score"`
	Status      PlanStatus        `json:"status"`
}

type AuditEntry struct {
	ID       string         `json:"id"`
	At       time.Time      `json:"at"`
	Action   string         `json:"action"`
	Actor    string         `json:"actor"`
	Revision uint64         `json:"revision"`
	Details  map[string]any `json:"details,omitempty"`
}

type State struct {
	SchemaVersion int             `json:"schemaVersion"`
	Revision      uint64          `json:"revision"`
	Settings      Settings        `json:"settings"`
	Items         []WorkItem      `json:"items"`
	Events        []CalendarEvent `json:"events"`
	Committed     []Placement     `json:"committed"`
	Plans         []Plan          `json:"plans"`
	Audit         []AuditEntry    `json:"audit"`
}

type Snapshot struct {
	Revision  uint64          `json:"revision"`
	Settings  Settings        `json:"settings"`
	Items     []WorkItem      `json:"items"`
	Events    []CalendarEvent `json:"events"`
	Committed []Placement     `json:"committed"`
	Plans     []Plan          `json:"plans"`
	Audit     []AuditEntry    `json:"audit"`
}

func (s State) Snapshot() Snapshot {
	return Snapshot{
		Revision: s.Revision, Settings: s.Settings, Items: s.Items,
		Events: s.Events, Committed: s.Committed, Plans: s.Plans, Audit: s.Audit,
	}
}
