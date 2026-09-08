<div align="center">

# local-review

**Review your coding agent's branch before you push it, and hand the feedback back as clean markdown.**

[![Release](https://img.shields.io/github/v/release/rosenbjerg/local-review?sort=semver)](https://github.com/rosenbjerg/local-review/releases/latest)
[![CI](https://github.com/rosenbjerg/local-review/actions/workflows/ci.yml/badge.svg)](https://github.com/rosenbjerg/local-review/actions/workflows/ci.yml)
[![Go](https://img.shields.io/github/go-mod/go-version/rosenbjerg/local-review)](go.mod)
[![License: GPL v3](https://img.shields.io/github/license/rosenbjerg/local-review)](LICENSE)

</div>

Made for reading what a coding agent wrote before it goes anywhere. Point it at a
folder of git repos, pick the agent's branch, and review it like a pull request:
comment on lines, flag bugs, ask questions. Then hand the whole review back to the
agent as one markdown document, each point with its file, lines, snippet and note.
The agent replies through the local API, and its answers show up live beside your
comments.

One binary: Go backend with the React frontend embedded. Nothing to install but `git`.

<p align="center">
  <img src="docs/screenshot.png" alt="local-review reviewing a branch diff: file tree with reviewed checkboxes on the left, a syntax-highlighted diff in the center, and the comments panel on the right" width="900">
</p>

## Highlights

- **Branch-scoped diff.** Diffs against the merge-base with your trunk, so you only
  see what the branch adds. Narrow it to one commit onwards, or compare against your
  working tree or index instead.
- **Comment anywhere.** Any line or dragged range, changed or not, even in files the
  branch never touched. Threads with replies, a type per comment (bug, suggestion,
  question, nit), `#id` cross-references, and a summary that leads the export.
- **Anchors that follow the code.** Comments capture the code they point at and
  follow it as the branch moves, renames included, badged when it *moved* or went
  *outdated*.
- **A comments pane that keeps score.** Every thread in one list, sorted by file, age
  or activity, filtered by status, type or author, and searchable. Threads where the
  agent had the last word are marked *awaiting you*.
- **Reviewed-file tracking.** Tick off a file or a whole folder. A file un-ticks
  itself if it changes after you read it.
- **Agent handoff, both ways.** Hand an agent the review to address, or send one to
  review the branch and file its findings next to yours. See
  [Working with an agent](#working-with-an-agent).
- **Live.** Every tab follows along, edits and commits made outside the UI are picked
  up, and the tab title counts what an agent said while you were away.
- **A proper diff viewer.** Word-level diffs, ~235 highlighted languages, light and dark
  editor color themes, expandable context between hunks, rendered markdown and mermaid,
  image previews, and lazy rendering so a huge branch stays responsive.
- **Keyboard-driven.** `j`/`k` between files, `n`/`p` between comments, `v` to mark
  reviewed and jump to the next unread, `/` to search files, `?` for the rest.

## Install

### With mise

[mise](https://mise.jdx.dev) picks the right binary from the GitHub releases:

```sh
mise use -g github:rosenbjerg/local-review
```

Or pin it in a project's `mise.toml`:

```toml
[tools]
"github:rosenbjerg/local-review" = "latest"
```

### Download a binary

Grab the latest from [Releases](https://github.com/rosenbjerg/local-review/releases/latest):

| Platform | Asset |
|----------|-------|
| macOS (Apple Silicon) | `local-review-darwin-arm64` |
| macOS (Intel) | `local-review-darwin-amd64` |
| Linux (x86-64) | `local-review-linux-amd64` |
| Linux (ARM64) | `local-review-linux-arm64` |
| Windows (x86-64) | `local-review-windows-amd64.exe` |

On macOS/Linux make it executable, and on macOS clear the download quarantine:

```sh
chmod +x local-review-darwin-arm64
xattr -d com.apple.quarantine local-review-darwin-arm64   # macOS only
```

### Build from source

Requires Go (see [`go.mod`](go.mod)) and [Bun](https://bun.com) 1.4+. The frontend
is embedded in the binary, so build it first:

```sh
bun install --cwd web
bun run --cwd web build
go build -o local-review .
```

`./start.sh <folder-of-git-repos>` does all three and starts the server.

## Usage

```sh
local-review -root /path/to/folder-of-repos
```

Opens `http://127.0.0.1:7777`. From there:

1. **Pick a repo and a branch.** The base defaults to your trunk (a local
   `main`/`master`, else the remote's default) and the diff runs from its merge-base
   with the branch. Override it with any ref.
2. **Narrow the view, if you want.** **from** starts the diff at one of the branch's
   own commits, that commit included. **uncommitted** compares against your working
   tree instead, and unticking **unstaged** compares against the index. These are view
   options: comments and reviewed marks stay put as you switch.
3. **Review, then export.** Click a line number or drag across a range to comment.
   The **+** above the file tree pulls in a file the branch didn't touch. **Export**
   previews the markdown, then copies or downloads it.

Press `?` for the keyboard shortcuts. If the file count disagrees with your git
client, hover it: the client is usually comparing against `HEAD` rather than the
merge-base.

State lives in SQLite under `~/.local-review/`, keyed by repo path, so one install
serves many repos and resumes each review where you left it. Draft reviews older than
`-retention-days` (default 30) are pruned at startup.

### Working with an agent

The export is plain markdown: your summary, then every open comment with its file
path, lines, captured snippet and note, grouped by file. Resolved threads are left
out. **Agent prompts** in the toolbar gives you a copyable prompt for each direction:

- **Address the review.** Points a coding agent at this review through the local API.
  It fetches the markdown itself and replies to comments by id, so when you add or
  change a comment the agent just re-fetches. No re-pasting.
- **Do a review.** Sends an agent to review the branch and file what it finds as
  comments. Pick a focus: *Correctness*, *Security*, *Design* or *Tests*. Each focus
  files under its own author, so its comments stay distinct from yours and from other
  passes, and the comments pane filters by author.

Both prompts are editable. **Save** keeps your version for that repo, for house rules
or the test command to run. The review-specific parts are placeholders filled in when
you copy, so a saved prompt works on the next review too. **Reset** restores the
built-in one.

Prefer pasting? **Export** can bundle reply instructions so a paste-only agent can
still post replies. Either way, replies appear live in the UI.

### Flags

| Flag | Default | Purpose |
|------|---------|---------|
| `-root` | `.` | Folder containing one or more git repositories |
| `-port` | `7777` | Listen port |
| `-data-dir` | `~/.local-review` | Directory for the SQLite DB |
| `-retention-days` | `30` | Prune draft reviews older than this on startup |
| `-no-open` | `false` | Don't auto-open the browser |

## How it works

One Go binary serves the API and the embedded React app, reads git by shelling out to
the real `git`, and keeps review state in SQLite. The backend is the source of truth:
comment staleness and reviewed state are derived on every read, never trusted from a
stored flag. It listens on localhost only and refuses browser writes from other
origins, so a site you happen to visit can't drive the API. `curl` and your agent are
unaffected.

For a map of the codebase, see [CLAUDE.md](CLAUDE.md).

## Contributing

Run the Go server and the Vite dev server side by side. Vite proxies `/api` to `:7777`:

```sh
local-review -root /path/to/folder-of-repos -no-open   # terminal 1
bun run --cwd web dev                                  # terminal 2 → :5173
```

[CONTRIBUTING.md](CONTRIBUTING.md) covers the build order, checks and conventions.
To report a vulnerability, see [SECURITY.md](SECURITY.md) rather than opening a
public issue.

## License

[GPL-3.0](LICENSE) © Malte Rosenbjerg.
