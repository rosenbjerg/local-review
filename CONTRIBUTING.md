# Contributing

Thanks for your interest in local-review. It's a small, focused project — a
local, single-user git review tool shipped as one binary (Go backend + React
frontend embedded via `go:embed`). This guide covers how to build it, the dev
loop, and the conventions to match.

## Scope

Please keep the [non-goals](SPEC.md#non-goals-for-now) in mind before starting a
large change: no multi-user/collaboration/auth, no cross-machine sync or remote
hosting, no posting reviews back to GitHub/GitLab. Changes that fit the local,
single-user model are the most likely to be merged. For anything non-trivial,
open an issue first so we can agree on the approach.

## Prerequisites

- **Go** — the version in [`go.mod`](go.mod) (or newer).
- **Node.js 22+** and npm (for the frontend).
- **git** — the backend shells out to the real `git` binary.

## Build

> **The frontend must be built before the binary.** `main.go` embeds `web/dist`
> via `//go:embed all:web/dist`; if that folder is empty, the Go build fails.

The one-shot script builds the frontend, embeds it, and runs the server:

```sh
./start.sh <folder-of-git-repos>          # e.g. ./start.sh ~/code
```

Or manually:

```sh
npm --prefix web install
npm --prefix web run build        # → web/dist (embedded)
go build -o local-review .
./local-review -root <folder-of-git-repos>
```

## Dev loop (hot reload)

Run the Go server and the Vite dev server side by side — Vite proxies `/api` to
`:7777`:

```sh
./local-review -root <folder-of-git-repos> -no-open   # terminal 1
npm --prefix web run dev                              # terminal 2 → :5173
```

## Checks before you push

```sh
go build ./...
go vet ./...
go test ./...
npm --prefix web run build        # runs tsc; strict TS must pass
```

The release pipeline runs `go test ./...` and won't tag a release if it fails,
so make sure tests pass locally. There's no browser automation here — verify
backend changes with `curl` against a throwaway git repo, and pure frontend
logic with a standalone node script.

## Conventions

- **Go:** standard library only for HTTP; errors bubble up as JSON via
  `httpError`. The backend is the source of truth for review state.
- **Frontend:** strict TypeScript (`noUnusedLocals` / `noUnusedParameters` are
  on — no dead code). Match the existing component style; keep CSS in
  `web/src/styles.css` (no CSS-in-JS). Persisted UI prefs go in `localStorage`
  under `lr.*` keys.
- **Markdown export** is generated in exactly one place — `internal/export`. The
  frontend only *renders* a preview; it never produces the markdown. Change the
  output there.
- **Commits:** small and focused, with an imperative subject and a body
  explaining the *why*. Prefer several small commits over one sweeping one.

There's more architectural detail — how comments anchor and stay drift-resistant,
how staleness is derived, the SSE multi-tab sync, syntax highlighting — in
[`CLAUDE.md`](CLAUDE.md) and [`SPEC.md`](SPEC.md). Skim them before a deep change.

## Pull requests

- Keep the PR focused on one thing; describe the motivation, not just the diff.
- Confirm the checks above pass and note anything you couldn't verify.
- By contributing, you agree your contributions are licensed under the project's
  [GPL-3.0](LICENSE) license.
