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

// Each comment heading carries its global id so a coding agent reading the
// export can reference a specific comment (e.g. "comment #42 done").
func TestRenderIncludesCommentID(t *testing.T) {
	r := &store.Review{
		HeadRef: "feature",
		BaseRef: "main",
		HeadSHA: "abc1234",
		Comments: []store.Comment{
			{ID: 42, FilePath: "main.go", StartLine: 12, EndLine: 15, Type: "bug", Body: "off-by-one"},
		},
	}
	out := Render(r, false, "")
	if !strings.Contains(out, "### #42 · L12–15 · bug") {
		t.Fatalf("expected comment heading with id, got:\n%s", out)
	}
}

// The agent-instructions section is opt-in: absent by default, and when enabled
// carries a concrete curl example (real comment id + base URL) so a coding
// agent can reply over HTTP.
func TestRenderAgentInstructions(t *testing.T) {
	r := &store.Review{
		HeadRef: "feature", BaseRef: "main", HeadSHA: "abc1234",
		Comments: []store.Comment{
			{ID: 42, FilePath: "main.go", StartLine: 12, EndLine: 15, Type: "bug", Body: "off-by-one"},
		},
	}
	if out := Render(r, false, "http://127.0.0.1:7777"); strings.Contains(out, "Addressing these comments") {
		t.Fatalf("instructions should be absent when disabled, got:\n%s", out)
	}
	out := Render(r, true, "http://127.0.0.1:7777")
	if !strings.Contains(out, "## Addressing these comments") {
		t.Fatalf("expected instructions section, got:\n%s", out)
	}
	// The section states the task contract and the type/anchor legend, not just
	// the reply mechanism.
	if !strings.Contains(out, "make the change and reply") {
		t.Fatalf("expected the task contract, got:\n%s", out)
	}
	if !strings.Contains(out, "trust the quoted snippet over the line number") {
		t.Fatalf("expected the anchor-drift legend, got:\n%s", out)
	}
	if !strings.Contains(out, "curl -X POST http://127.0.0.1:7777/api/comments/42/replies") {
		t.Fatalf("expected concrete curl example, got:\n%s", out)
	}
}

// With no comments there is no example id, so the curl example falls back to a
// placeholder rather than emitting a bogus id.
func TestRenderAgentInstructionsPlaceholder(t *testing.T) {
	r := &store.Review{HeadRef: "feature", BaseRef: "main", HeadSHA: "abc1234"}
	out := Render(r, true, "")
	if !strings.Contains(out, "/api/comments/<comment-id>/replies") {
		t.Fatalf("expected placeholder id, got:\n%s", out)
	}
	if !strings.Contains(out, "http://127.0.0.1:7777") {
		t.Fatalf("expected baseURL fallback, got:\n%s", out)
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
	out := Render(r, false, "")

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
