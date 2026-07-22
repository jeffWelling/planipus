package scheduler

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"math"
	"sort"
	"strings"
	"time"

	"github.com/planipus-dev/planipus-spike/internal/domain"
)

type Engine struct{}

func New() *Engine { return &Engine{} }

type occupied struct {
	start   time.Time
	end     time.Time
	context string
}

type candidate struct {
	start   time.Time
	end     time.Time
	score   float64
	factors []domain.ScoreFactor
}

func (e *Engine) Preview(state domain.State, now time.Time) (domain.Plan, error) {
	settings := state.Settings
	if settings.SlotMinutes <= 0 || settings.HorizonDays <= 0 {
		return domain.Plan{}, fmt.Errorf("invalid scheduler settings")
	}
	loc, err := time.LoadLocation(settings.Timezone)
	if err != nil {
		return domain.Plan{}, fmt.Errorf("load timezone %q: %w", settings.Timezone, err)
	}

	now = roundUp(now.In(loc), time.Duration(settings.SlotMinutes)*time.Minute)
	dayStart := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, loc)
	horizonEnd := dayStart.AddDate(0, 0, settings.HorizonDays)

	occupiedSlots := make([]occupied, 0, len(state.Events)+len(state.Committed))
	for _, event := range state.Events {
		if event.End.After(now) && event.Start.Before(horizonEnd) {
			occupiedSlots = append(occupiedSlots, occupied{start: event.Start, end: event.End, context: "anchor"})
		}
	}

	itemsByID := make(map[string]domain.WorkItem, len(state.Items))
	current := make(map[string]domain.Placement, len(state.Committed))
	for _, item := range state.Items {
		itemsByID[item.ID] = item
	}
	for _, placement := range state.Committed {
		current[placement.ItemID] = placement
		if item, ok := itemsByID[placement.ItemID]; ok && item.Locked {
			occupiedSlots = append(occupiedSlots, occupied{
				start: placement.Start.Add(-time.Duration(item.BufferBefore) * time.Minute),
				end: placement.End.Add(time.Duration(item.BufferAfter) * time.Minute),
				context: item.Context,
			})
		}
	}

	items := append([]domain.WorkItem(nil), state.Items...)
	sort.SliceStable(items, func(i, j int) bool {
		pi, pj := normalizedPriority(items[i].Priority), normalizedPriority(items[j].Priority)
		if pi != pj {
			return pi < pj
		}
		if !items[i].Deadline.Equal(items[j].Deadline) {
			return items[i].Deadline.Before(items[j].Deadline)
		}
		if items[i].DurationMinutes != items[j].DurationMinutes {
			return items[i].DurationMinutes > items[j].DurationMinutes
		}
		return items[i].ID < items[j].ID
	})

	placements := make([]domain.Placement, 0, len(items))
	unscheduled := make([]domain.UnscheduledItem, 0)
	for _, item := range items {
		if item.Completed || item.DurationMinutes <= 0 {
			continue
		}
		if item.Locked {
			if fixed, ok := current[item.ID]; ok {
				fixed.Committed = false
				fixed.Explanation = "Kept in place because this item is locked."
				placements = append(placements, fixed)
				continue
			}
		}

		best, found := e.bestCandidate(item, settings, now, horizonEnd, occupiedSlots, current[item.ID], loc)
		if !found {
			available := e.maxAvailableMinutes(item, settings, now, horizonEnd, occupiedSlots, loc)
			shortfall := item.DurationMinutes - available
			if shortfall < 0 {
				shortfall = 0
			}
			reason := "No continuous slot fits the item's duration inside its allowed windows before the deadline."
			if !item.Deadline.IsZero() && !item.Deadline.After(now) {
				reason = "The deadline has passed. Change the deadline or mark the item complete."
			}
			unscheduled = append(unscheduled, domain.UnscheduledItem{
				ItemID: item.ID, Title: item.Title, Reason: reason, ShortfallMins: shortfall,
			})
			continue
		}

		placement := domain.Placement{
			ID: placementID(item.ID, best.start), ItemID: item.ID, Title: item.Title,
			Kind: item.Kind, Start: best.start, End: best.end, Score: round(best.score),
			Factors: best.factors, Explanation: explain(item, best, loc), Committed: false,
		}
		placements = append(placements, placement)
		occupiedSlots = append(occupiedSlots, occupied{
			start: best.start.Add(-time.Duration(item.BufferBefore) * time.Minute),
			end: best.end.Add(time.Duration(item.BufferAfter) * time.Minute),
			context: item.Context,
		})
	}

	sort.Slice(placements, func(i, j int) bool {
		if placements[i].Start.Equal(placements[j].Start) {
			return placements[i].ItemID < placements[j].ItemID
		}
		return placements[i].Start.Before(placements[j].Start)
	})
	total := 0.0
	for _, placement := range placements {
		total += placement.Score
	}
	plan := domain.Plan{
		BaseRevision: state.Revision, CreatedAt: now, HorizonStart: now, HorizonEnd: horizonEnd,
		Placements: placements, Unscheduled: unscheduled, Score: round(total), Status: domain.PlanPending,
	}
	plan.ID = planID(plan)
	return plan, nil
}

