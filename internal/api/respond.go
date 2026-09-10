// Request decoding and response writing — the plumbing every handler shares.
package api

import (
	"encoding/json"
	"net/http"
	"strconv"
)

// notify sends a metadata-only ping; a failed Touch is non-fatal, the mutation already landed.
func (s *Server) notify(reviewID int64) {
	_ = s.Store.Touch(reviewID)
	s.hub.publish(reviewID, false)
}

// maxBodyBytes stops a buggy or hostile client from spilling a huge payload into memory and the DB.
const maxBodyBytes = 8 << 20 // 8 MiB

func decodeBody[T any](w http.ResponseWriter, r *http.Request) (req T, err error) {
	r.Body = http.MaxBytesReader(w, r.Body, maxBodyBytes)
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		return req, badRequest(err)
	}
	return req, nil
}

func pathID(r *http.Request) (int64, error) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		return 0, badRequest(errString("invalid id"))
	}
	return id, nil
}

func writeJSON(w http.ResponseWriter, v any) error {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(v)
	return nil
}

// noContent is the success return for a mutation with nothing to send back.
func noContent(w http.ResponseWriter) error {
	w.WriteHeader(http.StatusNoContent)
	return nil
}
