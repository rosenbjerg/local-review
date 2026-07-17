package api

import (
	"reflect"
	"testing"

	"local-review/internal/store"
)

// --- pure line helpers ---

func TestSplitLines(t *testing.T) {
	cases := map[string][]string{
		"a\nb\nc\n": {"a", "b", "c"}, // one trailing newline dropped
		"a\nb\nc":   {"a", "b", "c"},
		"a\n\nb\n":  {"a", "", "b"},
		"":          {""},
		"only\n":    {"only"},
	}
	for in, want := range cases {
		if got := splitLines(in); !reflect.DeepEqual(got, want) {
			t.Errorf("splitLines(%q) = %v, want %v", in, got, want)
		}
	}
}

func TestMatchAt(t *testing.T) {
	lines := []string{"a", "b", "c"}
	if !matchAt(lines, 1, []string{"b"}) {
		t.Error("matchAt at 1 for [b] should hit")
	}
	if !matchAt(lines, 1, []string{"b", "c"}) {
		t.Error("matchAt at 1 for [b,c] should hit")
	}
	if matchAt(lines, 0, []string{"b"}) {
		t.Error("matchAt at 0 for [b] should miss")
	}
	if matchAt(lines, 2, []string{"c", "d"}) {
		t.Error("matchAt past end should miss, not panic")
	}
	if matchAt(lines, -1, []string{"a"}) {
		t.Error("matchAt at negative index should miss")
	}
}

func TestFindMatches(t *testing.T) {
	lines := []string{"x", "a", "b", "x", "a", "b"}
	if got := findMatches(lines, []string{"a", "b"}); !reflect.DeepEqual(got, []int{1, 4}) {
		t.Errorf("findMatches = %v, want [1 4]", got)
	}
	if got := findMatches(lines, []string{"z"}); len(got) != 0 {
		t.Errorf("findMatches(no hit) = %v, want empty", got)
	}
}

// --- captureSnippet: reads the range from the anchored side ---

// The three anchor sides read distinct content for the same line, so the captured
// snippet must come from the side the flags name (index / worktree / head_ref).
func TestCaptureSnippetPerSide(t *testing.T) {
	r := newRepo(t)
	r.write("f.txt", "a\nb\nc\n")
	r.commitAll("c1") // head: line 2 == "b"
	r.write("f.txt", "a\nSTAGED\nc\n")
	r.git("add", "f.txt")            // index: line 2 == "STAGED"
	r.write("f.txt", "a\nWORK\nc\n") // worktree: line 2 == "WORK"

	cases := []struct {
		name              string
		worktree, indexed bool
		want              string
	}{
		{"head", false, false, "b"},
		{"worktree", true, false, "WORK"},
		{"index", false, true, "STAGED"},
	}
	for _, c := range cases {
		if got := captureSnippet(r.repo, "main", "f.txt", 2, 2, c.worktree, c.indexed); got != c.want {
			t.Errorf("captureSnippet[%s] = %q, want %q", c.name, got, c.want)
		}
	}

	// Multi-line range, and the best-effort edge cases.
	if got := captureSnippet(r.repo, "main", "f.txt", 1, 3, false, false); got != "a\nb\nc" {
		t.Errorf("multi-line head snippet = %q, want %q", got, "a\nb\nc")
	}
	if got := captureSnippet(r.repo, "main", "f.txt", 0, 0, false, false); got != "" {
		t.Errorf("start<=0 should yield %q, got %q", "", got)
	}
	if got := captureSnippet(r.repo, "main", "f.txt", 99, 99, false, false); got != "" {
		t.Errorf("out-of-range start should yield %q, got %q", "", got)
	}
	// End past EOF clamps to the last line rather than erroring.
	if got := captureSnippet(r.repo, "main", "f.txt", 3, 99, false, false); got != "c" {
		t.Errorf("clamped-end snippet = %q, want %q", got, "c")
	}
}

// annotate runs annotateComments against headRef and returns the single mutated
// comment for assertions.
func annotateOne(r *testRepo, headRef string, c store.Comment) store.Comment {
	cs := []store.Comment{c}
	annotateComments(r.repo, headRef, cs)
	return cs[0]
}

// --- diff-based tracking (head-anchored comments) ---

func TestAnnotateByDiffCurrent(t *testing.T) {
	r := newRepo(t)
	r.write("f.txt", "l1\nl2\nl3\nl4\nl5\n")
	sha1 := r.commitAll("c1")
	r.write("f.txt", "l1\nl2\nl3\nl4\nl5-changed\n") // unrelated line changes
	r.commitAll("c2")

	got := annotateOne(r, "main", store.Comment{FilePath: "f.txt", StartLine: 2, EndLine: 2, Snippet: "l2", CommitSHA: sha1})
	if got.AnchorStatus != store.AnchorCurrent {
		t.Fatalf("anchorStatus = %q, want current", got.AnchorStatus)
	}
	if got.CurrentStartLine != 0 {
		t.Errorf("current comment should not carry a relocated line, got %d", got.CurrentStartLine)
	}
}

