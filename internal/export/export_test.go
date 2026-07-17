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

// author/type reach the export unfiltered from the API; a newline in them must
// not break out of the comment heading to inject a fake markdown section into
// the artifact a coding agent consumes.
func TestRenderSanitizesHeadingFields(t *testing.T) {
	r := &store.Review{
		HeadRef: "feature", BaseRef: "main", HeadSHA: "abc1234",
		Comments: []store.Comment{{
			ID: 7, FilePath: "main.go", StartLine: 1, EndLine: 1,
			Type:   "bug\n## Injected",
			Author: "agent\n---\n# Fake",
			Body:   "x",
		}},
	}
	out := Render(r, false, "")
	if strings.Contains(out, "\n## Injected") || strings.Contains(out, "\n# Fake") || strings.Contains(out, "\n---") {
		t.Fatalf("heading fields not sanitized — injection present:\n%s", out)
	}
	if !strings.Contains(out, "### #7 · L1 · bug ## Injected · agent --- # Fake") {
		t.Fatalf("expected flattened heading, got:\n%s", out)
	}
}

// A snippet containing a triple-backtick fence must not prematurely close the
// surrounding code block: the opening and closing fences the exporter emits
// must be longer than any backtick run in the snippet.
// A reply renders as a blockquote with an id/author header and each body line
// prefixed — so multi-line replies stay inside one quote and adjacent replies
// don't merge.
func TestRenderReply(t *testing.T) {
	var b strings.Builder
	renderReply(&b, store.Reply{ID: 7, Author: "agent", Body: "line one\nline two"})
	out := b.String()

	if !strings.Contains(out, "**↳ reply #7 · agent**") {
		t.Fatalf("missing reply header:\n%s", out)
	}
	if !strings.Contains(out, "> line one\n") || !strings.Contains(out, "> line two\n") {
		t.Fatalf("body lines not each quoted:\n%s", out)
	}
	// The blank ">" separator sits between the header and the body.
	if !strings.Contains(out, ">\n> line one") {
		t.Fatalf("missing blank-quote separator before body:\n%s", out)
	}
}

// An empty reply body renders only the header — no dangling blank blockquote.
func TestRenderReplyEmptyBody(t *testing.T) {
	var b strings.Builder
	renderReply(&b, store.Reply{ID: 8, Author: "reviewer", Body: "   "})
	out := b.String()

	if !strings.Contains(out, "**↳ reply #8 · reviewer**") {
		t.Fatalf("missing reply header:\n%s", out)
	}
	if strings.Contains(out, ">\n") {
		t.Fatalf("empty body should not emit a quoted body block:\n%s", out)
	}
}

// A reply author must not be able to inject a fake markdown heading via control
// characters — inlineField collapses them, mirroring the comment-heading guard.
func TestRenderReplyAuthorCannotInjectHeading(t *testing.T) {
	var b strings.Builder
	renderReply(&b, store.Reply{ID: 9, Author: "evil\n## Fake Heading", Body: "x"})
	out := b.String()

	if strings.Contains(out, "\n## Fake Heading") {
		t.Fatalf("author newline was not neutralized, heading injected:\n%s", out)
	}
}

// End-to-end: a comment's replies appear under it in the rendered artifact.
func TestRenderIncludesReplies(t *testing.T) {
	r := &store.Review{
		HeadRef: "feature", BaseRef: "main", HeadSHA: "abc1234",
		Comments: []store.Comment{{
			ID: 1, FilePath: "main.go", StartLine: 3, EndLine: 3, Type: "bug", Body: "fix this",
			Replies: []store.Reply{{ID: 2, Author: "agent", Body: "done in a1b2c3d"}},
		}},
	}
	out := Render(r, false, "")
	if !strings.Contains(out, "**↳ reply #2 · agent**") || !strings.Contains(out, "> done in a1b2c3d") {
		t.Fatalf("reply not rendered under its comment:\n%s", out)
	}
}

// A comment whose move followed a rename is filed under its NEW path (never the
// vanished old one), and its label names the origin path so the agent can trace it.
func TestRenderFollowsRenamedComment(t *testing.T) {
	r := &store.Review{
		HeadRef: "feature", BaseRef: "main", HeadSHA: "abc1234",
		Comments: []store.Comment{{
			ID: 5, FilePath: "old.go", StartLine: 2, EndLine: 2, Type: "bug", Body: "x",
			AnchorStatus: store.AnchorMoved, CurrentStartLine: 4, CurrentEndLine: 4, CurrentFilePath: "new.go",
		}},
	}
	out := Render(r, false, "")
	if !strings.Contains(out, "## new.go") {
		t.Fatalf("renamed comment should be filed under the new path:\n%s", out)
	}
	if strings.Contains(out, "## old.go") {
		t.Fatalf("renamed comment should not appear under the old path:\n%s", out)
	}
	if !strings.Contains(out, "L4 (moved from old.go:L2)") {
		t.Fatalf("anchor label should name the origin path:\n%s", out)
	}
}

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

	if !strings.Contains(out, "````markdown\n") {
		t.Fatalf("expected a 4-backtick opening fence, got:\n%s", out)
	}
	if !strings.Contains(out, "```js\nconsole.log(1)\n```") {
		t.Fatalf("snippet fence was altered:\n%s", out)
	}
	if strings.Count(out, "````") != 2 {
		t.Fatalf("expected exactly one opening and one closing 4-backtick fence, got:\n%s", out)
	}
}
