package git

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// RefsFingerprint is a change signal for what the branch and commit pickers read: HEAD and
// every local and remote branch tip. HEAD contributes its symbolic name as well as its sha,
// or `git switch`, which moves no ref at all, would read as no change.
func (r *Repo) RefsFingerprint() (string, error) {
	// for-each-ref matches only the ref namespace, so HEAD needs the separate rev-parse.
	head, err := r.runEnv(optionalLocksOff, "rev-parse", "HEAD", "--symbolic-full-name", "HEAD")
	if err != nil {
		return "", err
	}
	// Tags are deliberately out: nothing the client refetches on a refs ping reads them.
	refs, err := r.runEnv(optionalLocksOff, "for-each-ref", "--format=%(refname) %(objectname)", "refs/heads", "refs/remotes")
	if err != nil {
		return "", err
	}
	h := sha256.New()
	h.Write([]byte(head))
	h.Write([]byte(refs))
	return hex.EncodeToString(h.Sum(nil)), nil
}

// WorktreeFingerprint is a content-free change signal — the changed-path set and those paths'
// mtimes — so its cost stays flat however large the diff. HEAD is RefsFingerprint's to report.
func (r *Repo) WorktreeFingerprint() (string, error) {
	tracked, err := r.runEnv(optionalLocksOff, "diff", "--name-only", "-z", "HEAD")
	if err != nil {
		return "", err
	}
	untracked, err := r.runEnv(optionalLocksOff, "ls-files", "--others", "--exclude-standard", "-z")
	if err != nil {
		return "", err
	}
	h := sha256.New()
	h.Write([]byte(tracked))
	h.Write([]byte(untracked))
	for _, p := range append(splitNUL(tracked), splitNUL(untracked)...) {
		h.Write([]byte(p))
		// A deleted path fails to stat; "absent" is a stable stand-in.
		if fi, err := os.Stat(filepath.Join(r.Path, p)); err == nil {
			fmt.Fprintf(h, ":%d", fi.ModTime().UnixNano())
		} else {
			h.Write([]byte(":absent"))
		}
	}
	return hex.EncodeToString(h.Sum(nil)), nil
}

func splitNUL(s string) []string {
	var out []string
	for _, p := range strings.Split(s, "\x00") {
		if p != "" {
			out = append(out, p)
		}
	}
	return out
}
