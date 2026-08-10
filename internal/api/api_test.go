package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
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

func TestValidPath(t *testing.T) {
	for _, ok := range []string{"a.txt", "dir/a.txt", "./a.txt", "a/../b.txt", "-dash.txt", "git/x", ".gitignore"} {
		if err := validPath(ok); err != nil {
			t.Errorf("validPath(%q) = %v, want nil", ok, err)
		}
	}
	// Case variants of .git matter: a case-insensitive filesystem resolves them all
	// to the real .git directory.
	for _, bad := range []string{"", "..", "../escape", "a/../../escape", "/etc/passwd", ".git", ".git/config", ".GIT/config", ".Git/HEAD"} {
		if err := validPath(bad); err == nil {
			t.Errorf("validPath(%q) should be rejected", bad)
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

// A symlink placed in the root that resolves to a git repo *outside* the root must
// be rejected — isGitRepo's os.Stat follows the symlink, so only the resolved-path
// confinement stops it.
func TestRepoForSymlinkEscape(t *testing.T) {
	r := newRepo(t)
	s := r.server()

	outside := t.TempDir() // an external "repo" (has a .git dir) outside the served root
	if err := os.MkdirAll(filepath.Join(outside, ".git"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(outside, filepath.Join(r.root, "escape")); err != nil {
		t.Skipf("symlinks unsupported: %v", err)
	}
	if _, err := s.repoFor("escape"); err == nil {
		t.Error("repoFor should reject a symlink resolving outside the root")
	}
}

// The Host header is client-controlled and feeds the exported curl instructions, so
// anything outside a hostname/IP[:port] charset must fall back to the loopback
// default rather than be echoed (shell-injection into a snippet an agent may run).
func TestSafeBaseURL(t *testing.T) {
	const fallback = "http://127.0.0.1:7777"
	cases := map[string]string{
		"127.0.0.1:7777":                "http://127.0.0.1:7777",
		"localhost:7777":                "http://localhost:7777",
		"[::1]:7777":                    "http://[::1]:7777",
		"":                              fallback,
		"127.0.0.1:7777/x; curl evil #": fallback, // slash + shell metachars
		"a`b`c":                         fallback, // backticks
		"host name":                     fallback, // whitespace
	}
	for in, want := range cases {
		if got := safeBaseURL(in); got != want {
			t.Errorf("safeBaseURL(%q) = %q, want %q", in, got, want)
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

// --- file/blob handlers ---

func getFile(t *testing.T, s *Server, path, query string) (int, string) {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, path+"?"+query, nil)
	rec := httptest.NewRecorder()
	if strings.HasSuffix(path, "/blob") {
		s.handleBlob(rec, req)
	} else {
		s.handleFile(rec, req)
	}
	return rec.Code, rec.Body.String()
}

// A comment can outlive its file: after a rename the old path is still requested,
// on whichever side the view is showing. That's a 404 about the file, not a 500 —
// the reviewer sees an explanation and the log stays free of false server faults.
func TestHandleFileMissingPathIsNotFound(t *testing.T) {
	r := newRepo(t)
	r.write("old.ts", "one\ntwo\n")
	r.commitAll("c1")
	r.git("checkout", "-q", "-b", "feature")
	r.git("mv", "old.ts", "new.ts")
	r.commitAll("rename")
	s := r.server()

	gone := []struct {
		name  string
		path  string
		query string
	}{
		{"head ref", "/api/file", "repo=" + r.name + "&path=old.ts&ref=feature"},
		{"working tree", "/api/file", "repo=" + r.name + "&path=old.ts&ref=feature&worktree=true"},
		{"index", "/api/file", "repo=" + r.name + "&path=old.ts&ref=feature&indexed=true"},
		{"unknown ref", "/api/file", "repo=" + r.name + "&path=old.ts&ref=no-such-branch"},
		{"blob", "/api/blob", "repo=" + r.name + "&path=old.ts&ref=feature"},
	}
	for _, c := range gone {
		code, body := getFile(t, s, c.path, c.query)
		if code != http.StatusNotFound {
			t.Errorf("%s: status %d, want 404 (body %s)", c.name, code, body)
		}
		if !strings.Contains(body, "old.ts") {
			t.Errorf("%s: body %s should name the missing path", c.name, body)
		}
	}

	if code, body := getFile(t, s, "/api/file", "repo="+r.name+"&path=new.ts&ref=feature"); code != http.StatusOK {
		t.Errorf("surviving path: status %d, want 200 (body %s)", code, body)
	}

	// An untracked file is absent from the ref but present on disk: the working-tree
	// fallback must still serve it rather than 404.
	r.write("fresh.ts", "x\n")
	if code, body := getFile(t, s, "/api/file", "repo="+r.name+"&path=fresh.ts&ref=feature"); code != http.StatusOK {
		t.Errorf("untracked file: status %d, want 200 (body %s)", code, body)
	}
}

// The response has to say which side it read, because a ref read can't promise the
// ref supplied it. Without that the client renders an uncommitted file as the ref's
// content, against hunks the ref produced, and the mismatch has nothing to explain it.
func TestHandleFileReportsTheSideItServed(t *testing.T) {
	r := newRepo(t)
	r.write("tracked.ts", "x\n")
	r.commitAll("c1")
	r.write("fresh.ts", "y\n") // on disk, not at the ref
	s := r.server()

	served := func(query string) bool {
		t.Helper()
		code, body := getFile(t, s, "/api/file", query)
		if code != http.StatusOK {
			t.Fatalf("status %d, want 200 (body %s)", code, body)
		}
		var got struct {
			Worktree bool `json:"worktree"`
		}
		if err := json.Unmarshal([]byte(body), &got); err != nil {
			t.Fatalf("unmarshal %s: %v", body, err)
		}
		return got.Worktree
	}

	if served("repo=" + r.name + "&path=tracked.ts&ref=main") {
		t.Error("a ref read the ref satisfied must not claim the working tree")
	}
	if !served("repo=" + r.name + "&path=fresh.ts&ref=main") {
		t.Error("a ref read served from disk must say so")
	}
	if !served("repo=" + r.name + "&path=tracked.ts&ref=main&worktree=true") {
		t.Error("an explicit working-tree read must say so")
	}
	if served("repo=" + r.name + "&path=tracked.ts&ref=main&indexed=true") {
		t.Error("an index read is not the working tree")
	}
}

// The working-tree fallback covers *absence* only. A git failure on an object the
// ref genuinely has must surface, not be answered with the on-disk copy: that serves
// uncommitted content as if it were the ref's, against a diff computed from the ref,
// so the view renders the wrong lines with nothing to explain it. Corrupting the blob
// produces exactly that split — `cat-file -e` still confirms the object exists, so it
// isn't ErrNotFound, while `git show` fails to inflate it.
func TestHandleFileGitErrorIsNotMaskedByWorktree(t *testing.T) {
	r := newRepo(t)
	r.write("a.txt", "committed\n")
	r.commitAll("c1")
	r.write("a.txt", "WORKTREE-ONLY\n") // differs, so a fallback would show in the body

	sha := strings.TrimSpace(r.git("rev-parse", "HEAD:a.txt"))
	obj := filepath.Join(r.dir, ".git", "objects", sha[:2], sha[2:])
	if err := os.Chmod(obj, 0o644); err != nil { // loose objects are written read-only
		t.Fatal(err)
	}
	if err := os.WriteFile(obj, []byte("not-a-valid-object"), 0o644); err != nil {
		t.Fatal(err)
	}
	s := r.server()

	code, body := getFile(t, s, "/api/file", "repo="+r.name+"&path=a.txt&ref=main")
	if code != http.StatusInternalServerError {
		t.Errorf("status %d, want 500 (body %s)", code, body)
	}
	if strings.Contains(body, "WORKTREE-ONLY") {
		t.Errorf("served the working-tree copy in place of the failed ref read: %s", body)
	}
}

// A path that can't name a repo file is the caller's mistake, so it must be a 400
// on every side — not a 500 from the working-tree guard or a 404 pretending the
// path was merely absent.
func TestHandleFileRejectsInvalidPath(t *testing.T) {
	r := newRepo(t)
	r.write("a.txt", "x\n")
	r.commitAll("c1")
	s := r.server()

	for _, bad := range []string{"", "..%2Fescape", ".git%2Fconfig", ".GIT%2Fconfig", "%2Fetc%2Fpasswd"} {
		for _, side := range []string{"", "&worktree=true", "&indexed=true"} {
			q := "repo=" + r.name + "&path=" + bad + "&ref=main" + side
			if code, body := getFile(t, s, "/api/file", q); code != http.StatusBadRequest {
				t.Errorf("file %q%s: status %d, want 400 (body %s)", bad, side, code, body)
			}
			if code, body := getFile(t, s, "/api/blob", q); code != http.StatusBadRequest {
				t.Errorf("blob %q%s: status %d, want 400 (body %s)", bad, side, code, body)
			}
		}
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

// A repo whose branch was worked off origin/main with no local main: a stale
// base=main (which no longer resolves) must fall back to the main branch rather
// than 500 with "ambiguous argument 'main..<branch>'". Covers /api/commits,
// /api/diff, and /api/reviews, which all share the base resolution.
func staleBaseFixture(t *testing.T) (*testRepo, *Server) {
	r := newRepo(t) // on main
	r.write("f.txt", "l1\n")
	r.commitAll("c1")
	r.git("update-ref", "refs/remotes/origin/main", "HEAD") // origin/main = main's commit
	r.git("checkout", "-q", "-b", "bh/consign4")
	r.write("f.txt", "l1\nl2\n")
	r.commitAll("work")
	r.git("branch", "-D", "main") // now only origin/main exists, no local main
	return r, r.server()
}

func TestHandleCommitsStaleBaseFallsBack(t *testing.T) {
	r, s := staleBaseFixture(t)
	code, c := getCommits(t, s, "repo="+r.name+"&ref=bh/consign4&base=main")
	if code != http.StatusOK {
		t.Fatalf("stale base=main: status %d, want 200 (fall back to origin/main)", code)
	}
	if got := subjects(c); !eqStrings(got, []string{"work"}) {
		t.Errorf("subjects = %v, want [work] (origin/main..bh/consign4)", got)
	}
}

func TestHandleDiffStaleBaseFallsBack(t *testing.T) {
	r, s := staleBaseFixture(t)
	code, d := getDiff(t, s, "repo="+r.name+"&head=bh/consign4&base=main")
	if code != http.StatusOK {
		t.Fatalf("stale base=main: status %d, want 200", code)
	}
	if got := newPaths(d); !eqStrings(got, []string{"f.txt"}) {
		t.Errorf("files = %v, want [f.txt]", got)
	}
}

func TestCreateReviewStaleBaseStoresResolvable(t *testing.T) {
	r, s := staleBaseFixture(t)
	req := httptest.NewRequest(http.MethodPost, "/api/reviews", strings.NewReader(
		`{"repo":"`+r.name+`","head":"bh/consign4","base":"main"}`))
	rec := httptest.NewRecorder()
	s.handleCreateReview(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("create with stale base: status %d, want 200: %s", rec.Code, rec.Body.String())
	}
	var rev store.Review
	if err := json.Unmarshal(rec.Body.Bytes(), &rev); err != nil {
		t.Fatal(err)
	}
	if rev.BaseRef != "origin/main" {
		t.Errorf("stored baseRef = %q, want origin/main (stale main resolved away)", rev.BaseRef)
	}
}
