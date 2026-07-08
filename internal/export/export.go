// Package export renders a review to the canonical markdown format.
package export

import (
	"fmt"
	"path/filepath"
	"sort"
	"strings"

	"local-review/internal/store"
)

// Render produces the markdown artifact for a review.
func Render(r *store.Review) string {
	var b strings.Builder

	shortSHA := r.HeadSHA
	if len(shortSHA) > 7 {
		shortSHA = shortSHA[:7]
	}

	fmt.Fprintf(&b, "# Review: %s → %s @ %s\n\n", r.HeadRef, r.BaseRef, shortSHA)

	files := groupByFile(r.Comments)
	fileNames := make([]string, 0, len(files))
	for name := range files {
		fileNames = append(fileNames, name)
	}
	sort.Strings(fileNames)

	fmt.Fprintf(&b, "_%d comment(s) across %d file(s)_\n", len(r.Comments), len(fileNames))

	for _, name := range fileNames {
		fmt.Fprintf(&b, "\n## %s\n", name)
		comments := files[name]
		sort.Slice(comments, func(i, j int) bool {
			return comments[i].StartLine < comments[j].StartLine
		})
		lang := langForExt(name)
		for _, c := range comments {
			fmt.Fprintf(&b, "\n### %s · %s\n", lineLabel(c.StartLine, c.EndLine), c.Type)
			if strings.TrimSpace(c.Snippet) != "" {
				snippet := strings.TrimRight(c.Snippet, "\n")
				fence := fenceFor(snippet)
				fmt.Fprintf(&b, "%s%s\n%s\n%s\n", fence, lang, snippet, fence)
			}
			body := strings.TrimSpace(c.Body)
			if body != "" {
				fmt.Fprintf(&b, "%s\n", body)
			}
		}
	}

	return b.String()
}

// fenceFor returns a backtick fence long enough to safely wrap s: one backtick
// longer than the longest run of backticks inside it (CommonMark rule), and at
// least three. Prevents a snippet containing ``` (e.g. from a reviewed .md
// file) from prematurely closing the fenced block.
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
