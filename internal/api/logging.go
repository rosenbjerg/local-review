package api

import (
	"bytes"
	"log"
	"net/http"
	"strings"
)

// WithErrorLogging wraps h and logs any 4xx/5xx response to the server console
// with the request method, path, status, and the response body (the JSON error
// message httpError writes). 2xx responses are not logged. Wrapping the whole
// mux is safe: static assets fall back to index.html (200), so only genuine
// API failures are logged.
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

// statusRecorder captures the status code, and the body of error responses, so
// WithErrorLogging can log them after the handler returns.
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

// Flush forwards to the underlying writer so the SSE handler's Flusher type
// assertion still succeeds through the wrapper.
func (s *statusRecorder) Flush() {
	if f, ok := s.ResponseWriter.(http.Flusher); ok {
		f.Flush()
	}
}
