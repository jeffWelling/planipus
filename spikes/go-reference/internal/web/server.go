package web

import (
	"crypto/hmac"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"net"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/planipus-dev/planipus-spike/internal/domain"
	"github.com/planipus-dev/planipus-spike/internal/scheduler"
	"github.com/planipus-dev/planipus-spike/internal/store"
)

type Config struct {
	AuthToken      string
	InsecureNoAuth bool
	CookieSecure   bool
}

type Server struct {
	store     *store.Store
	engine    *scheduler.Engine
	config    Config
	now       func() time.Time
	handler   http.Handler
	session   string
	loginMu   sync.Mutex
	login     map[string]loginWindow
	metrics   metrics
}

type loginWindow struct {
	started time.Time
	count   int
}

type metrics struct {
	requests        atomic.Uint64
	requestMicros   atomic.Uint64
	previews        atomic.Uint64
	applies         atomic.Uint64
	conflicts       atomic.Uint64
	placements      atomic.Uint64
	unscheduled     atomic.Uint64
	loginFailures   atomic.Uint64
}

func NewServer(data *store.Store, engine *scheduler.Engine, config Config, now func() time.Time) (*Server, error) {
	if data == nil || engine == nil {
		return nil, fmt.Errorf("store and scheduler are required")
	}
	if now == nil {
		now = time.Now
	}
	if config.AuthToken == "" && !config.InsecureNoAuth {
		return nil, fmt.Errorf("PLANIPUS_SPIKE_AUTH_TOKEN is required unless PLANIPUS_SPIKE_INSECURE_NO_AUTH=true")
	}
	if config.AuthToken != "" && len(config.AuthToken) < 32 {
		return nil, fmt.Errorf("PLANIPUS_SPIKE_AUTH_TOKEN must be at least 32 characters")
	}
	s := &Server{store: data, engine: engine, config: config, now: now, login: make(map[string]loginWindow)}
	if config.AuthToken != "" {
		mac := hmac.New(sha256.New, []byte(config.AuthToken))
		_, _ = mac.Write([]byte("planipus-spike-session-v1"))
		s.session = hex.EncodeToString(mac.Sum(nil))
	}
	s.handler = s.routes()
	return s, nil
}

func (s *Server) Handler() http.Handler { return s.handler }

func (s *Server) routes() http.Handler {
	mux := http.NewServeMux()
	assets, _ := fs.Sub(staticFiles, "static")
	assetHandler := http.FileServer(http.FS(assets))
	mux.Handle("GET /assets/", http.StripPrefix("/assets/", withAssetCache(assetHandler)))
	mux.HandleFunc("GET /", s.index)
	mux.HandleFunc("GET /healthz", s.health)
	mux.HandleFunc("GET /readyz", s.ready)
	mux.HandleFunc("GET /metrics", s.renderMetrics)
	mux.HandleFunc("POST /api/v1/session", s.createSession)
	mux.HandleFunc("DELETE /api/v1/session", s.deleteSession)
	mux.Handle("GET /api/v1/snapshot", s.requireAuth(http.HandlerFunc(s.snapshot)))
	mux.Handle("POST /api/v1/tasks", s.requireAuth(http.HandlerFunc(s.createTask)))
	mux.Handle("POST /api/v1/plans/preview", s.requireAuth(http.HandlerFunc(s.previewPlan)))
	mux.Handle("POST /api/v1/plans/{planID}/apply", s.requireAuth(http.HandlerFunc(s.applyPlan)))
	return s.observe(s.securityHeaders(mux))
}

func (s *Server) index(w http.ResponseWriter, r *http.Request) {
	data, err := staticFiles.ReadFile("static/index.html")
	if err != nil {
		http.Error(w, "interface unavailable", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	_, _ = w.Write(data)
}

func (s *Server) health(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"status": "ok", "service": "planipus-spike"})
}

func (s *Server) ready(w http.ResponseWriter, _ *http.Request) {
	if !s.store.IsWritable() {
		writeJSON(w, http.StatusServiceUnavailable, map[string]any{"status": "not_ready", "reason": "state path is not writable"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"status": "ready"})
}

func (s *Server) createSession(w http.ResponseWriter, r *http.Request) {
	if !s.sameOrigin(r) {
		writeError(w, http.StatusForbidden, "origin_not_allowed", "Request origin is not allowed.")
		return
	}
	if s.config.InsecureNoAuth && s.config.AuthToken == "" {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	if !s.allowLogin(r) {
		writeError(w, http.StatusTooManyRequests, "rate_limited", "Too many login attempts. Try again in one minute.")
		return
	}
	var request struct {
		Token string `json:"token"`
	}
	if err := decodeJSON(w, r, &request, 4096); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json", err.Error())
		return
	}
	if subtle.ConstantTimeCompare([]byte(request.Token), []byte(s.config.AuthToken)) != 1 {
		s.metrics.loginFailures.Add(1)
		writeError(w, http.StatusUnauthorized, "invalid_token", "The access token was not accepted.")
		return
	}
	http.SetCookie(w, &http.Cookie{
		Name: "planipus_spike_session", Value: s.session, Path: "/", MaxAge: 12 * 60 * 60,
		HttpOnly: true, Secure: s.config.CookieSecure, SameSite: http.SameSiteStrictMode,
	})
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) deleteSession(w http.ResponseWriter, r *http.Request) {
	if !s.sameOrigin(r) {
		writeError(w, http.StatusForbidden, "origin_not_allowed", "Request origin is not allowed.")
		return
	}
	http.SetCookie(w, &http.Cookie{
		Name: "planipus_spike_session", Value: "", Path: "/", MaxAge: -1,
		HttpOnly: true, Secure: s.config.CookieSecure, SameSite: http.SameSiteStrictMode,
	})
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) snapshot(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, s.store.State().Snapshot())
}

