// How a failure becomes a status: handlers return errors and this is the one place that writes them.
package api

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
)

type errString string

func (e errString) Error() string { return string(e) }

// statusError pins a status to a failure where the failure is understood, rather than at
// whichever ResponseWriter it reaches — which is how three read handlers came to report a
// dead database as 404 "not found".
type statusError struct {
	code int
	err  error
}

func (e *statusError) Error() string { return e.err.Error() }
func (e *statusError) Unwrap() error { return e.err }

// An error carrying no status is a server fault; these are the only ways to say otherwise.
func badRequest(err error) error { return &statusError{http.StatusBadRequest, err} }

func badRequestf(format string, a ...any) error { return badRequest(fmt.Errorf(format, a...)) }

func notFoundf(format string, a ...any) error {
	return &statusError{http.StatusNotFound, fmt.Errorf(format, a...)}
}

func forbidden(msg string) error { return &statusError{http.StatusForbidden, errString(msg)} }

// storeErr maps a store failure: a missing row is the client asking for something that
// isn't there, anything else is ours and stays a 500 with the driver's message.
func storeErr(err error) error {
	if errors.Is(err, sql.ErrNoRows) {
		return &statusError{http.StatusNotFound, errString("not found")}
	}
	return err
}

// handlerFunc reports failure by returning it, so a handler cannot write an error and then
// fall through into its success path — the mistake the old write-and-remember-to-return invited.
type handlerFunc func(http.ResponseWriter, *http.Request) error

func handle(h handlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if err := h(w, r); err != nil {
			writeError(w, err)
		}
	}
}

func writeError(w http.ResponseWriter, err error) {
	code := http.StatusInternalServerError
	var se *statusError
	if errors.As(err, &se) {
		code = se.code
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
}
