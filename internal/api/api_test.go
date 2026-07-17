package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"local-review/internal/git"
	"local-review/internal/store"
)

// --- pure validators ---

func TestValidRef(t *testing.T) {
	for _, ok := range []string{"main", "feature/x", "abc123", "HEAD", "origin/main"} {
		if err := validRef(ok); err != nil {
			t.Errorf("validRef(%q) = %v, want nil", ok, err)
		}
	}
	for _, bad := range []string{"", "-x", "--output=/etc/passwd", "-n"} {
		if err := validRef(bad); err == nil {
			t.Errorf("validRef(%q) should be rejected (flag/empty)", bad)
		}
	}
}

func TestValidCommentType(t *testing.T) {
	for _, ok := range []store.CommentType{store.CommentBug, store.CommentSuggestion, store.CommentQuestion, store.CommentNit} {
		if !validCommentType(ok) {
			t.Errorf("validCommentType(%q) should be true", ok)
		}
	}
	for _, bad := range []store.CommentType{"", "issue", "praise", "Bug"} {
		if validCommentType(bad) {
			t.Errorf("validCommentType(%q) should be false", bad)
		}
	}
}

func TestSanitize(t *testing.T) {
	cases := map[string]string{
		"feature/x y:z": "feature-x-y-z",
		"plain":         "plain",
		"a/b/c":         "a-b-c",
	}
	for in, want := range cases {
		if got := sanitize(in); got != want {
			t.Errorf("sanitize(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestMimeForPath(t *testing.T) {
	cases := map[string]string{
		"a.png":       "image/png",
		"a.JPG":       "image/jpeg",
		"a.jpeg":      "image/jpeg",
		"a.svg":       "image/svg+xml",
		"a.avif":      "image/avif",
		"a.weirdext1": "application/octet-stream",
	}
	for in, want := range cases {
		if got := mimeForPath(in); got != want {
			t.Errorf("mimeForPath(%q) = %q, want %q", in, got, want)
		}
	}
}

// repoFor must reject anything that isn't a single path segment naming a real repo
// under the root — the path-traversal guard.
func TestRepoForTraversal(t *testing.T) {
	r := newRepo(t)
	s := r.server()

	if _, err := s.repoFor(r.name); err != nil {
		t.Errorf("repoFor(%q) = %v, want a repo", r.name, err)
	}
	for _, bad := range []string{"", ".", "..", "../proj", "a/b", `a\b`, "nope"} {
		if _, err := s.repoFor(bad); err == nil {
			t.Errorf("repoFor(%q) should be rejected", bad)
		}
	}
}

// --- diff scope handler ---

type diffResp struct {
	Base  string         `json:"base"`
	Head  string         `json:"head"`
	Files []git.FileDiff `json:"files"`
}

func getDiff(t *testing.T, s *Server, query string) (int, diffResp) {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, "/api/diff?"+query, nil)
	rec := httptest.NewRecorder()
	s.handleDiff(rec, req)
	var d diffResp
	if rec.Code == http.StatusOK {
		if err := json.Unmarshal(rec.Body.Bytes(), &d); err != nil {
			t.Fatalf("decode diff: %v (body %s)", err, rec.Body.String())
		}
	}
	return rec.Code, d
}

func newPaths(d diffResp) []string {
	out := []string{}
	for _, f := range d.Files {
		out = append(out, f.NewPath)
	}
	return sortedStrings(out)
}

func eqStrings(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

// A repo with a branch that adds feat.txt over main, plus a staged change, an
// unstaged change, and an untracked file on the branch's working tree.
func diffFixture(t *testing.T) (*testRepo, *Server, string) {
	r := newRepo(t)
	r.write("base.txt", "a\nb\nc\n")
	r.commitAll("init")
	r.git("checkout", "-q", "-b", "feature")
	r.write("feat.txt", "x\n")
	featSHA := r.commitAll("feat commit")

	r.write("base.txt", "a\nb-staged\nc\n")
	r.git("add", "base.txt")                            // staged
	r.write("base.txt", "a\nb-staged\nc\nd-unstaged\n") // unstaged on top
	r.write("unt.txt", "u\n")                           // untracked
	return r, r.server(), featSHA
}

func TestHandleDiffScopes(t *testing.T) {
	r, s, featSHA := diffFixture(t)

	cases := []struct {
		name  string
		query string
		want  []string
	}{
		{"committed (whole branch)", "repo=" + r.name + "&head=feature", []string{"feat.txt"}},
		{"uncommitted + unstaged", "repo=" + r.name + "&head=feature&uncommitted=true&unstaged=true", []string{"base.txt", "feat.txt", "unt.txt"}},
		{"uncommitted staged-only", "repo=" + r.name + "&head=feature&uncommitted=true&unstaged=false", []string{"base.txt", "feat.txt"}},
		{"from=featureHEAD is exclusive → empty", "repo=" + r.name + "&head=feature&from=" + featSHA, []string{}},
	}
	for _, c := range cases {
		code, d := getDiff(t, s, c.query)
		if code != http.StatusOK {
			t.Errorf("%s: status %d, want 200", c.name, code)
			continue
		}
		if got := newPaths(d); !eqStrings(got, c.want) {
			t.Errorf("%s: files = %v, want %v", c.name, got, c.want)
		}
	}
}

func TestHandleDiffBadParams(t *testing.T) {
	r, s, _ := diffFixture(t)

	if code, _ := getDiff(t, s, "repo="+r.name+"&head=feature&from=deadbeef"); code != http.StatusBadRequest {
		t.Errorf("unknown from: status %d, want 400", code)
	}
	if code, _ := getDiff(t, s, "repo="+r.name); code != http.StatusBadRequest {
		t.Errorf("missing head: status %d, want 400", code)
	}
	if code, _ := getDiff(t, s, "head=feature"); code != http.StatusBadRequest {
		t.Errorf("missing repo: status %d, want 400", code)
	}
}

// --- commit picker handler ---

type commitsResp struct {
	Commits []git.Commit `json:"commits"`
}

func getCommits(t *testing.T, s *Server, query string) (int, commitsResp) {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, "/api/commits?"+query, nil)
	rec := httptest.NewRecorder()
	s.handleCommits(rec, req)
	var c commitsResp
	if rec.Code == http.StatusOK {
		if err := json.Unmarshal(rec.Body.Bytes(), &c); err != nil {
			t.Fatalf("decode commits: %v (body %s)", err, rec.Body.String())
		}
	}
	return rec.Code, c
}

func subjects(c commitsResp) []string {
	out := []string{}
	for _, x := range c.Commits {
		out = append(out, x.Subject)
	}
	return out
}

// The picker must list only the branch's own commits (base..head), never
// base-branch history behind the merge point, even after the base advances.
func TestHandleCommitsScopedToBranch(t *testing.T) {
	r := newRepo(t)
	for _, m := range []string{"c1", "c2", "c3"} {
		r.write("base.txt", m+"\n")
		r.commitAll(m)
	}
	r.git("checkout", "-q", "-b", "feature")
	for _, m := range []string{"c4", "c5"} {
		r.write("feat.txt", m+"\n")
		r.commitAll(m)
	}
	r.git("checkout", "-q", "main")
	r.write("base.txt", "c6\n")
	r.commitAll("c6") // base advances past the branch point
	s := r.server()

	code, c := getCommits(t, s, "repo="+r.name+"&ref=feature&base=main")
	if code != http.StatusOK {
		t.Fatalf("status %d, want 200", code)
	}
	if got := subjects(c); !eqStrings(got, []string{"c5", "c4"}) {
		t.Errorf("explicit base: subjects = %v, want [c5 c4]", got)
	}

	// base omitted → resolves to the main branch → same scoped list.
	_, c = getCommits(t, s, "repo="+r.name+"&ref=feature")
	if got := subjects(c); !eqStrings(got, []string{"c5", "c4"}) {
		t.Errorf("auto base: subjects = %v, want [c5 c4]", got)
	}

	// Reviewing a branch against itself has no own-commits.
	_, c = getCommits(t, s, "repo="+r.name+"&ref=main&base=main")
	if len(c.Commits) != 0 {
		t.Errorf("main..main: subjects = %v, want empty", subjects(c))
	}
}

func TestHandleCommitsBadParams(t *testing.T) {
	r := newRepo(t)
	r.write("f.txt", "x\n")
	r.commitAll("c1")
	s := r.server()

	if code, _ := getCommits(t, s, "repo="+r.name+"&ref=-flag"); code != http.StatusBadRequest {
		t.Errorf("flag-like ref: status %d, want 400", code)
	}
	if code, _ := getCommits(t, s, "repo="+r.name); code != http.StatusBadRequest {
		t.Errorf("missing ref: status %d, want 400", code)
	}
}