func TestAnnotateByDiffMoved(t *testing.T) {
	r := newRepo(t)
	r.write("f.txt", "l1\nl2\nl3\n")
	sha1 := r.commitAll("c1")
	r.write("f.txt", "l0\nl1\nl2\nl3\n") // a line inserted above the anchor
	r.commitAll("c2")

	got := annotateOne(r, "main", store.Comment{FilePath: "f.txt", StartLine: 2, EndLine: 2, Snippet: "l2", CommitSHA: sha1})
	if got.AnchorStatus != store.AnchorMoved {
		t.Fatalf("anchorStatus = %q, want moved", got.AnchorStatus)
	}
	if got.CurrentStartLine != 3 || got.CurrentEndLine != 3 {
		t.Errorf("relocated range = %d-%d, want 3-3", got.CurrentStartLine, got.CurrentEndLine)
	}
}

func TestAnnotateByDiffOutdated(t *testing.T) {
	r := newRepo(t)
	r.write("f.txt", "l1\nl2\nl3\n")
	sha1 := r.commitAll("c1")
	r.write("f.txt", "l1\nl2-edited\nl3\n") // the anchored line itself changes
	r.commitAll("c2")

	got := annotateOne(r, "main", store.Comment{FilePath: "f.txt", StartLine: 2, EndLine: 2, Snippet: "l2", CommitSHA: sha1})
	if got.AnchorStatus != store.AnchorOutdated {
		t.Fatalf("anchorStatus = %q, want outdated", got.AnchorStatus)
	}
}

// --- snippet fallback (worktree / index anchors, and no commit_sha) ---

// A worktree-anchored comment must snippet-match against the on-disk file, never
// diff-track — even though a commit_sha is present.
func TestAnnotateWorktreeSnippet(t *testing.T) {
	r := newRepo(t)
	r.write("f.txt", "l1\nl2\nl3\n")
	sha := r.commitAll("c1")
	r.write("f.txt", "l1\nl2\nl3-wt\n") // worktree edit leaves l2 in place

	got := annotateOne(r, "main", store.Comment{FilePath: "f.txt", StartLine: 2, EndLine: 2, Snippet: "l2", CommitSHA: sha, Worktree: true})
	if got.AnchorStatus != store.AnchorCurrent {
		t.Fatalf("worktree anchor with unchanged line: anchorStatus = %q, want current", got.AnchorStatus)
	}

	r.write("f.txt", "l1\nl2-wt\nl3\n") // now the anchored line changes on disk
	got = annotateOne(r, "main", store.Comment{FilePath: "f.txt", StartLine: 2, EndLine: 2, Snippet: "l2", CommitSHA: sha, Worktree: true})
	if got.AnchorStatus != store.AnchorOutdated {
		t.Fatalf("worktree anchor with changed line: anchorStatus = %q, want outdated", got.AnchorStatus)
	}
}

// An index-anchored comment must read the git index, not the working tree: staging
// leaves the anchored line intact while the worktree changes it, so it stays current.
func TestAnnotateIndexSnippetReadsIndexNotWorktree(t *testing.T) {
	r := newRepo(t)
	r.write("f.txt", "l1\nl2\nl3\n")
	r.commitAll("c1")
	r.write("f.txt", "l1\nl2\nl3-staged\n")
	r.git("add", "f.txt")                      // index: l2 intact
	r.write("f.txt", "l1\nl2-wt\nl3-staged\n") // worktree: l2 changed (unstaged)

	got := annotateOne(r, "main", store.Comment{FilePath: "f.txt", StartLine: 2, EndLine: 2, Snippet: "l2", Indexed: true})
	if got.AnchorStatus != store.AnchorCurrent {
		t.Fatalf("index anchor: anchorStatus = %q, want current (index still has l2)", got.AnchorStatus)
	}
}

// A relocated snippet (unique match elsewhere) reports moved with the new range.
func TestAnnotateSnippetRelocatesMoved(t *testing.T) {
	r := newRepo(t)
	r.write("f.txt", "l1\nl2\nl3\n")
	sha := r.commitAll("c1")
	// Worktree gains two lines above the anchor; l2 still appears exactly once.
	r.write("f.txt", "x\ny\nl1\nl2\nl3\n")

	got := annotateOne(r, "main", store.Comment{FilePath: "f.txt", StartLine: 2, EndLine: 2, Snippet: "l2", CommitSHA: sha, Worktree: true})
	if got.AnchorStatus != store.AnchorMoved || got.CurrentStartLine != 4 {
		t.Fatalf("relocated snippet = %q @ %d, want moved @ 4", got.AnchorStatus, got.CurrentStartLine)
	}
}

