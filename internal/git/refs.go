package git

import (
	"errors"
	"fmt"
	"os/exec"
	"strings"
)

// ErrNoMergeBase reports that two refs share no common ancestor.
var ErrNoMergeBase = errors.New("no common history")

func (r *Repo) MergeBase(a, b string) (string, error) {
	out, err := r.run("merge-base", a, b)
	if err != nil {
		// Exit 1 is "no merge base"; a bad ref or a broken repo exits 128.
		var ee *exec.ExitError
		if errors.As(err, &ee) && ee.ExitCode() == 1 {
			return "", fmt.Errorf("%w: %s and %s", ErrNoMergeBase, a, b)
		}
		return "", err
	}
	return strings.TrimSpace(out), nil
}

// ResolveSHA resolves ref to a commit sha; --verify fails cleanly on a missing ref.
func (r *Repo) ResolveSHA(ref string) (string, error) {
	out, err := r.run("rev-parse", "--verify", ref+"^{commit}")
	return strings.TrimSpace(out), err
}

// EmptyTreeSHA is git's canonical empty tree, the before side for a root commit.
const EmptyTreeSHA = "4b825dc642cb6eb9a060e54bf8d69288fbee4904"

// ParentSHA resolves ref's first parent, or EmptyTreeSHA for a root commit; one rev-list
// tells a root commit from a missing ref, where `rev-parse <ref>^` fails identically for both.
func (r *Repo) ParentSHA(ref string) (string, error) {
	out, err := r.run("rev-list", "--parents", "-n", "1", ref+"^{commit}")
	if err != nil {
		return "", err
	}
	// "<sha> [<parent>…]": no parent is a root commit; no sha at all is not "parentless".
	f := strings.Fields(out)
	switch len(f) {
	case 0:
		return "", fmt.Errorf("no commit for %q", ref)
	case 1:
		return EmptyTreeSHA, nil
	}
	return f[1], nil
}