func (e *Engine) bestCandidate(item domain.WorkItem, settings domain.Settings, start, horizonEnd time.Time, slots []occupied, current domain.Placement, loc *time.Location) (candidate, bool) {
	windows := item.Windows
	if len(windows) == 0 {
		windows = settings.WorkingWindows
	}
	duration := time.Duration(item.DurationMinutes) * time.Minute
	step := time.Duration(settings.SlotMinutes) * time.Minute
	best := candidate{score: math.Inf(-1)}
	found := false

	day := time.Date(start.Year(), start.Month(), start.Day(), 0, 0, 0, 0, loc)
	for day.Before(horizonEnd) {
		for _, window := range windows {
			if window.Weekday != day.Weekday() || window.EndMinute <= window.StartMinute {
				continue
			}
			windowStart := localMinute(day, window.StartMinute, loc)
			windowEnd := localMinute(day, window.EndMinute, loc)
			candidateStart := roundUp(windowStart, step)
			if candidateStart.Before(start) {
				candidateStart = roundUp(start, step)
			}
			if !item.Earliest.IsZero() && candidateStart.Before(item.Earliest) {
				candidateStart = roundUp(item.Earliest.In(loc), step)
			}
			for ; !candidateStart.Add(duration).After(windowEnd); candidateStart = candidateStart.Add(step) {
				candidateEnd := candidateStart.Add(duration)
				if candidateEnd.After(horizonEnd) {
					break
				}
				if !item.Deadline.IsZero() && candidateEnd.After(item.Deadline) {
					continue
				}
				blockedStart := candidateStart.Add(-time.Duration(item.BufferBefore) * time.Minute)
				blockedEnd := candidateEnd.Add(time.Duration(item.BufferAfter) * time.Minute)
				if overlapsAny(blockedStart, blockedEnd, slots) {
					continue
				}
				c := scoreCandidate(item, settings, candidateStart, candidateEnd, start, slots, current, loc)
				if !found || c.score > best.score || (c.score == best.score && c.start.Before(best.start)) {
					best, found = c, true
				}
			}
		}
		day = day.AddDate(0, 0, 1)
	}
	return best, found
}

