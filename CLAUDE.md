# CLAUDE.md

Guidance for working in this repo. See `SPEC.md` for the design rationale and
`README.md` for user-facing usage.

## What this is

A local, single-user git review tool: review a branch's diff, leave line/range
comments, mark files reviewed, and export the review as markdown for a coding
agent. Go backend + React frontend, shipped as **one binary** (the built
frontend is embedded via `go:embed`).

## Commands

```sh
./start.sh <repo-path> [flags]   # build frontend + binary, run against a repo
```

Manual equivalent (frontend MUST be built before the binary — see Gotchas):

```sh
npm --prefix web install
npm --prefix web run build        # → web/dist (embedded)
go build -o local-review .
./local-review -repo <path>        # serves http://127.0.0.1:7777

# frontend dev with hot reload (Vite proxies /api → :7777):
./local-review -repo <path> -no-open   # terminal 1
npm --prefix web run dev               # terminal 2 → :5173
```

Checks: `go build ./...`, `go vet ./...`, `npm --prefix web run build` (runs `tsc`).
There is no browser automation here — verify backend changes with `curl` against
a throwaway git repo; verify pure frontend logic with a standalone node script.

## Layout

```
main.go                  server: embeds web/dist, resolves DB path, prunes drafts, opens browser
internal/git/git.go      git service (shells out to `git`): branches, merge-base, diff parser, file content
internal/store/store.go  SQLite (modernc.org/sqlite, WAL): reviews, comments, reviewed_files
internal/api/api.go      HTTP handlers (net/http, Go 1.22+ method+path routing)
internal/export/export.go  renders a review → canonical markdown
web/src/
  App.tsx                top-level state, 3-column resizable layout, all handlers
  api.ts                 fetch wrappers    types.ts  shared types
  components/
    FileExplorer.tsx     left pane: hierarchical file tree, collapse, reviewed toggle
    DiffView.tsx         center: per-file diff, inline threads/composer, Changed/Full toggle
    CommentThread.tsx    a single inline comment (edit/delete)
    CommentsPanel.tsx    right pane: cross-file comment overview, jump-to
    CommentComposer.tsx  type select + body textarea (reused for new/edit)
    ExportModal.tsx      markdown preview + copy + download
```

## Architecture notes

- **Backend is source of truth** for review state; React caches it and mutates
  via the API. Discrete actions (add/delete/toggle) save immediately.
- **Comments anchor to the new side** (HEAD path + line) and store a captured
  `snippet` so feedback survives line drift.
- **Diff base** defaults to the main-branch *name* (stored on the review); the
  `/api/diff` handler resolves it to `merge-base(base, head)` at query time, so
  the review shows only what the branch introduces.
- **DB lives next to the binary** (`os.Executable()`), falling back to an app
  data dir if that's not writable. One DB serves many repos, keyed by abs path.
- Reviews resume by `(repo_path, base_ref, head_ref)` regardless of status, so
  exporting (which sets status `exported`) never orphans an in-progress review.
- `reviewed_files` persists per-file "reviewed" state; keyed by path within a
  review (does NOT reset when a file changes in a later commit — known limitation).

## Conventions

- Go: standard library only for HTTP; errors bubble up as JSON via `httpError`.
- Frontend: strict TS (`noUnusedLocals`/`noUnusedParameters` on) — no dead code.
  Match the existing component style; keep CSS in `web/src/styles.css` (no CSS-in-JS).
- Persisted UI prefs (panel widths) go in `localStorage` under `lr.*` keys.

## Gotchas

- **Build the frontend before `go build`** — `//go:embed all:web/dist` fails to
  compile if `web/dist` is empty. A tracked `web/dist/.gitkeep` keeps it
  compilable on a fresh clone; a Vite plugin (`preserveGitkeep`) recreates it
  after each build since `emptyOutDir` wipes the folder.
- `web/dist` bundle and `local-review.db*` are gitignored; don't commit them.
- Changing the markdown output? `internal/export` is the single canonical
  formatter — the frontend never generates markdown.
```
