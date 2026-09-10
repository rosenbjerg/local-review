package git

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// WorktreeFingerprint is a content-free change signal — HEAD, the changed-path set and
// those paths' mtimes — so its cost stays flat however large the diff.
func (r *Repo) WorktreeFingerprint() (string, error) {
	head, err := r.runEnv(optionalLocksOff, "rev-parse", "HEAD")
	if err != nil {
		return "", err
	}
	tracked, err := r.runEnv(optionalLocksOff, "diff", "--name-only", "-z", "HEAD")
	if err != nil {
		return "", err
	}
	untracked, err := r.runEnv(optionalLocksOff, "ls-files", "--others", "--exclude-standard", "-z")
	if err != nil {
		return "", err
	}
	h := sha256.New()
	h.Write([]byte(head))
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