// With no commit_sha, a head-anchored comment falls back to snippet matching.
func TestAnnotateNoCommitShaFallsBackToSnippet(t *testing.T) {
	r := newRepo(t)
	r.write("f.txt", "l1\nl2\nl3\n")
	r.commitAll("c1")

	got := annotateOne(r, "main", store.Comment{FilePath: "f.txt", StartLine: 2, EndLine: 2, Snippet: "l2"})
	if got.AnchorStatus != store.AnchorCurrent {
		t.Fatalf("no-sha head anchor: anchorStatus = %q, want current", got.AnchorStatus)
	}
}

// A line-0 comment with an empty snippet has nothing to verify and stays current.
func TestAnnotateEmptySnippetStaysCurrent(t *testing.T) {
	r := newRepo(t)
	r.write("f.txt", "l1\nl2\n")
	r.commitAll("c1")

	got := annotateOne(r, "main", store.Comment{FilePath: "f.txt", StartLine: 0, EndLine: 0, Snippet: ""})
	if got.AnchorStatus != store.AnchorCurrent {
		t.Fatalf("empty-snippet comment: anchorStatus = %q, want current", got.AnchorStatus)
	}
}

// A multi-line anchor whose block shifts wholesale is moved, with the full range
// relocated.
func TestAnnotateByDiffMultiLineMoved(t *testing.T) {
	r := newRepo(t)
	r.write("f.txt", "l1\nl2\nl3\nl4\n")
	sha1 := r.commitAll("c1")
	r.write("f.txt", "l0\nl1\nl2\nl3\nl4\n") // whole file shifts down by one
	r.commitAll("c2")

	got := annotateOne(r, "main", store.Comment{FilePath: "f.txt", StartLine: 2, EndLine: 3, Snippet: "l2\nl3", CommitSHA: sha1})
	if got.AnchorStatus != store.AnchorMoved || got.CurrentStartLine != 3 || got.CurrentEndLine != 4 {
		t.Fatalf("multi-line move = %q @ %d-%d, want moved @ 3-4", got.AnchorStatus, got.CurrentStartLine, got.CurrentEndLine)
	}
}

// A multi-line anchor whose interior line is edited is outdated, not moved — the
// contiguity check must reject a block that didn't survive intact (a naive
// first-line-only mapper would wrongly report moved).
func TestAnnotateByDiffMultiLineInteriorEditOutdated(t *testing.T) {
	r := newRepo(t)
	r.write("f.txt", "l1\nl2\nl3\nl4\nl5\n")
	sha1 := r.commitAll("c1")
	r.write("f.txt", "l1\nl2\nl3-edited\nl4\nl5\n") // interior line of the anchor changes
	r.commitAll("c2")

	got := annotateOne(r, "main", store.Comment{FilePath: "f.txt", StartLine: 2, EndLine: 4, Snippet: "l2\nl3\nl4", CommitSHA: sha1})
	if got.AnchorStatus != store.AnchorOutdated {
		t.Fatalf("multi-line interior edit = %q, want outdated", got.AnchorStatus)
	}
}

// A deleted file reads as outdated via the diff path.
func TestAnnotateByDiffDeletedFileOutdated(t *testing.T) {
	r := newRepo(t)
	r.write("f.txt", "l1\nl2\nl3\n")
	sha1 := r.commitAll("c1")
	r.git("rm", "-q", "f.txt")
	r.commitAll("c2")

	got := annotateOne(r, "main", store.Comment{FilePath: "f.txt", StartLine: 2, EndLine: 2, Snippet: "l2", CommitSHA: sha1})
	if got.AnchorStatus != store.AnchorOutdated {
		t.Fatalf("deleted-file anchor = %q, want outdated", got.AnchorStatus)
	}
}

// A renamed file must NOT report a moved range against the old path (the diff path
// defers to snippet matching, which reads the now-absent old path → outdated). This
// guards the documented rename trap.
func TestAnnotateByDiffRenamedFileNotMoved(t *testing.T) {
	r := newRepo(t)
	r.write("f.txt", "l1\nl2\nl3\n")
	sha1 := r.commitAll("c1")
	r.git("mv", "f.txt", "g.txt")
	r.commitAll("c2")

	got := annotateOne(r, "main", store.Comment{FilePath: "f.txt", StartLine: 2, EndLine: 2, Snippet: "l2", CommitSHA: sha1})
	if got.AnchorStatus == store.AnchorMoved {
		t.Fatalf("renamed file reported moved (%d-%d) against the old path; want outdated", got.CurrentStartLine, got.CurrentEndLine)
	}
	if got.AnchorStatus != store.AnchorOutdated {
		t.Fatalf("renamed-file anchor = %q, want outdated", got.AnchorStatus)
	}
}

// A snippet whose file is gone reads as outdated.
func TestAnnotateMissingFileOutdated(t *testing.T) {
	r := newRepo(t)
	r.write("f.txt", "l1\nl2\n")
	r.commitAll("c1")

	got := annotateOne(r, "main", store.Comment{FilePath: "gone.txt", StartLine: 1, EndLine: 1, Snippet: "l1"})
	if got.AnchorStatus != store.AnchorOutdated {
		t.Fatalf("missing-file anchor: anchorStatus = %q, want outdated", got.AnchorStatus)
	}
}
