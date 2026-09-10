package git

import (
	"bufio"
	"strconv"
	"strings"
)

type Commit struct {
	SHA      string `json:"sha"`
	ShortSHA string `json:"shortSha"`
	Subject  string `json:"subject"`
	RelDate  string `json:"relDate"`
}

// RecentCommits lists up to limit commits of base..ref, newest first; an empty base lists ref's full ancestry.
func (r *Repo) RecentCommits(base, ref string, limit int) ([]Commit, error) {
	rangeArg := ref
	if base != "" {
		rangeArg = base + ".." + ref
	}
	out, err := r.run("log", rangeArg, "-n", strconv.Itoa(limit), "--format=%H%x1f%h%x1f%s%x1f%cr")
	if err != nil {
		return nil, err
	}
	var commits []Commit
	sc := bufio.NewScanner(strings.NewReader(out))
	sc.Buffer(make([]byte, 1024*1024), 16*1024*1024)
	for sc.Scan() {
		line := sc.Text()
		if line == "" {
			continue
		}
		f := strings.Split(line, "\x1f")
		if len(f) != 4 {
			continue
		}
		commits = append(commits, Commit{SHA: f[0], ShortSHA: f[1], Subject: f[2], RelDate: f[3]})
	}
	return commits, sc.Err()
}
