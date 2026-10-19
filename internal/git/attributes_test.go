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

	got := repo.Attributes([]string{"src/schema.ts", "bun.lock", "src/tags.ts", "src/App.tsx", "web/dist/a.js"})
	want := map[string]bool{
		"src/schema.ts": true,  // =true
		"bun.lock":      false, // unset beats the built-in pattern
		"src/tags.ts":   true,  // bare set
		"src/App.tsx":   false,
		"web/dist/a.js": true, // unspecified, so the built-in pattern stands
	}
	for path, w := range want {
		if got[path].Generated != w {
			t.Errorf("Attributes[%q].Generated = %v, want %v", path, got[path].Generated, w)
		}
	}
}

func TestLanguageAttribute(t *testing.T) {
	dir, repo := initRepoOn(t, "main")
	mustWrite(t, dir, ".gitattributes", "*.feature linguist-language=Gherkin\n*.h linguist-language=C++\nplain.txt linguist-language\n")
	gitCmd(t, dir, "add", "-A")
	gitCmd(t, dir, "commit", "-q", "-m", "attrs")

	got := repo.Attributes([]string{"specs/login.feature", "src/a.h", "plain.txt", "src/a.go"})
	want := map[string]string{
		"specs/login.feature": "Gherkin",
		"src/a.h":             "C++",
		"plain.txt":           "",
		"src/a.go":            "",
	}
	for path, w := range want {
		if got[path].Language != w {
			t.Errorf("Attributes[%q].Language = %q, want %q", path, got[path].Language, w)
		}
	}
}

func TestAttributesNoPaths(t *testing.T) {
	_, repo := initRepoOn(t, "main")
	if got := repo.Attributes(nil); len(got) != 0 {
		t.Errorf("Attributes(nil) = %v, want empty", got)
	}
}

func TestMarkAttributes(t *testing.T) {
	dir, repo := initRepoOn(t, "main")
	firstCommit(t, dir)

	files := []FileDiff{
		{NewPath: "bun.lock", Status: FileModified},
		{NewPath: "internal/api/api.go", Status: FileModified},
		{OldPath: "web/dist/old.js", Status: FileDeleted},
	}
	repo.MarkAttributes(files)

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
