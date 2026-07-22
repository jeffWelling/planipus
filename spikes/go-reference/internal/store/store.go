package store

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/planipus-dev/planipus-spike/internal/domain"
)

var (
	ErrNotFound         = errors.New("not found")
	ErrRevisionConflict = errors.New("state changed after this preview was created")
	ErrInvalid          = errors.New("invalid input")
)

type Store struct {
	mu    sync.RWMutex
	path  string
	state domain.State
}

func Open(path string, seed func() domain.State) (*Store, error) {
	if strings.TrimSpace(path) == "" {
		return nil, fmt.Errorf("state path is required")
	}
	s := &Store{path: path}
	data, err := os.ReadFile(path)
	if err == nil {
		if err := json.Unmarshal(data, &s.state); err != nil {
			return nil, fmt.Errorf("decode state: %w", err)
		}
		if s.state.SchemaVersion != 1 {
			return nil, fmt.Errorf("unsupported state schema %d", s.state.SchemaVersion)
		}
		return s, nil
	}
	if !errors.Is(err, os.ErrNotExist) {
		return nil, fmt.Errorf("read state: %w", err)
	}
	s.state = seed()
	if err := s.writeLocked(); err != nil {
		return nil, err
	}
	return s, nil
}

func (s *Store) State() domain.State {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return cloneState(s.state)
}

func (s *Store) AddItem(item domain.WorkItem, actor string, now time.Time) (domain.WorkItem, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	item.Title = strings.TrimSpace(item.Title)
	if item.Title == "" || len(item.Title) > 240 || item.DurationMinutes < 15 || item.DurationMinutes > 24*60 {
		return domain.WorkItem{}, ErrInvalid
	}
	if item.Priority < 1 || item.Priority > 4 {
		return domain.WorkItem{}, ErrInvalid
	}
	if item.Kind != domain.KindTask && item.Kind != domain.KindHabit && item.Kind != domain.KindFocus {
		return domain.WorkItem{}, ErrInvalid
	}
	if item.Deadline.IsZero() || !item.Deadline.After(item.Earliest) {
		return domain.WorkItem{}, ErrInvalid
	}
	if item.ID == "" {
		item.ID = "item_" + randomID(8)
	}
	for _, existing := range s.state.Items {
		if existing.ID == item.ID {
			return domain.WorkItem{}, fmt.Errorf("%w: duplicate item id", ErrInvalid)
		}
	}
	item.CreatedAt = now
	s.state.Items = append(s.state.Items, item)
	s.state.Revision++
	s.markPendingStaleLocked()
	s.appendAuditLocked("item.created", actor, now, map[string]any{"itemId": item.ID, "title": item.Title})
	if err := s.writeLocked(); err != nil {
		return domain.WorkItem{}, err
	}
	return item, nil
}

func (s *Store) SavePreview(plan domain.Plan, actor string, now time.Time) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if plan.BaseRevision != s.state.Revision || plan.Status != domain.PlanPending || plan.ID == "" {
		return ErrRevisionConflict
	}
	for _, existing := range s.state.Plans {
		if existing.ID == plan.ID && existing.Status == domain.PlanPending {
			return nil
		}
	}
	s.markPendingStaleLocked()
	s.state.Plans = append(s.state.Plans, plan)
	if len(s.state.Plans) > 30 {
		s.state.Plans = append([]domain.Plan(nil), s.state.Plans[len(s.state.Plans)-30:]...)
	}
	s.appendAuditLocked("plan.previewed", actor, now, map[string]any{
		"planId": plan.ID, "placements": len(plan.Placements), "unscheduled": len(plan.Unscheduled),
	})
	return s.writeLocked()
}