func scoreCandidate(item domain.WorkItem, settings domain.Settings, start, end, horizonStart time.Time, slots []occupied, current domain.Placement, loc *time.Location) candidate {
	factors := make([]domain.ScoreFactor, 0, 7)
	add := func(name string, value float64, detail string) {
		factors = append(factors, domain.ScoreFactor{Name: name, Value: round(value), Detail: detail})
	}

	priority := float64((5 - normalizedPriority(item.Priority)) * 100)
	add("priority", priority, fmt.Sprintf("P%d items are placed before lower priorities", normalizedPriority(item.Priority)))

	urgency := 0.0
	if !item.Deadline.IsZero() {
		slackHours := item.Deadline.Sub(end).Hours()
		urgency = math.Max(0, 130-(slackHours*4))
		add("deadline", urgency, fmt.Sprintf("%.1f hours of slack remain", math.Max(0, slackHours)))
	}

	minute := start.In(loc).Hour()*60 + start.In(loc).Minute()
	ideal := math.Max(-40, 85-(math.Abs(float64(minute-item.IdealMinute))/4))
	add("ideal time", ideal, fmt.Sprintf("starts %d minutes from the preferred time", abs(minute-item.IdealMinute)))

	actualEnergy := energyAt(settings, start.In(loc))
	energyScore := 15.0
	energyDetail := "item can use any energy window"
	if item.Energy != domain.EnergyAny && item.Energy != "" {
		if item.Energy == actualEnergy {
			energyScore = 70
			energyDetail = fmt.Sprintf("matches %s-energy preference", actualEnergy)
		} else {
			energyScore = -35
			energyDetail = fmt.Sprintf("needs %s energy; window is %s", item.Energy, actualEnergy)
		}
	}
	add("energy", energyScore, energyDetail)

	contextScore := contextAffinity(item.Context, start, end, slots)
	add("context", contextScore, contextDetail(contextScore, item.Context))

	fragmentScore := fragmentationScore(start, end, slots)
	add("fragmentation", fragmentScore, fragmentationDetail(fragmentScore))

	stability := 0.0
	if !current.Start.IsZero() {
		moveMinutes := math.Abs(current.Start.Sub(start).Minutes())
		if moveMinutes == 0 {
			stability = 90
		} else {
			stability = math.Max(-60, 30-(moveMinutes/30))
		}
		add("stability", stability, fmt.Sprintf("moves %.0f minutes from the committed position", moveMinutes))
	}

	early := math.Max(0, 35-(start.Sub(horizonStart).Hours()/6))
	add("earlier delivery", early, "earlier feasible placements reduce plan risk")

	score := priority + urgency + ideal + energyScore + contextScore + fragmentScore + stability + early
	return candidate{start: start, end: end, score: score, factors: factors}
}

func (e *Engine) maxAvailableMinutes(item domain.WorkItem, settings domain.Settings, start, horizonEnd time.Time, slots []occupied, loc *time.Location) int {
	windows := item.Windows
	if len(windows) == 0 {
		windows = settings.WorkingWindows
	}
	step := time.Duration(settings.SlotMinutes) * time.Minute
	maxMinutes := 0
	day := time.Date(start.Year(), start.Month(), start.Day(), 0, 0, 0, 0, loc)
	for day.Before(horizonEnd) {
		for _, window := range windows {
			if window.Weekday != day.Weekday() {
				continue
			}
			from := localMinute(day, window.StartMinute, loc)
			until := localMinute(day, window.EndMinute, loc)
			if from.Before(start) {
				from = roundUp(start, step)
			}
			if !item.Earliest.IsZero() && from.Before(item.Earliest) {
				from = roundUp(item.Earliest.In(loc), step)
			}
			if !item.Deadline.IsZero() && until.After(item.Deadline) {
				until = item.Deadline
			}
			run := 0
			for cursor := from; cursor.Add(step).Before(until) || cursor.Add(step).Equal(until); cursor = cursor.Add(step) {
				if overlapsAny(cursor, cursor.Add(step), slots) {
					run = 0
					continue
				}
				run += settings.SlotMinutes
				if run > maxMinutes {
					maxMinutes = run
				}
			}
		}
		day = day.AddDate(0, 0, 1)
	}
	return maxMinutes
}

func energyAt(settings domain.Settings, when time.Time) domain.Energy {
	minute := when.Hour()*60 + when.Minute()
	for _, window := range settings.EnergyWindows {
		if window.Weekday == when.Weekday() && minute >= window.StartMinute && minute < window.EndMinute {
			return window.Energy
		}
	}
	return domain.EnergyAny
}

