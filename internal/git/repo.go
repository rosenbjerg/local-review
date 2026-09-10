// Package git wraps the git binary for the tool's read-only operations.
package git

import (
	"bytes"
	"context"
	"fmt"
	"os"
	"os/exec"
	"strings"
	"time"
)

// Bounds every git invocation: a hung filter or credential prompt must not wedge a handler or the poller.
const gitTimeout = 30 * time.Second

type Repo struct {
	Path string
}

func New(path string) *Repo { return &Repo{Path: path} }

func (r *Repo) run(args ...string) (string, error) {
	return r.runEnv(nil, args...)
}

// optionalLocksOff keeps a timed read from refreshing the index and taking index.lock
// out from under a concurrent `git commit`.
var optionalLocksOff = []string{"GIT_OPTIONAL_LOCKS=0"}

// runEnv is run with extra KEY=VALUE entries appended to the process environment.
func (r *Repo) runEnv(env []string, args ...string) (string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), gitTimeout)
	defer cancel()
	cmd := exec.CommandContext(ctx, "git", append([]string{"-C", r.Path}, args...)...)
	// GIT_TERMINAL_PROMPT=0: never block on a credential prompt.
	cmd.Env = append(os.Environ(), "GIT_TERMINAL_PROMPT=0")
	cmd.Env = append(cmd.Env, env...)
	var out, errb bytes.Buffer
	cmd.Stdout = &out
	cmd.Stderr = &errb
	if err := cmd.Run(); err != nil {
		return "", fmt.Errorf("git %s: %w: %s", strings.Join(args, " "), err, errb.String())
	}
	return out.String(), nil
}
