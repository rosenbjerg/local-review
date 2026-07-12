// Package export renders a review to the canonical markdown format.
package export

import (
	"fmt"
	"path/filepath"
	"sort"
	"strings"
	"unicode"

	"local-review/internal/store"
)

// Collapse control runes (newlines especially) to spaces so an interpolated value
// can't inject a fake heading into the artifact the agent consumes as its tasks.
func inlineField(s string) string {
	return strings.TrimSpace(strings.Map(func(r rune) rune {
		if unicode.IsControl(r) {
			return ' '
		}
		return r
	}, s))
}

func Render(r *store.Review, agentInstructions bool, baseURL string) string {
	var b strings.Builder

	shortSHA := r.HeadSHA
	if len(shortSHA) > 7 {
		shortSHA = shortSHA[:7]
	}

	fmt.Fprintf(&b, "# Review: %s → %s @ %s\n\n", r.HeadRef, r.BaseRef, shortSHA)

	// Resolved threads need no agent action, so the export carries only open ones.
	unresolved := make([]store.Comment, 0, len(r.Comments))
	for _, c := range r.Comments {
		if !c.Resolved {
			unresolved = append(unresolved, c)
		}
	}
	resolvedCount := len(r.Comments) - len(unresolved)

	files := groupByFile(unresolved)
	fileNames := make([]string, 0, len(files))
	for name := range files {
		fileNames = append(fileNames, name)
	}
	sort.Strings(fileNames)

	fmt.Fprintf(&b, "_%d unresolved comment(s) across %d file(s)_\n", len(unresolved), len(fileNames))
	if resolvedCount > 0 {
		fmt.Fprintf(&b, "_%d resolved thread(s) omitted._\n", resolvedCount)
	}

	for _, name := range fileNames {
		fmt.Fprintf(&b, "\n## %s\n", inlineField(name))
		comments := files[name]
		sort.Slice(comments, func(i, j int) bool {
			return comments[i].StartLine < comments[j].StartLine
		})
		lang := langForExt(name)
		for _, c := range comments {
			fmt.Fprintf(&b, "\n### #%d · %s · %s · %s\n", c.ID, anchorLabel(c), inlineField(c.Type), inlineField(c.Author))
			if strings.TrimSpace(c.Snippet) != "" {
				snippet := strings.TrimRight(c.Snippet, "\n")
				fence := fenceFor(snippet)
				fmt.Fprintf(&b, "%s%s\n%s\n%s\n", fence, lang, snippet, fence)
			}
			body := strings.TrimSpace(c.Body)
			if body != "" {
				fmt.Fprintf(&b, "%s\n", body)
			}
			for _, rep := range c.Replies {
				renderReply(&b, rep)
			}
		}
	}

	if agentInstructions {
		var exampleID int64
		if len(unresolved) > 0 {
			exampleID = unresolved[0].ID
		}
		renderAgentInstructions(&b, baseURL, exampleID)
	}

	return b.String()
}

func renderAgentInstructions(b *strings.Builder, baseURL string, exampleID int64) {
	if baseURL == "" {
		baseURL = "http://127.0.0.1:7777"
	}
	id := "<comment-id>"
	if exampleID > 0 {
		id = fmt.Sprintf("%d", exampleID)
	}
	b.WriteString("\n---\n\n## Addressing these comments\n\n")
	b.WriteString("Work through every comment above. For each: if you agree, make the change and reply " +
		"noting what you did; if you disagree or need clarification, reply explaining why or asking a " +
		"question. Comment types signal intent — bug and suggestion want a fix (or a reason it's " +
		"declined), question wants an answer, nit is optional. A comment marked (outdated) or " +
		"(moved from …) means the code shifted since it was written — trust the quoted snippet over " +
		"the line number.\n\n")
	b.WriteString("Each comment is tagged with an id (the `#<id>` in its heading). Reply to one over " +
		"HTTP — to record what you changed or ask a question — by POSTing to the local-review API:\n\n")
	fmt.Fprintf(b, "```sh\ncurl -X POST %s/api/comments/%s/replies \\\n"+
		"  -H 'Content-Type: application/json' \\\n"+
		"  -d '{\"body\": \"your reply here\"}'\n```\n", baseURL, id)
}

// A blank line between replies keeps adjacent blockquotes from merging into one.
func renderReply(b *strings.Builder, rep store.Reply) {
	fmt.Fprintf(b, "\n> **↳ reply #%d · %s**\n", rep.ID, inlineField(rep.Author))
	body := strings.TrimSpace(rep.Body)
	if body == "" {
		return
	}
	b.WriteString(">\n")
	for _, line := range strings.Split(body, "\n") {
		fmt.Fprintf(b, "> %s\n", line)
	}
}

// fenceFor returns a backtick fence long enough that a ``` inside s can't close
// the block early: one longer than the longest run inside (CommonMark), min three.
func fenceFor(s string) string {
	longest, run := 0, 0
	for _, r := range s {
		if r == '`' {
			run++
			if run > longest {
				longest = run
			}
		} else {
			run = 0
		}
	}
	n := longest + 1
	if n < 3 {
		n = 3
	}
	return strings.Repeat("`", n)
}

func groupByFile(comments []store.Comment) map[string][]store.Comment {
	m := make(map[string][]store.Comment)
	for _, c := range comments {
		m[c.FilePath] = append(m[c.FilePath], c)
	}
	return m
}

func lineLabel(start, end int) string {
	if end > start {
		return fmt.Sprintf("L%d–%d", start, end)
	}
	return fmt.Sprintf("L%d", start)
}

func anchorLabel(c store.Comment) string {
	if c.StartLine == 0 {
		return "file" // file-level comment (binary/image), not anchored to a line
	}
	switch c.AnchorStatus {
	case store.AnchorMoved:
		return fmt.Sprintf("%s (moved from %s)",
			lineLabel(c.CurrentStartLine, c.CurrentEndLine), lineLabel(c.StartLine, c.EndLine))
	case store.AnchorOutdated:
		return fmt.Sprintf("%s (outdated)", lineLabel(c.StartLine, c.EndLine))
	default:
		return lineLabel(c.StartLine, c.EndLine)
	}
}

func langForExt(path string) string {
	switch strings.ToLower(filepath.Ext(path)) {
	case ".go":
		return "go"
	case ".ts":
		return "ts"
	case ".tsx":
		return "tsx"
	case ".js", ".mjs", ".cjs":
		return "js"
	case ".jsx":
		return "jsx"
	case ".py":
		return "python"
	case ".rs":
		return "rust"
	case ".java":
		return "java"
	case ".rb":
		return "ruby"
	case ".c", ".h":
		return "c"
	case ".cpp", ".cc", ".hpp":
		return "cpp"
	case ".css":
		return "css"
	case ".html":
		return "html"
	case ".json":
		return "json"
	case ".yaml", ".yml":
		return "yaml"
	case ".sh", ".bash":
		return "bash"
	case ".sql":
		return "sql"
	case ".md":
		return "markdown"
	default:
		return ""
	}
}
