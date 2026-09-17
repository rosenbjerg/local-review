package git

import (
	"path"
	"strings"
)

// Built-in answers for paths .gitattributes says nothing about. Deliberately narrow: a false
// positive collapses a file the reviewer meant to read.
var generatedNames = map[string]bool{
	"bun.lock":            true,
	"bun.lockb":           true,
	"package-lock.json":   true,
	"npm-shrinkwrap.json": true,
	"yarn.lock":           true,
	"pnpm-lock.yaml":      true,
	"deno.lock":           true,
	"go.sum":              true,
	"Cargo.lock":          true,
	"composer.lock":       true,
	"Gemfile.lock":        true,
	"poetry.lock":         true,
	"Pipfile.lock":        true,
	"uv.lock":             true,
	"packages.lock.json":  true,
	"pubspec.lock":        true,
	"flake.lock":          true,
	"mix.lock":            true,
	"gradle.lockfile":     true,
}

var generatedDirs = map[string]bool{
	"node_modules":  true,
	"vendor":        true,
	"dist":          true,
	"__snapshots__": true,
	"__pycache__":   true,
}

var generatedSuffixes = []string{
	".min.js",
	".min.css",
	".js.map",
	".css.map",
	".pb.go",
	".pb.gw.go",
	".pb.cc",
	".pb.h",
	"_pb2.py",
	"_pb2_grpc.py",
	".g.dart",
	".freezed.dart",
	".designer.cs",
	"_generated.go",
	".generated.ts",
	".snap",
}

func generatedByName(p string) bool {
	base := path.Base(p)
	if generatedNames[base] {
		return true
	}
	if dir := path.Dir(p); dir != "." {
		for _, seg := range strings.Split(dir, "/") {
			if generatedDirs[seg] {
				return true
			}
		}
	}
	for _, s := range generatedSuffixes {
		if strings.HasSuffix(base, s) {
			return true
		}
	}
	return strings.HasPrefix(base, "zz_generated.")
}

// Generated reports, per path, whether it holds generated output: .gitattributes'
// linguist-generated wherever the repo states it either way, the built-in patterns everywhere
// it says nothing.
func (r *Repo) Generated(paths []string) map[string]bool {
	out := make(map[string]bool, len(paths))
	for _, p := range paths {
		out[p] = generatedByName(p)
	}
	if len(paths) == 0 {
		return out
	}
	// A failure here leaves the pattern answers standing: returning the error instead would take a
	// whole diff down over a flag that only decides whether a card starts collapsed.
	res, err := r.runStdin(strings.Join(paths, "\x00")+"\x00",
		"check-attr", "-z", "--stdin", "linguist-generated")
	if err != nil {
		return out
	}
	fields := strings.Split(strings.TrimSuffix(res, "\x00"), "\x00")
	for i := 0; i+2 < len(fields); i += 3 {
		switch fields[i+2] {
		case "set", "true":
			out[fields[i]] = true
		case "unset", "false":
			out[fields[i]] = false
		}
	}
	return out
}

// MarkGenerated fills each file's Generated flag. Kept off Diff/DiffWorktree/DiffStaged: the
// anchoring passes in internal/review read those on every SSE ping and have no use for the flag.
func (r *Repo) MarkGenerated(files []FileDiff) {
	paths := make([]string, 0, len(files))
	for _, f := range files {
		paths = append(paths, diffPath(f))
	}
	gen := r.Generated(paths)
	for i := range files {
		files[i].Generated = gen[diffPath(files[i])]
	}
}

func diffPath(f FileDiff) string {
	if f.NewPath != "" {
		return f.NewPath
	}
	return f.OldPath
}
