package api

import (
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

// countGit puts a shim named `git` ahead of the real one on PATH, which records every
// invocation and then execs it, and returns the command lines one request produced. t.Setenv
// is what keeps this honest: it refuses to run under t.Parallel, and no test here is parallel.
func countGit(t *testing.T, s *Server, h func(http.ResponseWriter, *http.Request) error, path, query string) (int, []string) {
	t.Helper()
	real, err := exec.LookPath("git")
	if err != nil {
		t.Skip("no git on PATH")
	}
	dir := t.TempDir()
	log := filepath.Join(dir, "invocations")
	shim := "#!/bin/sh\necho \"$@\" >> " + log + "\nexec " + real + " \"$@\"\n"
	if err := os.WriteFile(filepath.Join(dir, "git"), []byte(shim), 0o755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", dir+string(os.PathListSeparator)+os.Getenv("PATH"))

	req := httptest.NewRequest(http.MethodGet, path+"?"+query, nil)
	rec := httptest.NewRecorder()
	handle(h)(rec, req)

	body, _ := os.ReadFile(log)
	var calls []string
	for _, line := range strings.Split(string(body), "\n") {
		if strings.TrimSpace(line) != "" {
			calls = append(calls, line)
		}
	}
	return rec.Code, calls
}

// Every `diff` ping the filesystem poller raises costs a /api/diff, and while an agent works
// that is one every 1.5s — where a git process is ~11ms of spawn whatever it then does. Taking
// the merge-base directly, rather than proving the base resolves first and then taking it,
// settles the usual case in one process instead of two. This pins that: a number going up here
// is a per-ping cost, and nothing else in the suite would notice. The third is the one batched
// `check-attr` behind the generated-file flag — it asks about every path at once, so it stays one
// however many files the diff holds.
func TestDiffTakesTheBaseInOneProcess(t *testing.T) {
	r := newRepo(t)
	r.write("f.txt", "l1\n")
	r.commitAll("c1")
	r.git("checkout", "-q", "-b", "feature")
	r.write("f.txt", "l1\nl2\n")
	r.commitAll("c2")
	s := r.server()

	code, calls := countGit(t, s, s.handleDiff, "/api/diff", "repo="+r.name+"&head=feature&base=main")
	if code != http.StatusOK {
		t.Fatalf("status = %d, want 200", code)
	}
	if len(calls) != 3 {
		t.Errorf("a diff with a resolvable base ran %d git processes, want 3 (merge-base, diff, check-attr):\n  %s",
			len(calls), strings.Join(calls, "\n  "))
	}
}
