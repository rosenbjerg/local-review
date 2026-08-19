package api

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

// The middleware is a pure function of method + two headers, so table-test it
// directly rather than through a router.
func TestWithSameOrigin(t *testing.T) {
	const host = "127.0.0.1:7777"

	cases := []struct {
		name    string
		method  string
		site    string // Sec-Fetch-Site
		origin  string // Origin
		allowed bool
	}{
		// The browser app itself.
		{"same-origin POST", http.MethodPost, "same-origin", "http://" + host, true},
		{"user-initiated POST", http.MethodPost, "none", "", true},

		// The attack this exists for: a form on another page posting to loopback.
		{"cross-site POST", http.MethodPost, "cross-site", "https://evil.example", false},
		{"cross-site DELETE", http.MethodDelete, "cross-site", "https://evil.example", false},
		// A different port on localhost is a different app, not this one.
		{"same-site POST", http.MethodPost, "same-site", "http://localhost:3000", false},

		// Sec-Fetch-Site wins over Origin, which is what keeps the Vite dev proxy
		// working: it forwards its own :5173 Origin while Host is :7777.
		{"dev proxy: same-origin site, foreign origin", http.MethodPost, "same-origin", "http://localhost:5173", true},

		// Older browsers: no Sec-Fetch-Site, so Origin decides.
		{"origin matches host", http.MethodPost, "", "http://" + host, true},
		{"origin mismatches host", http.MethodPost, "", "https://evil.example", false},

		// Not a browser at all — the agent-facing API must keep working.
		{"no browser headers", http.MethodPost, "", "", true},
		{"no browser headers, PATCH", http.MethodPatch, "", "", true},

		// Reads change nothing; blocking them would break <img src=/api/blob> and
		// the SSE stream for no gain.
		{"cross-site GET", http.MethodGet, "cross-site", "https://evil.example", true},
		{"cross-site HEAD", http.MethodHead, "cross-site", "https://evil.example", true},

		// A value we don't recognize must read as "refuse", not as "header absent".
		{"unknown site value", http.MethodPost, "weird", "http://" + host, false},
		{"padded/uppercase site value", http.MethodPost, "  Same-Origin ", "", true},
	}

	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			reached := false
			h := WithSameOrigin(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
				reached = true
			}))

			req := httptest.NewRequest(c.method, "http://"+host+"/api/reviews/1/reset", nil)
			req.Host = host
			if c.site != "" {
				req.Header.Set("Sec-Fetch-Site", c.site)
			}
			if c.origin != "" {
				req.Header.Set("Origin", c.origin)
			}
			rec := httptest.NewRecorder()
			h.ServeHTTP(rec, req)

			if reached != c.allowed {
				t.Errorf("handler reached = %v, want %v", reached, c.allowed)
			}
			if !c.allowed && rec.Code != http.StatusForbidden {
				t.Errorf("status = %d, want %d", rec.Code, http.StatusForbidden)
			}
		})
	}
}
