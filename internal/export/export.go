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

// inlineField collapses control runes to spaces, so an interpolated value can't inject a heading.
func inlineField(s string) string {
	return strings.TrimSpace(strings.Map(func(r rune) rune {
		if unicode.IsControl(r) {
			return ' '
		}
		return r
	}, s))
}

// ShortSHA is the abbreviated sha used in the title and the export filename, so the two can't disagree.
func ShortSHA(sha string) string {
	if len(sha) > 7 {
		return sha[:7]
	}
	return sha
}

func Render(r *store.Review, agentInstructions bool, baseURL string) string {
	var b strings.Builder

	fmt.Fprintf(&b, "# Review: %s → %s @ %s\n\n", r.HeadRef, r.BaseRef, ShortSHA(r.HeadSHA))

	// Not a "## Summary" heading: files own the h2 level, so it would read as a file named Summary.
	if summary := strings.TrimSpace(r.Summary); summary != "" {
		fmt.Fprintf(&b, "**Summary**\n\n%s\n\n", summary)
	}

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
			fmt.Fprintf(&b, "\n### #%d · %s · %s · %s\n", c.ID, anchorLabel(c), inlineField(string(c.Type)), inlineField(c.Author))
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

// fenceFor returns a fence one backtick longer than the longest run in s (min three), so s can't close it early.
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

func effectivePath(c store.Comment) string {
	if c.AnchorStatus == store.AnchorMoved && c.CurrentFilePath != "" {
		return c.CurrentFilePath
	}
	return c.FilePath
}

func groupByFile(comments []store.Comment) map[string][]store.Comment {
	m := make(map[string][]store.Comment)
	for _, c := range comments {
		p := effectivePath(c)
		m[p] = append(m[p], c)
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
		return "file"
	}
	switch c.AnchorStatus {
	case store.AnchorMoved:
		from := lineLabel(c.StartLine, c.EndLine)
		if c.CurrentFilePath != "" {
			from = c.FilePath + ":" + from
		}
		return fmt.Sprintf("%s (moved from %s)", lineLabel(c.CurrentStartLine, c.CurrentEndLine), from)
	case store.AnchorOutdated:
		return fmt.Sprintf("%s (outdated)", lineLabel(c.StartLine, c.EndLine))
	default:
		return lineLabel(c.StartLine, c.EndLine)
	}
}

// extToLang maps a lowercased extension to a fence language both GitHub and the frontend's Shiki aliases resolve.
var extToLang = map[string]string{
	"go":      "go",
	"rs":      "rust",
	"c":       "c",
	"h":       "c",
	"cpp":     "cpp",
	"cc":      "cpp",
	"cxx":     "cpp",
	"hpp":     "cpp",
	"hh":      "cpp",
	"cs":      "csharp",
	"swift":   "swift",
	"kt":      "kotlin",
	"kts":     "kotlin",
	"java":    "java",
	"scala":   "scala",
	"sc":      "scala",
	"m":       "objective-c",
	"mm":      "objective-cpp",
	"dart":    "dart",
	"zig":     "zig",
	"nim":     "nim",
	"cr":      "crystal",
	"jl":      "julia",
	"py":      "python",
	"rb":      "ruby",
	"php":     "php",
	"js":      "js",
	"mjs":     "js",
	"cjs":     "js",
	"jsx":     "jsx",
	"ts":      "ts",
	"mts":     "ts",
	"cts":     "ts",
	"tsx":     "tsx",
	"lua":     "lua",
	"pl":      "perl",
	"pm":      "perl",
	"r":       "r",
	"ex":      "elixir",
	"exs":     "elixir",
	"erl":     "erlang",
	"clj":     "clojure",
	"cljs":    "clojure",
	"cljc":    "clojure",
	"hs":      "haskell",
	"ml":      "ocaml",
	"mli":     "ocaml",
	"groovy":  "groovy",
	"gradle":  "groovy",
	"fs":      "fsharp",
	"fsx":     "fsharp",
	"vb":      "vb",
	"sh":      "bash",
	"bash":    "bash",
	"zsh":     "bash",
	"fish":    "fish",
	"ps1":     "powershell",
	"psm1":    "powershell",
	"bat":     "bat",
	"cmd":     "bat",
	"html":    "html",
	"htm":     "html",
	"css":     "css",
	"scss":    "scss",
	"less":    "less",
	"vue":     "vue",
	"svelte":  "svelte",
	"xml":     "xml",
	"svg":     "xml",
	"md":      "markdown",
	"tex":     "latex",
	"json":    "json",
	"jsonc":   "json",
	"yaml":    "yaml",
	"yml":     "yaml",
	"toml":    "toml",
	"ini":     "ini",
	"sql":     "sql",
	"graphql": "graphql",
	"gql":     "graphql",
	"proto":   "proto",
	"tf":      "terraform",
	"hcl":     "hcl",
	"cmake":   "cmake",
	"diff":    "diff",
	"patch":   "diff",
}

func langForExt(path string) string {
	ext := strings.ToLower(strings.TrimPrefix(filepath.Ext(path), "."))
	return extToLang[ext]
}
