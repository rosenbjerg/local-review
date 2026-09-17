package git

import "testing"

func TestGeneratedByName(t *testing.T) {
	cases := map[string]bool{
		"bun.lock":                      true,
		"web/bun.lock":                  true,
		"go.sum":                        true,
		"web/dist/index.js":             true,
		"node_modules/pkg/index.js":     true,
		"internal/vendor/lib.go":        true,
		"src/__snapshots__/a.test.js":   true,
		"static/app.min.js":             true,
		"static/app.js.map":             true,
		"api/service.pb.go":             true,
		"api/service_pb2.py":            true,
		"model.freezed.dart":            true,
		"apis/zz_generated.deepcopy.go": true,
		"src/__tests__/a.test.js.snap":  true,

		"go.mod":                    false,
		"internal/api/api.go":       false,
		"web/src/App.tsx":           false,
		"docs/distributed.md":       false,
		"vendors.txt":               false,
		"lock.go":                   false,
		"src/snapshot.ts":           false,
		"distribution/handler.go":   false,
		"web/src/components/map.ts": false,
	}
	for path, want := range cases {
		if got := generatedByName(path); got != want {
			t.Errorf("generatedByName(%q) = %v, want %v", path, got, want)
		}
	}
}

// .gitattributes decides in both directions, and only where it speaks.
func TestGeneratedAttributes(t *testing.T) {
	dir, repo := initRepoOn(t, "main")
	mustWrite(t, dir, ".gitattributes", "src/schema.ts linguist-generated=true\nbun.lock -linguist-generated\nsrc/tags.ts linguist-generated\n")
	gitCmd(t, dir, "add", "-A")
	gitCmd(t, dir, "commit", "-q", "-m", "attrs")

	got := repo.Generated([]string{"src/schema.ts", "bun.lock", "src/tags.ts", "src/App.tsx", "web/dist/a.js"})
	want := map[string]bool{
		"src/schema.ts": true,  // =true
		"bun.lock":      false, // unset beats the built-in pattern
		"src/tags.ts":   true,  // bare set
		"src/App.tsx":   false,
		"web/dist/a.js": true, // unspecified, so the built-in pattern stands
	}
	for path, w := range want {
		if got[path] != w {
			t.Errorf("Generated[%q] = %v, want %v", path, got[path], w)
		}
	}
}

func TestGeneratedNoPaths(t *testing.T) {
	_, repo := initRepoOn(t, "main")
	if got := repo.Generated(nil); len(got) != 0 {
		t.Errorf("Generated(nil) = %v, want empty", got)
	}
}

func TestMarkGenerated(t *testing.T) {
	dir, repo := initRepoOn(t, "main")
	firstCommit(t, dir)

	files := []FileDiff{
		{NewPath: "bun.lock", Status: FileModified},
		{NewPath: "internal/api/api.go", Status: FileModified},
		{OldPath: "web/dist/old.js", Status: FileDeleted},
	}
	repo.MarkGenerated(files)

	if !files[0].Generated {
		t.Error("bun.lock should be generated")
	}
	if files[1].Generated {
		t.Error("internal/api/api.go should not be generated")
	}
	// A deletion carries only an old path; that's what has to be asked about.
	if !files[2].Generated {
		t.Error("web/dist/old.js should be generated")
	}
}
