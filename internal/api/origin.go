package api

import (
	"net/http"
	"strings"
)

// WithSameOrigin refuses non-read requests a browser reports as cross-site: any page
// can POST a plain <form> at 127.0.0.1 with no preflight, and there is no session token.
func WithSameOrigin(h http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !sameOriginOK(r) {
			writeError(w, forbidden(
				"cross-site request refused: this API only accepts writes from the local-review page itself"))
			return
		}
		h.ServeHTTP(w, r)
	})
}

func sameOriginOK(r *http.Request) bool {
	// Reads change nothing; exempting them keeps SSE, /api/blob <img> loads and static assets working.
	switch r.Method {
	case http.MethodGet, http.MethodHead, http.MethodOptions:
		return true
	}

	// Sec-Fetch-Site first: under the Vite dev proxy Origin never matches Host, but this
	// still reads same-origin. Normalized so an unrecognized value can't read as "absent".
	if site := strings.ToLower(strings.TrimSpace(r.Header.Get("Sec-Fetch-Site"))); site != "" {
		// "none" is a user-initiated load; "same-site" is another localhost port, not this app.
		return site == "same-origin" || site == "none"
	}

	// Older browsers send Origin but not Sec-Fetch-Site.
	if origin := r.Header.Get("Origin"); origin != "" {
		return origin == "http://"+r.Host || origin == "https://"+r.Host
	}

	// Neither header means no browser (curl, an API agent), which carries nothing to forge.
	return true
}
