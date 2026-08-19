// Request decoding and response writing — the plumbing every handler shares.
package api

import (
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
)

// A Touch failure is non-fatal — the mutation already landed. Metadata-only
// (comment/reply/reviewed-file) never moves file content, so it publishes a
// diff=false ping and the client refetches the review but not the diff.
func (s *Server) notify(reviewID int64) {
	_ = s.Store.Touch(reviewID)
	s.hub.publish(reviewID, false)
}

// maxBodyBytes caps a request body: comment/reply bodies are small, so this only
// stops a buggy/hostile client from spilling a huge payload into memory and the DB.
const maxBodyBytes = 8 << 20 // 8 MiB

func decodeBody[T any](w http.ResponseWriter, r *http.Request) (req T, ok bool) {
	r.Body = http.MaxBytesReader(w, r.Body, maxBodyBytes)
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httpError(w, http.StatusBadRequest, err)
		return req, false
	}
	return req, true
}

func pathID(w http.ResponseWriter, r *http.Request) (int64, bool) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		httpError(w, http.StatusBadRequest, errString("invalid id"))
		return 0, false
	}
	return id, true
}

func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(v)
}

func httpError(w http.ResponseWriter, code int, err error) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
}

func storeError(w http.ResponseWriter, err error) {
	if errors.Is(err, sql.ErrNoRows) {
		httpError(w, http.StatusNotFound, errString("not found"))
		return
	}
	httpError(w, http.StatusInternalServerError, err)
}

type errString string

func (e errString) Error() string { return string(e) }
