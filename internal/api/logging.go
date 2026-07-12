package api

import (
	"bytes"
	"log"
	"net/http"
	"strings"
)

// WithErrorLogging logs any 4xx/5xx response (with its JSON error body) to the
// console. Wrapping the whole mux is safe: static assets fall back to index.html
// (200), so only genuine API failures are logged.
func WithErrorLogging(h http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		rec := &statusRecorder{ResponseWriter: w, status: http.StatusOK}
		h.ServeHTTP(rec, r)
		if rec.status >= 400 {
			log.Printf("http %d %s %s: %s", rec.status, r.Method, r.URL.Path,
				strings.TrimSpace(rec.body.String()))
		}
	})
}

// statusRecorder captures the status and error-response body for WithErrorLogging.
type statusRecorder struct {
	http.ResponseWriter
	status int
	body   bytes.Buffer
}

func (s *statusRecorder) WriteHeader(code int) {
	s.status = code
	s.ResponseWriter.WriteHeader(code)
}

func (s *statusRecorder) Write(b []byte) (int, error) {
	if s.status >= 400 {
		s.body.Write(b) // error bodies are small; captured only for logging
	}
	return s.ResponseWriter.Write(b)
}

// Flush forwards to the underlying writer so the SSE handler's Flusher assertion
// still succeeds through the wrapper.
func (s *statusRecorder) Flush() {
	if f, ok := s.ResponseWriter.(http.Flusher); ok {
		f.Flush()
	}
}
