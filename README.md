<div align="center">

# local-review

**Review a git branch locally, leave line-level comments, and hand the result to your coding agent as clean markdown.**

[![Release](https://img.shields.io/github/v/release/rosenbjerg/local-review?sort=semver)](https://github.com/rosenbjerg/local-review/releases/latest)
[![CI](https://github.com/rosenbjerg/local-review/actions/workflows/ci.yml/badge.svg)](https://github.com/rosenbjerg/local-review/actions/workflows/ci.yml)
[![Go](https://img.shields.io/github/go-mod/go-version/rosenbjerg/local-review)](go.mod)
[![License: GPL v3](https://img.shields.io/github/license/rosenbjerg/local-review)](LICENSE)

</div>

GitHub-style review ergonomics for a branch you haven't pushed — or don't want to.
Point it at a folder of git repos, pick a branch, and review what it introduces (or
just the work sitting in your working tree): comment on any line or range, reply in
threads, resolve what's done, tick off files as you read them. Then **export the
review as markdown** — path, lines, snippet, comment — and paste it into your
coding agent. The agent can reply through the API, and its replies show up live.

One binary: Go backend with the React frontend embedded, nothing to install but
`git`.

<p align="center">
  <img src="docs/screenshot.png" alt="local-review reviewing a branch diff: hierarchical file tree with reviewed checkboxes on the left, a syntax-highlighted diff in the center, and the cross-file comments panel on the right" width="900">
  <br>
  <em>Reviewing a branch diff, ready to export to a coding agent.</em>
</p>

## Highlights

- **Branch-scoped diff, narrowable.** Diffs against the merge-base with your trunk,
  so you only see what the branch adds. Narrow it to one commit onwards, or move the
  other end to your working tree or the index. The toolbar says which two ends it's
  actually comparing.
- **Comment anywhere.** Any line or dragged range, changed or not, and on files the
  branch never touched. Threads with replies, a type per comment (bug / suggestion /
  question / nit), `#id` cross-references, resolved threads that drop out of the
  export, and a free-text summary that leads it.
- **Anchors that follow the code.** Comments capture the code they point at and
  follow it as the branch moves — renames included — badging anything that *moved* or
  went *outdated*.
- **A pane that keeps score.** Every thread in one list: sorted by file, age or
  activity, filtered by status, type or author. Threads whose last word was the
  agent's are marked *awaiting you*, and `n`/`p` steps whatever's on screen.
- **Reviewed-file tracking.** Tick off a file or a whole folder; the tree shows how
  far you've got, and a file un-ticks itself if it changes after you read it.
- **Agent handoff, two ways.** Hand an agent the review to address, or send one to
  review the branch and file its findings next to yours —
  [details below](#the-agent-handoff-loop).
- **Live.** Every tab follows along over SSE, a filesystem watcher catches edits and
  commits made outside the UI, and the tab title counts what an agent said while you
  were away.
- **Reads like a proper diff viewer.** Word-level intra-line diffs, ~235 languages
  highlighted, expandable context between hunks, rendered markdown (mermaid
  included), before/after previews for images, and find-in-file on any word you
  select — with lazy rendering so a huge branch stays responsive.
- **Keyboard-driven.** `j`/`k` between files, `n`/`p` between comments, `v` to mark
  reviewed and jump to the next unread, `/` to search files, `?` for the rest.

## Install

### Download a prebuilt binary

Grab the latest from [**Releases**](https://github.com/rosenbjerg/local-review/releases/latest):

| Platform | Asset |
|----------|-------|
| macOS (Apple Silicon) | `local-review-darwin-arm64` |
| macOS (Intel) | `local-review-darwin-amd64` |
| Linux (x86-64) | `local-review-linux-amd64` |
| Linux (ARM64) | `local-review-linux-arm64` |
| Windows (x86-64) | `local-review-windows-amd64.exe` |

On macOS/Linux make it executable — and on macOS clear the download quarantine:

```sh
chmod +x local-review-darwin-arm64
xattr -d com.apple.quarantine local-review-darwin-arm64   # macOS only
```

### Install with mise

[mise](https://mise.jdx.dev) installs it straight from the GitHub releases, picking
the binary for your OS and architecture:

```sh
mise use -g github:rosenbjerg/local-review
```

Or pin it in a project's `mise.toml`:

```toml
[tools]
"github:rosenbjerg/local-review" = "latest"
```

### Build from source

Requires Go (see [`go.mod`](go.mod)) and Node.js 22+. The frontend must be built
before the binary — it's embedded via `go:embed`:

```sh
npm --prefix web install
npm --prefix web run build        # → web/dist (embedded)
go build -o local-review .
```

Or `./start.sh <folder-of-git-repos>`, which builds everything and starts the
server.

## Usage

```sh
./local-review -root /path/to/folder-of-repos
```

Opens `http://127.0.0.1:7777`. From there:

1. **Pick a repo and a head branch.** The base defaults to your trunk — a local
   `main`/`master`, else the remote's default — and the diff runs from its
   merge-base with head. Override it with an explicit ref if you like.
2. **Narrow the view, if you want.** The **from** picker starts the diff at one of
   the branch's own commits, that commit's own changes included. **uncommitted**
   (while you have the branch checked out) moves the other end to your working tree,
   and unticking **unstaged** points it at the index instead — staged only. These are
   view options, not part of the review: comments and reviewed marks stay put as you
   switch, and the uncommitted/unstaged choice is remembered per repo. If the file
   count disagrees with your git client, hover it — usually your client is comparing
   against `HEAD` rather than the merge-base.
3. **Review, then export.** Click a line number or drag across a range to comment;
   the **+** above the file tree pulls in a file the branch didn't touch. Expand the
   hidden lines between hunks when you want more context, sort or filter the comments
   pane to work through what's open, and press `?` for the shortcuts. **Export**
   previews the markdown, then copies or downloads it.

State lives in SQLite under `~/.local-review/` (move it with `-data-dir`), keyed by
repo path — so one install serves many repos and resumes each review on its own.
Draft reviews older than `-retention-days` (default 30) are pruned at startup.

### The agent handoff loop

The review is just markdown: your summary, then every comment as a file path,
line(s), captured snippet and note, grouped by file, resolved threads left out so
the agent only sees what's still open. **Agent prompts** in the toolbar gives you
two copyable prompts, one per direction:

- **Address the review** — points a coding agent at *this review's* API, so it pulls
  the markdown itself (`POST /api/reviews/{id}/export`) and replies to comments by
  id. Best for iterating: add or change a comment and the agent just re-fetches — no
  re-paste.
- **Do a review** — sends an agent at the branch to review it adversarially and file
  what it finds as comments, tagged `review-agent` so its findings stay distinct from
  yours and from the agent addressing them. It reads back only its own threads
  (`GET /api/reviews/{id}/comments?author=review-agent`).

Both are editable, and **Save** keeps your version for that repo — house rules, the
test command to run, conventions to respect. The review-specific bits stay as
placeholders (`{{origin}}`, `{{reviewId}}`, `{{headRef}}`, `{{baseRef}}`) and are
filled in when you copy, so a saved prompt still works on the next review. **Reset**
brings back the built-in one.

Prefer pasting? **Export** can bundle **agent reply instructions** — a `curl`
example so a paste-only agent can still post replies. Either way replies come back
to `POST /api/comments/{id}/replies` and appear live in the UI.

For scripting there's `GET /api/reviews` (every stored review, so a script can find
the one it wants) and `DELETE /api/reviews/{id}`, which discards one outright —
comments, replies and reviewed marks with it. No undo, and no button for it in the
UI; **Reset** is the one that keeps the review and clears its contents.

### Flags

| Flag | Default | Purpose |
|------|---------|---------|
| `-root` | `.` | Folder containing one or more git repositories |
| `-port` | `7777` | Listen port |
| `-data-dir` | `~/.local-review` | Directory for the SQLite DB |
| `-retention-days` | `30` | Prune draft reviews older than this on startup |
| `-no-open` | `false` | Don't auto-open the browser |

## How it works

One Go binary serves the JSON API and the embedded React app, reads git by shelling
out to the real `git`, and keeps review state in SQLite — the backend is the source
of truth, the frontend a cache over it. Comment staleness and reviewed state are
*derived* on every read rather than trusted from a stored flag; open tabs refetch on
an SSE ping, and while anyone is watching a review the server fingerprints the repo
on a timer, so changes made outside the UI turn up on their own. It listens on
localhost only and refuses browser writes that came from another page, so a site you
happen to visit can't quietly drive the API — `curl` and your agent are unaffected.

For a map of the codebase and the architecture notes, see [CLAUDE.md](CLAUDE.md).

## Develop

Run the Go server and the Vite dev server side by side — Vite proxies `/api` to
`:7777`:

```sh
./local-review -root /path/to/folder-of-repos -no-open   # terminal 1
npm --prefix web run dev                                 # terminal 2 → :5173
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for the build order, checks and conventions.

## Contributing & security

- Contributions welcome — start with [CONTRIBUTING.md](CONTRIBUTING.md).
- To report a vulnerability, see [SECURITY.md](SECURITY.md) (please don't open a
  public issue).

## License

[GPL-3.0](LICENSE) © Malte Rosenbjerg.