func overlapsAny(start, end time.Time, slots []occupied) bool {
	for _, slot := range slots {
		if start.Before(slot.end) && end.After(slot.start) {
			return true
		}
	}
	return false
}

func contextAffinity(context string, start, end time.Time, slots []occupied) float64 {
	if context == "" {
		return 0
	}
	best := 0.0
	for _, slot := range slots {
		gap := math.Min(math.Abs(slot.end.Sub(start).Minutes()), math.Abs(end.Sub(slot.start).Minutes()))
		if gap > 30 {
			continue
		}
		if slot.context == context {
			best = math.Max(best, 35)
		} else if slot.context != "anchor" && slot.context != "" {
			best = math.Min(best, -12)
		}
	}
	return best
}

func fragmentationScore(start, end time.Time, slots []occupied) float64 {
	penalty := 0.0
	for _, slot := range slots {
		before := start.Sub(slot.end).Minutes()
		after := slot.start.Sub(end).Minutes()
		if (before > 0 && before < 30) || (after > 0 && after < 30) {
			penalty -= 18
		}
	}
	return penalty
}

func contextDetail(score float64, context string) string {
	if context == "" {
		return "no context preference"
	}
	if score > 0 {
		return "adjacent work shares the " + context + " context"
	}
	if score < 0 {
		return "placement introduces a nearby context change"
	}
	return "no nearby context match"
}

func fragmentationDetail(score float64) string {
	if score < 0 {
		return "leaves a short gap near another block"
	}
	return "does not create a short unusable gap"
}

func explain(item domain.WorkItem, c candidate, loc *time.Location) string {
	parts := []string{fmt.Sprintf("P%d", normalizedPriority(item.Priority))}
	actualEnergy := domain.EnergyAny
	for _, factor := range c.factors {
		if factor.Name == "energy" && factor.Value > 20 {
			actualEnergy = item.Energy
		}
	}
	if actualEnergy != domain.EnergyAny && actualEnergy != "" {
		parts = append(parts, string(actualEnergy)+"-energy match")
	}
	if !item.Deadline.IsZero() {
		parts = append(parts, "before "+item.Deadline.In(loc).Format("Mon 15:04")+" deadline")
	}
	return strings.Join(parts, " · ") + fmt.Sprintf(" · score %.0f", c.score)
}

func normalizedPriority(priority int) int {
	if priority < 1 || priority > 4 {
		return 4
	}
	return priority
}

func localMinute(day time.Time, minute int, loc *time.Location) time.Time {
	return time.Date(day.Year(), day.Month(), day.Day(), minute/60, minute%60, 0, 0, loc)
}

func roundUp(value time.Time, step time.Duration) time.Time {
	if step <= 0 {
		return value
	}
	truncated := value.Truncate(step)
	if truncated.Equal(value) {
		return value
	}
	return truncated.Add(step)
}

func placementID(itemID string, start time.Time) string {
	sum := sha256.Sum256([]byte(itemID + "|" + start.UTC().Format(time.RFC3339Nano)))
	return "plc_" + hex.EncodeToString(sum[:8])
}

func planID(plan domain.Plan) string {
	h := sha256.New()
	fmt.Fprintf(h, "%d|%s|%s", plan.BaseRevision, plan.HorizonStart.UTC().Format(time.RFC3339Nano), plan.HorizonEnd.UTC().Format(time.RFC3339Nano))
	for _, placement := range plan.Placements {
		fmt.Fprintf(h, "|%s|%s|%s", placement.ItemID, placement.Start.UTC().Format(time.RFC3339Nano), placement.End.UTC().Format(time.RFC3339Nano))
	}
	for _, missed := range plan.Unscheduled {
		fmt.Fprintf(h, "|miss:%s", missed.ItemID)
	}
	return "plan_" + hex.EncodeToString(h.Sum(nil)[:10])
}

func round(value float64) float64 { return math.Round(value*100) / 100 }

func abs(value int) int {
	if value < 0 {
		return -value
	}
	return value
}
