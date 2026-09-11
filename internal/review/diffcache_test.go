package review

import (
	"testing"

	"local-review/internal/store"
)

// gitCount counts the git processes one call spawns, by shimming git on PATH.
func annotateTwice(t *testing.T, r *testRepo, rev *store.Review, cache *DiffCache) (first, second int) {
	t.Helper()
	count := func() int {
		marks := []store.ReviewedFile{}
		n := r.countGit(func() { Annotate(rev, marks, cache) })
		return n
	}
	return count(), count()
}

// A second read at the same head must not re-run a single `git diff`: both ends of every
// diff it needs are shas, so the answer cannot have changed.
func TestDiffCacheSkipsRepeatedDiffs(t *testing.T) {
	r := newRepo(t)
	r.write("a.txt", "one\ntwo\nthree\n")
	r.write("b.txt", "uno\ndos\ntres\n")
	old := r.commitAll("base")
	r.write("a.txt", "ONE\ntwo\nthree\n")
	r.commitAll("edit a")
	r.write("b.txt", "UNO\ndos\ntres\n")
	r.commitAll("edit b")

	rev := &store.Review{
		RepoPath: r.dir,
		HeadRef:  "main",
		Comments: []store.Comment{
			{FilePath: "a.txt", StartLine: 2, EndLine: 2, Snippet: "two", CommitSHA: old},
			{FilePath: "b.txt", StartLine: 2, EndLine: 2, Snippet: "dos", CommitSHA: old},
		},
	}
	cache := NewDiffCache()
	first, second := annotateTwice(t, r, rev, cache)
	if first <= second {
		t.Fatalf("expected the first read to cost more git than the second; got %d then %d", first, second)
	}
	if n := r.countGitCmd("diff"); n != 0 {
		t.Errorf("second read ran %d `git diff`, want 0", n)
	}
	if rev.Comments[0].AnchorStatus != store.AnchorCurrent {
		t.Errorf("cached read changed the verdict: %q", rev.Comments[0].AnchorStatus)
	}
}

// Without a cache nothing is remembered, so the two reads cost the same. This is what
// pins the win above to the cache rather than to some other memoization.
func TestNilDiffCacheStillWorks(t *testing.T) {
	r := newRepo(t)
	r.write("a.txt", "one\ntwo\nthree\n")
	old := r.commitAll("base")
	r.write("a.txt", "ONE\ntwo\nthree\n")
	r.commitAll("edit")

	rev := &store.Review{
		RepoPath: r.dir,
		HeadRef:  "main",
		Comments: []store.Comment{{FilePath: "a.txt", StartLine: 2, EndLine: 2, Snippet: "two", CommitSHA: old}},
	}
	first, second := annotateTwice(t, r, rev, nil)
	if first != second {
		t.Errorf("nil cache should remember nothing; got %d then %d", first, second)
	}
	if rev.Comments[0].AnchorStatus != store.AnchorCurrent {
		t.Errorf("anchor = %q, want current", rev.Comments[0].AnchorStatus)
	}
}

// A git failure must not be cached: the repo that was mid-rebase a second ago is readable
// now, and a sticky error would leave every comment reading as unjudgeable until restart.
func TestDiffCacheDoesNotCacheFailures(t *testing.T) {
	r := newRepo(t)
	r.write("a.txt", "one\n")
	r.commitAll("base")

	cache := NewDiffCache()
	caches := newDiffCaches(r.repo, r.sha("main"), cache)
	// A sha that doesn't exist fails the diff.
	if _, ok := caches.scopedEntry("0000000000000000000000000000000000000000", "a.txt"); ok {
		t.Fatal("expected the diff against a missing sha to fail")
	}
	cache.mu.Lock()
	gens := len(cache.gens)
	cache.mu.Unlock()
	if gens != 0 {
		t.Errorf("a failed diff was cached: %d generation(s) stored", gens)
	}
}

// Head moving retires the old generation rather than growing the cache without bound.
func TestDiffCacheEvictsOldGenerations(t *testing.T) {
	c := NewDiffCache()
	res := newFileDiffResult(nil, nil)
	for i := 0; i < maxGenerations+3; i++ {
		c.put(string(rune('a'+i)), "k", res)
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if len(c.gens) != maxGenerations {
		t.Errorf("kept %d generations, want %d", len(c.gens), maxGenerations)
	}
	if _, ok := c.gens["a"]; ok {
		t.Error("the oldest generation should have been evicted first")
	}
}
