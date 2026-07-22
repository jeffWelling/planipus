package domain

import (
	"fmt"
	"time"
)

func Seed(now time.Time, timezone string) State {
	loc, err := time.LoadLocation(timezone)
	if err != nil {
		loc = time.UTC
		timezone = "UTC"
	}
	now = now.In(loc)
	start := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, loc)

	workdays := []time.Weekday{
		time.Monday, time.Tuesday, time.Wednesday, time.Thursday, time.Friday,
	}
	windows := make([]DailyWindow, 0, len(workdays))
	energy := make([]EnergyWindow, 0, len(workdays)*2)
	for _, day := range workdays {
		windows = append(windows, DailyWindow{Weekday: day, StartMinute: 8*60 + 30, EndMinute: 17*60 + 30})
		energy = append(energy,
			EnergyWindow{Weekday: day, StartMinute: 8*60 + 30, EndMinute: 11*60 + 30, Energy: EnergyHigh},
			EnergyWindow{Weekday: day, StartMinute: 11*60 + 30, EndMinute: 17*60 + 30, Energy: EnergyMedium},
		)
	}

	at := func(day, hour, minute int) time.Time {
		d := start.AddDate(0, 0, day)
		return time.Date(d.Year(), d.Month(), d.Day(), hour, minute, 0, 0, loc)
	}
	event := func(id, title string, day, hour, minute, duration int, category string) CalendarEvent {
		from := at(day, hour, minute)
		return CalendarEvent{ID: id, Title: title, Start: from, End: from.Add(time.Duration(duration) * time.Minute), Category: category, Locked: true}
	}
	item := func(id, title string, kind ItemKind, priority, duration, dueDay, dueHour, ideal int, itemEnergy Energy, context string) WorkItem {
		return WorkItem{
			ID: id, Title: title, Kind: kind, Priority: priority,
			DurationMinutes: duration, Earliest: start, Deadline: at(dueDay, dueHour, 0),
			IdealMinute: ideal, Energy: itemEnergy, Context: context, CreatedAt: now,
		}
	}

	state := State{
		SchemaVersion: 1,
		Revision:      1,
		Settings: Settings{Timezone: timezone, SlotMinutes: 15, HorizonDays: 7, WorkingWindows: windows, EnergyWindows: energy},
		Events: []CalendarEvent{
			event("event-standup", "Team stand-up", 0, 9, 30, 30, "meeting"),
			event("event-client", "Client review", 0, 13, 0, 60, "meeting"),
			event("event-product", "Product council", 1, 10, 0, 60, "meeting"),
			event("event-dentist", "Private appointment", 2, 14, 0, 75, "personal"),
			event("event-oneone", "1:1 · Morgan", 3, 11, 0, 45, "meeting"),
			event("event-demo", "Release demonstration", 4, 14, 30, 60, "meeting"),
		},
		Items: []WorkItem{
			item("item-roadmap", "Draft roadmap brief", KindTask, 1, 120, 2, 17, 9*60, EnergyHigh, "strategy"),
			item("item-prs", "Review release pull requests", KindTask, 2, 60, 1, 17, 10*60, EnergyHigh, "engineering"),
			item("item-research", "Synthesize customer research", KindTask, 2, 90, 3, 17, 9*60+30, EnergyHigh, "strategy"),
			item("item-focus", "Protected deep-work block", KindFocus, 2, 90, 4, 17, 9*60, EnergyHigh, "focus"),
			item("item-lunch", "Lunch away from the desk", KindHabit, 2, 45, 0, 14, 12*60, EnergyLow, "wellbeing"),
			item("item-expenses", "File monthly expenses", KindTask, 3, 30, 4, 17, 15*60, EnergyLow, "admin"),
		},
	}
	state.Items[4].Windows = []DailyWindow{{Weekday: start.Weekday(), StartMinute: 11*60+30, EndMinute: 14*60}}
	state.Audit = []AuditEntry{{
		ID: fmt.Sprintf("audit-seed-%d", now.Unix()), At: now, Action: "instance.seeded",
		Actor: "system", Revision: state.Revision, Details: map[string]any{"timezone": timezone},
	}}
	return state
}
