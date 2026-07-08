# local-review

A local, single-user tool for reviewing a git branch, leaving line/range comments,
and exporting the review as markdown to hand to a coding agent. Go backend + React
frontend, shipped as a single binary. See [SPEC.md](SPEC.md) for the design.

## Build

The React app builds into `web/dist`, which the Go binary embeds — so build the
frontend first, then the binary:

```sh
# 1. frontend
cd web
npm install
npm run build
cd ..

# 2. single binary (embeds web/dist)
go build -o local-review .
```

## Run

```sh
./local-review -repo /path/to/your/repo
```

Opens `http://127.0.0.1:7777` in your browser. Pick a head branch (base defaults to
the merge-base with `main`/`master`), review the diff, click line numbers to comment
(shift-click to extend a range), then **Export** to preview, copy, or download the
markdown.

The SQLite DB lives next to the binary (`local-review.db`), so one install serves
many repos; draft reviews are pruned after `-retention-days` (default 30).

### Flags

| flag | default | purpose |
|------|---------|---------|
| `-repo` | `.` | repository to review |
| `-port` | `7777` | listen port |
| `-retention-days` | `30` | prune draft reviews older than this on startup |
| `-no-open` | `false` | don't auto-open the browser |

## Develop

Run the Go server and the Vite dev server side by side (Vite proxies `/api` to `:7777`):

```sh
./local-review -repo /path/to/repo -no-open   # terminal 1
cd web && npm run dev                          # terminal 2 → http://localhost:5173
```