func (s *Server) createTask(w http.ResponseWriter, r *http.Request) {
	if !s.authorizeMutation(r) {
		writeError(w, http.StatusForbidden, "csrf_failed", "Mutation requires a same-origin CSRF header or bearer token.")
		return
	}
	var request struct {
		Title           string        `json:"title"`
		Kind            domain.ItemKind `json:"kind"`
		Priority        int           `json:"priority"`
		DurationMinutes int           `json:"durationMinutes"`
		Earliest        *time.Time    `json:"earliest"`
		Deadline        time.Time     `json:"deadline"`
		IdealMinute     int           `json:"idealMinute"`
		Energy          domain.Energy `json:"energy"`
		Context         string        `json:"context"`
	}
	if err := decodeJSON(w, r, &request, 32*1024); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json", err.Error())
		return
	}
	now := s.now()
	earliest := now
	if request.Earliest != nil {
		earliest = *request.Earliest
	}
	if request.Kind == "" {
		request.Kind = domain.KindTask
	}
	if request.Energy == "" {
		request.Energy = domain.EnergyAny
	}
	item, err := s.store.AddItem(domain.WorkItem{
		Title: request.Title, Kind: request.Kind, Priority: request.Priority,
		DurationMinutes: request.DurationMinutes, Earliest: earliest, Deadline: request.Deadline,
		IdealMinute: request.IdealMinute, Energy: request.Energy, Context: strings.TrimSpace(request.Context),
	}, "admin", now)
	if err != nil {
		if errors.Is(err, store.ErrInvalid) {
			writeError(w, http.StatusUnprocessableEntity, "invalid_task", "Task needs a title, P1-P4 priority, 15-1440 minute duration, and a deadline after its earliest start.")
			return
		}
		writeError(w, http.StatusInternalServerError, "store_failed", "The task could not be saved.")
		return
	}
	writeJSON(w, http.StatusCreated, item)
}

func (s *Server) previewPlan(w http.ResponseWriter, r *http.Request) {
	if !s.authorizeMutation(r) {
		writeError(w, http.StatusForbidden, "csrf_failed", "Mutation requires a same-origin CSRF header or bearer token.")
		return
	}
	now := s.now()
	plan, err := s.engine.Preview(s.store.State(), now)
	if err != nil {
		writeError(w, http.StatusUnprocessableEntity, "planning_failed", err.Error())
		return
	}
	if err := s.store.SavePreview(plan, "admin", now); err != nil {
		if errors.Is(err, store.ErrRevisionConflict) {
			s.metrics.conflicts.Add(1)
			writeError(w, http.StatusConflict, "revision_conflict", "The schedule changed while the preview was being calculated. Preview again.")
			return
		}
		writeError(w, http.StatusInternalServerError, "store_failed", "The preview could not be saved.")
		return
	}
	s.metrics.previews.Add(1)
	s.metrics.placements.Add(uint64(len(plan.Placements)))
	s.metrics.unscheduled.Add(uint64(len(plan.Unscheduled)))
	writeJSON(w, http.StatusCreated, plan)
}

func (s *Server) applyPlan(w http.ResponseWriter, r *http.Request) {
	if !s.authorizeMutation(r) {
		writeError(w, http.StatusForbidden, "csrf_failed", "Mutation requires a same-origin CSRF header or bearer token.")
		return
	}
	planID := r.PathValue("planID")
	if len(planID) < 8 || len(planID) > 80 {
		writeError(w, http.StatusBadRequest, "invalid_plan", "Plan identifier is invalid.")
		return
	}
	plan, err := s.store.ApplyPlan(planID, "admin", s.now())
	if err != nil {
		switch {
		case errors.Is(err, store.ErrNotFound):
			writeError(w, http.StatusNotFound, "not_found", "Plan was not found.")
		case errors.Is(err, store.ErrRevisionConflict):
			s.metrics.conflicts.Add(1)
			writeError(w, http.StatusConflict, "revision_conflict", "This preview is stale because the schedule changed. Preview again.")
		default:
			writeError(w, http.StatusInternalServerError, "store_failed", "The plan could not be applied.")
		}
		return
	}
	s.metrics.applies.Add(1)
	writeJSON(w, http.StatusOK, plan)
}