func (s *Store) ApplyPlan(planID, actor string, now time.Time) (domain.Plan, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	index := -1
	for i := range s.state.Plans {
		if s.state.Plans[i].ID == planID {
			index = i
			break
		}
	}
	if index < 0 {
		return domain.Plan{}, ErrNotFound
	}
	plan := s.state.Plans[index]
	if plan.Status != domain.PlanPending || plan.BaseRevision != s.state.Revision {
		s.state.Plans[index].Status = domain.PlanStale
		_ = s.writeLocked()
		return domain.Plan{}, ErrRevisionConflict
	}
	committed := append([]domain.Placement(nil), plan.Placements...)
	for i := range committed {
		committed[i].Committed = true
	}
	s.state.Committed = committed
	s.state.Plans[index].Status = domain.PlanApplied
	s.state.Revision++
	s.appendAuditLocked("plan.applied", actor, now, map[string]any{
		"planId": plan.ID, "placements": len(plan.Placements), "previousRevision": plan.BaseRevision,
	})
	if err := s.writeLocked(); err != nil {
		return domain.Plan{}, err
	}
	plan.Status = domain.PlanApplied
	return plan, nil
}

func (s *Store) IsWritable() bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	dir := filepath.Dir(s.path)
	file, err := os.CreateTemp(dir, ".planipus-spike-ready-*")
	if err != nil {
		return false
	}
	name := file.Name()
	_ = file.Close()
	_ = os.Remove(name)
	return true
}

func (s *Store) appendAuditLocked(action, actor string, now time.Time, details map[string]any) {
	s.state.Audit = append(s.state.Audit, domain.AuditEntry{
		ID: "audit_" + randomID(8), At: now, Action: action, Actor: actor,
		Revision: s.state.Revision, Details: details,
	})
	if len(s.state.Audit) > 1000 {
		s.state.Audit = append([]domain.AuditEntry(nil), s.state.Audit[len(s.state.Audit)-1000:]...)
	}
}

func (s *Store) markPendingStaleLocked() {
	for i := range s.state.Plans {
		if s.state.Plans[i].Status == domain.PlanPending {
			s.state.Plans[i].Status = domain.PlanStale
		}
	}
}

func (s *Store) writeLocked() error {
	dir := filepath.Dir(s.path)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return fmt.Errorf("create state directory: %w", err)
	}
	temp, err := os.CreateTemp(dir, ".planipus-spike-state-*")
	if err != nil {
		return fmt.Errorf("create state temp file: %w", err)
	}
	tempName := temp.Name()
	cleanup := func() {
		_ = temp.Close()
		_ = os.Remove(tempName)
	}
	if err := temp.Chmod(0o600); err != nil {
		cleanup()
		return fmt.Errorf("secure state temp file: %w", err)
	}
	encoder := json.NewEncoder(temp)
	encoder.SetIndent("", "  ")
	if err := encoder.Encode(s.state); err != nil {
		cleanup()
		return fmt.Errorf("encode state: %w", err)
	}
	if err := temp.Sync(); err != nil {
		cleanup()
		return fmt.Errorf("sync state: %w", err)
	}
	if err := temp.Close(); err != nil {
		cleanup()
		return fmt.Errorf("close state: %w", err)
	}
	if err := os.Rename(tempName, s.path); err != nil {
		cleanup()
		return fmt.Errorf("replace state: %w", err)
	}
	if directory, err := os.Open(dir); err == nil {
		_ = directory.Sync()
		_ = directory.Close()
	}
	return nil
}

func cloneState(source domain.State) domain.State {
	data, err := json.Marshal(source)
	if err != nil {
		panic(fmt.Sprintf("clone state marshal: %v", err))
	}
	var target domain.State
	if err := json.Unmarshal(data, &target); err != nil {
		panic(fmt.Sprintf("clone state unmarshal: %v", err))
	}
	return target
}

func randomID(bytes int) string {
	value := make([]byte, bytes)
	if _, err := io.ReadFull(rand.Reader, value); err != nil {
		panic(fmt.Sprintf("read random source: %v", err))
	}
	return hex.EncodeToString(value)
}
