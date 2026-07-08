package export

import (
	"strings"
	"testing"

	"local-review/internal/store"
)

func TestFenceFor(t *testing.T) {
	cases := []struct {
		in   string
		want string
	}{
		{"no backticks", "```"},
		{"inline `code`", "```"},
		{"a fence ```go", "````"},
		{"nested ```` quad", "`````"},
	}
	for _, c := range cases {
		if got := fenceFor(c.in); got != c.want {
			t.Errorf("fenceFor(%q) = %q, want %q", c.in, got, c.want)
		}
	}
}

// A snippet containing a triple-backtick fence must not prematurely close the
// surrounding code block: the opening and closing fences the exporter emits
// must be longer than any backtick run in the snippet.
func TestRenderFenceNotClosedBySnippet(t *testing.T) {
	snippet := "# Heading\n```js\nconsole.log(1)\n```\n"
	r := &store.Review{
		HeadRef: "feature",
		BaseRef: "main",
		HeadSHA: "abc1234",
		Comments: []store.Comment{
			{FilePath: "README.md", StartLine: 1, EndLine: 4, Type: "nit", Snippet: snippet, Body: "note"},
		},
	}
	out := Render(r)

	// The emitted fence must be at least 4 backticks (snippet's longest run is 3).
	if !strings.Contains(out, "````markdown\n") {
		t.Fatalf("expected a 4-backtick opening fence, got:\n%s", out)
	}
	// The snippet's own ``` lines must survive verbatim inside the block.
	if !strings.Contains(out, "```js\nconsole.log(1)\n```") {
		t.Fatalf("snippet fence was altered:\n%s", out)
	}
	// Sanity: the block closes exactly once with the longer fence.
	if strings.Count(out, "````") != 2 {
		t.Fatalf("expected exactly one opening and one closing 4-backtick fence, got:\n%s", out)
	}
}
