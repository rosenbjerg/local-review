# CLAUDE.md

Guidance for working in this repo. `README.md` has user-facing usage. The two halves have
their own notes: `internal/CLAUDE.md` (Go backend) and `web/CLAUDE.md` (React frontend).

## What this is

A local, single-user git review tool: review a branch's diff, leave line/range
comments, mark files reviewed, export the review as markdown for a coding agent.
Go backend + React frontend, shipped as one binary (`web/dist` is `go:embed`ded).

## Commands

```sh
./start.sh <root-path> [flags]        # build frontend + binary, serve repos under root

bun install --cwd web
bun run --cwd web build               # → web/dist (must precede go build)
go build -o local-review .
./local-review -root <folder>         # http://127.0.0.1:7777; -port -data-dir -no-open -retention-days

./local-review -root <folder> -no-open && bun run --cwd web dev   # hot reload on :5173, /api proxied to :7777
bun scripts/screenshot.ts             # regenerate docs/screenshot.png (--no-build, --keep)
```

Checks: `go build ./...`, `go vet ./...`, `go test ./...`, `bun run --cwd web build`
(runs `tsc`), `bun run --cwd web lint`, `bun run --cwd web test` (vitest, jsdom).
There is no browser automation: verify backend changes with `curl` against a
throwaway repo, UI behavior manually.

In CI `./...` walks `web/node_modules` (a dependency vendors a Go package), so
`.github/workflows/ci.yml` uses `go list ./... | grep -v /web/node_modules/` and
gofmt-checks `git ls-files '*.go'`.

## Layout

```
main.go                 server: embeds web/dist, DB path, draft pruning, error logging → same-origin guard,
                        graceful shutdown, opens the browser
internal/               Go backend — git service, SQLite store, HTTP API, markdown export (see internal/CLAUDE.md)
web/                    React frontend, built with bun + Vite into web/dist (see web/CLAUDE.md)
scripts/screenshot.ts   fixture repo → seeded review → headless capture of docs/screenshot.png
```

## Cross-cutting rules

- **Backend is source of truth** for review state; the frontend caches it and mutates via the
  API. Discrete actions save immediately; SSE pings tell every tab to refetch.
- **The anchor side is one three-valued `Side`** (`head` | `worktree` | `index`) on the wire
  (`"side"` on add-comment and set-reviewed, `?side=` on `/api/file` and `/api/blob`) and in both
  codebases. It becomes two boolean columns only inside `internal/store/side.go`.
- **A list the API returns is `[]`, never `null`** — initialize slices in Go **and** normalize on
  ingest in `useReview`. A `null` once reached `branches` state and, being remembered in `lr.repo`,
  killed every reload until localStorage was cleared by hand.
- **Absence is 404, never 500.** A comment can outlive its file, so `/api/file` and `/api/blob`
  answer `"<path> does not exist in <side>"` and the frontend renders a note, not a blank card.
- **Comment staleness and reviewed marks are derived, never persisted.** Every review read
  recomputes `anchorStatus` and re-hashes reviewed files; the stored values are the original anchor.
- **Markdown output comes only from `internal/export`.** The frontend renders it, never generates it.
- **Authors are open-ended strings**: `reviewer` (browser), `agent` (API default), one
  `<focus>-review-agent` per review focus. Identity tests are reviewer vs not-reviewer, never a list
  of agent names.

## Server lifecycle (`main.go`)

- Every request context derives from a `baseCtx` cancelled on SIGINT/SIGTERM **before**
  `srv.Shutdown`, or open SSE streams block shutdown past the WAL checkpoint.
  `ReadTimeout`/`WriteTimeout` are deliberately unset; `ReadHeaderTimeout` is set.
- The listener binds before the browser opens, so a port-in-use failure aborts instead of opening a
  tab at nothing.
- `WithSameOrigin` is wrapped inside `WithErrorLogging`, so a refused write logs like any 4xx.
- `-retention-days <= 0` disables draft pruning (a non-positive cutoff would wipe everything).
- DB lives in `~/.local-review/` by default; `-data-dir` overrides (`~` expanded, relative made
  absolute). One DB serves many repos, keyed by absolute path.

## Screenshots

`scripts/screenshot.ts` clones this repo at `FIXTURE_SHA`, resets `main` to its parent, seeds a
review through the API, and captures headless Chromium. Rules: never port 7777 or the default data
dir, and abort unless `GET /api/repos` returns exactly the fixture repo; omit `base` when seeding so
the browser resumes the same review; emulate dark rather than storing it; wait on Shiki's token
count settling, not a delay; frame by scroll → assert Changed view → centre the thread, in that
order. After changing the fixture or comments, run `--keep` and read the snippets back.

## Gotchas

- **Never test against port 7777 or the default data dir.** A real instance is usually running
  there; a test server fails to bind and every request silently hits the live one. A reset probe once
  wiped a real review. Use `-port <unusual> -data-dir <tmp>` and confirm `GET /api/repos` returns your
  fixture before any write. Only the Vite proxy hardcodes 7777.
- Build the frontend before `go build`; `web/dist/.gitkeep` keeps a fresh clone compilable and the
  `preserveGitkeep` plugin recreates it. `web/dist` and `local-review.db*` are gitignored.
- Go's build cache has embedded a stale `web/dist`; `rm` the binary and rebuild. `start.sh` is the
  reliable path.
- The toolchain is bun (`bun install`, `web/bun.lock`, `--frozen-lockfile` in CI). See `web/CLAUDE.md`
  for why `web/bunfig.toml` must stay.