func (s *Server) requireAuth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if s.config.InsecureNoAuth && s.config.AuthToken == "" {
			next.ServeHTTP(w, r)
			return
		}
		if s.validBearer(r) {
			next.ServeHTTP(w, r)
			return
		}
		cookie, err := r.Cookie("planipus_spike_session")
		if err != nil || subtle.ConstantTimeCompare([]byte(cookie.Value), []byte(s.session)) != 1 {
			writeError(w, http.StatusUnauthorized, "authentication_required", "Sign in to continue.")
			return
		}
		next.ServeHTTP(w, r)
	})
}

func (s *Server) authorizeMutation(r *http.Request) bool {
	if s.validBearer(r) {
		return true
	}
	return r.Header.Get("X-Planipus-Spike-CSRF") == "1" && s.sameOrigin(r)
}

func (s *Server) validBearer(r *http.Request) bool {
	if s.config.AuthToken == "" {
		return false
	}
	value := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
	if value == r.Header.Get("Authorization") || value == "" {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(value), []byte(s.config.AuthToken)) == 1
}

func (s *Server) sameOrigin(r *http.Request) bool {
	origin := r.Header.Get("Origin")
	if origin == "" {
		return true
	}
	parsed, err := url.Parse(origin)
	if err != nil {
		return false
	}
	return strings.EqualFold(parsed.Host, r.Host)
}

func (s *Server) allowLogin(r *http.Request) bool {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		host = r.RemoteAddr
	}
	now := s.now()
	s.loginMu.Lock()
	defer s.loginMu.Unlock()
	entry := s.login[host]
	if entry.started.IsZero() || now.Sub(entry.started) >= time.Minute {
		entry = loginWindow{started: now}
	}
	entry.count++
	s.login[host] = entry
	return entry.count <= 5
}

func (s *Server) renderMetrics(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "text/plain; version=0.0.4; charset=utf-8")
	fmt.Fprintf(w, "# HELP planipus_spike_http_requests_total Total HTTP requests.\n")
	fmt.Fprintf(w, "# TYPE planipus_spike_http_requests_total counter\n")
	fmt.Fprintf(w, "planipus_spike_http_requests_total %d\n", s.metrics.requests.Load())
	fmt.Fprintf(w, "# HELP planipus_spike_http_request_duration_seconds_sum Sum of request duration.\n")
	fmt.Fprintf(w, "# TYPE planipus_spike_http_request_duration_seconds_sum counter\n")
	fmt.Fprintf(w, "planipus_spike_http_request_duration_seconds_sum %.6f\n", float64(s.metrics.requestMicros.Load())/1_000_000)
	values := []struct {
		name string
		help string
		value uint64
	}{
		{"planipus_spike_plan_previews_total", "Schedule previews created.", s.metrics.previews.Load()},
		{"planipus_spike_plan_applies_total", "Schedule plans applied.", s.metrics.applies.Load()},
		{"planipus_spike_revision_conflicts_total", "Stale preview conflicts.", s.metrics.conflicts.Load()},
		{"planipus_spike_placements_total", "Placements proposed.", s.metrics.placements.Load()},
		{"planipus_spike_unscheduled_total", "Items not placed.", s.metrics.unscheduled.Load()},
		{"planipus_spike_login_failures_total", "Rejected login attempts.", s.metrics.loginFailures.Load()},
	}
	for _, metric := range values {
		fmt.Fprintf(w, "# HELP %s %s\n# TYPE %s counter\n%s %d\n", metric.name, metric.help, metric.name, metric.name, metric.value)
	}
}

func (s *Server) observe(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		started := time.Now()
		s.metrics.requests.Add(1)
		next.ServeHTTP(w, r)
		s.metrics.requestMicros.Add(uint64(time.Since(started).Microseconds()))
	})
}

func (s *Server) securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'")
		w.Header().Set("Referrer-Policy", "no-referrer")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("X-Frame-Options", "DENY")
		w.Header().Set("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=()")
		if s.config.CookieSecure {
			w.Header().Set("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
		}
		next.ServeHTTP(w, r)
	})
}

func withAssetCache(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "public, max-age=3600")
		next.ServeHTTP(w, r)
	})
}

func decodeJSON(w http.ResponseWriter, r *http.Request, target any, limit int64) error {
	if contentType := r.Header.Get("Content-Type"); !strings.HasPrefix(contentType, "application/json") {
		return fmt.Errorf("Content-Type must be application/json")
	}
	r.Body = http.MaxBytesReader(w, r.Body, limit)
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		return fmt.Errorf("invalid JSON: %w", err)
	}
	if decoder.Decode(&struct{}{}) == nil {
		return fmt.Errorf("request must contain one JSON value")
	}
	return nil
}

func writeError(w http.ResponseWriter, status int, code, message string) {
	writeJSON(w, status, map[string]any{"error": map[string]string{"code": code, "message": message}})
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}

func ParseBool(value string, fallback bool) bool {
	if value == "" {
		return fallback
	}
	parsed, err := strconv.ParseBool(value)
	if err != nil {
		return fallback
	}
	return parsed
}
