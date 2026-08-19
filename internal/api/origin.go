package api

import (
	"net/http"
	"strings"
)

// WithSameOrigin rejects state-changing requests that a browser tells us came from
// another site.
//
// Binding to loopback keeps the network out, but not the browser: every page the
// user visits can reach 127.0.0.1, and a plain auto-submitting <form> is a CORS
// "simple request" — no preflight, so it lands in the handler. That reaches every
// POST here, including /reset (destroys a review, needs no body at all), /resolved
// (quietly drops threads from the export) and /comments (writes text into an
// artifact the user then hands a coding agent to act on). PATCH/DELETE are already
// covered, since those force a preflight the browser won't get an answer to.
//
// The check is by header, not by token, because this tool has no session to hang a
// token off — and because the agent-facing API must keep working from curl. Both
// headers below are browser-supplied and cannot be set by page script on a
// cross-site request, so their absence is the signal that no browser is involved.
func WithSameOrigin(h http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !sameOriginOK(r) {
			httpError(w, http.StatusForbidden, errString(
				"cross-site request refused: this API only accepts writes from the local-review page itself"))
			return
		}
		h.ServeHTTP(w, r)
	})
}

func sameOriginOK(r *http.Request) bool {
	// Reads change nothing, and exempting them keeps the SSE stream, /api/blob's
	// <img> loads and the embedded static assets working regardless of headers.
	switch r.Method {
	case http.MethodGet, http.MethodHead, http.MethodOptions:
		return true
	}

	// Sec-Fetch-Site is checked first, and that ordering is load-bearing: under
	// `npm run dev` the browser talks to Vite on :5173, which forwards an Origin of
	// its own while our Host is 127.0.0.1:7777. Sec-Fetch-Site still reads
	// same-origin there, so the dev proxy keeps working; falling through to the
	// Origin comparison would break it.
	// Spec says lowercase, but normalize rather than trust a proxy to have left it
	// alone — a value we fail to recognize must not read as "header absent".
	if site := strings.ToLower(strings.TrimSpace(r.Header.Get("Sec-Fetch-Site"))); site != "" {
		// "none" is a user-initiated load (typed URL, bookmark) — no other page is
		// driving it. "same-site" is a *different* origin on the same registrable
		// domain, e.g. another localhost port, which is not this app.
		return site == "same-origin" || site == "none"
	}

	// Older browsers send Origin but not Sec-Fetch-Site.
	if origin := r.Header.Get("Origin"); origin != "" {
		return origin == "http://"+r.Host || origin == "https://"+r.Host
	}

	// Neither header: not a browser. curl, an API agent, a Go client — none of them
	// carry ambient credentials or a user's session, so there is nothing to forge.
	return true
}
