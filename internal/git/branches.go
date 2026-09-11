package git

import (
	"bufio"
	"sort"
	"strings"
	"time"
)

type Branch struct {
	Name      string `json:"name"`
	IsCurrent bool   `json:"isCurrent"`
	IsMain    bool   `json:"isMain"`
	IsRemote  bool   `json:"isRemote"`
	// LastCommit is the tip commit's committer date (RFC3339), which the picker orders by.
	LastCommit string `json:"lastCommit"`
}

func (r *Repo) ListBranches() ([]Branch, error) {
	// A literal \x1f, not git's %x1f escape: `git branch --format` prints that escape verbatim.
	out, err := r.run("branch", "--format=%(refname:short)\x1f%(committerdate:iso-strict)\x1f%(HEAD)")
	if err != nil {
		return nil, err
	}
	main := r.MainBranch()
	branches := []Branch{} // never nil: the endpoint promises [], and a null crashes the client
	sc := bufio.NewScanner(strings.NewReader(out))
	for sc.Scan() {
		line := sc.Text()
		if line == "" {
			continue
		}
		f := strings.Split(line, "\x1f")
		if len(f) != 3 {
			continue
		}
		name := f[0]
		branches = append(branches, Branch{
			Name:       name,
			IsCurrent:  strings.TrimSpace(f[2]) == "*",
			IsMain:     name == main,
			LastCommit: f[1],
		})
	}
	if err := sc.Err(); err != nil {
		return nil, err
	}
	remotes, err := r.remoteBranches(main)
	if err != nil {
		return nil, err
	}
	branches = append(branches, remotes...)
	sortBranches(branches)
	return branches, nil
}

// remoteBranches lists remote-tracking branches as of the last fetch; it does not fetch.
func (r *Repo) remoteBranches(main string) ([]Branch, error) {
	out, err := r.run("for-each-ref", "--format=%(refname:short)\x1f%(symref)\x1f%(committerdate:iso-strict)", "refs/remotes")
	if err != nil {
		return nil, err
	}
	var branches []Branch
	sc := bufio.NewScanner(strings.NewReader(out))
	for sc.Scan() {
		line := sc.Text()
		if line == "" {
			continue
		}
		f := strings.Split(line, "\x1f")
		if len(f) != 3 {
			continue
		}
		// A non-empty symref is the origin/HEAD pointer, not a branch.
		if strings.TrimSpace(f[1]) != "" {
			continue
		}
		name := f[0]
		branches = append(branches, Branch{Name: name, IsMain: name == main, IsRemote: true, LastCommit: f[2]})
	}
	return branches, sc.Err()
}

var pinnedBranches = []string{"main", "master", "develop", "development", "dev", "staging"}

// branchRank puts the pinned trunks first; a remote ranks on the name after its remote,
// so origin/main heads the remotes the way main heads the locals.
func branchRank(b Branch) int {
	name := b.Name
	if b.IsRemote {
		if _, rest, found := strings.Cut(name, "/"); found {
			name = rest
		}
	}
	for i, p := range pinnedBranches {
		if name == p {
			return i
		}
	}
	return len(pinnedBranches)
}

// branchGroup is the prefix a branch sorts under: the segment before its first "/", or
// for a remote the segment after the remote name, which every remote branch shares.
func branchGroup(b Branch) string {
	name := b.Name
	if b.IsRemote {
		remote, rest, found := strings.Cut(name, "/")
		if !found {
			return name
		}
		seg, _, _ := strings.Cut(rest, "/")
		return remote + "/" + seg
	}
	seg, _, _ := strings.Cut(name, "/")
	return seg
}

func branchDate(b Branch) time.Time {
	t, err := time.Parse(time.RFC3339, b.LastCommit)
	if err != nil {
		return time.Time{} // unparseable/absent sorts oldest
	}
	return t
}

// sortBranches orders locals before remotes, pinned trunks first, then by activity —
// grouped by prefix, each group sitting at its newest member's date.
func sortBranches(branches []Branch) {
	// Partition by side, so a local named "origin/x" doesn't pool with the origin/x remotes.
	key := func(b Branch) string {
		if b.IsRemote {
			return "r\x00" + branchGroup(b)
		}
		return "l\x00" + branchGroup(b)
	}
	newest := map[string]time.Time{}
	for _, b := range branches {
		if d := branchDate(b); d.After(newest[key(b)]) {
			newest[key(b)] = d
		}
	}
	sort.SliceStable(branches, func(i, j int) bool {
		bi, bj := branches[i], branches[j]
		if bi.IsRemote != bj.IsRemote {
			return !bi.IsRemote
		}
		if ri, rj := branchRank(bi), branchRank(bj); ri != rj {
			return ri < rj
		}
		gi, gj := key(bi), key(bj)
		if gi != gj {
			if ni, nj := newest[gi], newest[gj]; !ni.Equal(nj) {
				return ni.After(nj)
			}
			return gi < gj // same newest date: keep it deterministic
		}
		if di, dj := branchDate(bi), branchDate(bj); !di.Equal(dj) {
			return di.After(dj)
		}
		return bi.Name < bj.Name
	})
}

// mainCandidates is the precedence MainBranch resolves in: a local trunk first, then what
// origin/HEAD points at, then origin's own trunks.
var mainCandidates = []string{
	"refs/heads/main",
	"refs/heads/master",
	"refs/remotes/origin/HEAD",
	"refs/remotes/origin/main",
	"refs/remotes/origin/master",
}

// MainBranch names the repo's trunk, or "" — not a fabricated "main", so callers then
// require an explicit base. One for-each-ref over every candidate: this runs on the branch
// list and on every auto-base diff, and five sequential rev-parses is five processes.
func (r *Repo) MainBranch() string {
	// for-each-ref prints only the refs that exist, in the order given, so the first
	// answering line is already the winner — except that origin/HEAD answers with its target.
	out, err := r.run(append([]string{"for-each-ref", "--format=%(refname)\x1f%(symref:short)"}, mainCandidates...)...)
	if err != nil {
		return ""
	}
	found := map[string]string{}
	sc := bufio.NewScanner(strings.NewReader(out))
	for sc.Scan() {
		line := sc.Text()
		if line == "" {
			continue
		}
		name, symref, ok := strings.Cut(line, "\x1f")
		if !ok {
			continue
		}
		found[name] = strings.TrimSpace(symref)
	}
	for _, ref := range mainCandidates {
		target, present := found[ref]
		if !present {
			continue
		}
		// origin/HEAD is a pointer, not a branch: it answers with what it points at, and an
		// origin/HEAD that points nowhere usable is no answer at all.
		if ref == "refs/remotes/origin/HEAD" {
			if target != "" && target != "origin/HEAD" {
				return target
			}
			continue
		}
		return strings.TrimPrefix(strings.TrimPrefix(ref, "refs/heads/"), "refs/remotes/")
	}
	return ""
}
