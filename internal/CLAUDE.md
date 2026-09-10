# internal/ — the Go backend

Standard-library HTTP, SQLite via `modernc.org/sqlite`, git by shelling out. Root-level
notes (commands, cross-cutting rules, gotchas) are in the repo's `CLAUDE.md`.

## Layout

```
git/git.go              branches (ordered), merge-base, recent commits, diff parser (committed / working-tree /
                        index), file content (ref / worktree / index), BatchObjects, worktree fingerprint
store/store.go          SQLite (WAL): reviews, comments, replies, reviewed_files; migrate()
store/side.go           Side ↔ the two boolean columns — the only place that mapping exists
api/api.go              Server, repoFor (root-confined, symlink/traversal-safe), listRepos, route table
api/handlers_git.go     read-only: repos, branches, diff, files, commits, file, blob (+ mergeBase/resolveBase)
api/handlers_reviews.go create/resume, read, reset, delete, summary, reviewed marks, export
api/handlers_comments.go comments + replies
api/respond.go          decodeBody, pathID, writeJSON, httpError, storeError, notify
api/validate.go         validRef, validPath, validBody, validCommentType
api/side.go             readSide (the one side → git-read map), sideOf (the one wire validator)
api/annotate.go         live anchor status (diff tracking / snippet match), snippet capture, content + diff caches
api/reviewed.go         re-hashes reviewed files, drops marks whose content changed
api/origin.go           WithSameOrigin browser-write guard        api/logging.go  WithErrorLogging (Flush passes through for SSE)
api/events.go           in-memory SSE hub                          api/watch.go    per-review filesystem poller
export/export.go        review → canonical markdown
```

## Conventions

- Errors bubble up as JSON via `httpError`; a handler that returns a list initializes the slice so
  it marshals as `[]`.
- Run `gofmt` on changed files before committing. Tests use throwaway repos under `t.TempDir()`.

## Repos and refs

- Root-scoped, multi-repo: git-reading calls and review creation take a `repo` param (one path
  segment). `repoFor` resolves symlinks on **both** sides before comparing, so a symlink dropped in
  the root can't point at a repo outside it. Review/comment/export endpoints work off `review_id`.
- Repo picker order (`listRepos`/`repoActivityDate`): the mtime of `.git/logs/HEAD` (one stat,
  covers checkouts and pulls), falling back to `.git` itself, by calendar **date** then name — never
  by timestamp, or two repos you alternate between swap all day. `lastActivity` is `YYYY-MM-DD`.
  `TestListReposOrder`.
- Branch pickers (`sortBranches`/`branchGroup`/`branchRank`): locals before remotes, pinned trunks
  (`main`/`master`/`develop`/`development`/`dev`/`staging`) first, then by tip date **grouped by
  prefix** (everything before the first `/`; the group sits at its newest member's date). A remote's
  leading name is neither its prefix nor part of its rank, so `origin/main` heads the remotes. The
  `--format` separator is a literal `\x1f` byte — `git branch` prints `%x1f` verbatim, `git log`
  expands it. `TestSortBranches`, `TestBranchRank`, `TestListBranchesOrderedByActivity`.
- Diff base defaults to the main-branch **name** (stored on the review); handlers resolve
  `merge-base(base, head)` at query time. `MainBranch()` prefers local `main`/`master`, then
  `origin/HEAD` / `origin/main` / `origin/master`, else `""` (create/diff then require a base). A
  base that no longer resolves falls back to auto via `resolveBase` (shared by diff, commits,
  create-review). No common ancestor → `git.ErrNoMergeBase` → 400 naming both ends; anything else
  from `merge-base` stays a 500 with git's message.
- `/api/diff` takes `from` + `uncommitted` + `unstaged`. `from=all` (or empty) → merge-base; a sha →
  `ParentSHA(sha)`, so the picked commit's own changes are **included**. `ParentSHA` takes the first
  parent via `rev-list --parents -n 1`, which is what tells a root commit (→ `EmptyTreeSHA`) from an
  unresolvable ref. `uncommitted` → working tree (`unstaged`, includes untracked) or index
  (`--cached`, staged only). The response `base` is the resolved before ref. `GET /api/commits` is
  `git log base..head`.
- `parseDiff` flags binaries (`Binary`), including untracked ones. Renames pair via `--find-renames`.

## Reads that must not fail loudly or wrongly

- **Absence is 404, never 500.** `git.ErrNotFound` marks a missing path or ref; the reads confirm it
  with `git cat-file -e`, never by matching stderr (wording varies by version and locale).
  `FileContent`/`IndexFile`/`WorktreeFile` wrap it.
- A ref read that fails with **exactly** `ErrNotFound` falls back to the on-disk copy and the
  handler reports `worktree` as the side content came from — a broader catch would serve working-tree
  text against ref-computed hunks with no visible cause.
- Paths that can't name a repo file (absolute, `..`, `.git` in any case) are a 400 from `validPath`,
  run before any side is read. `git.WorktreeFile` keeps its own equivalent guard.
- `/api/blob` shares `/api/file`'s side resolution and fallback; it serves raw bytes with an image
  `Content-Type`.

## The write guard (`origin.go`)

Binding to loopback keeps the network out, not the browser: any page can POST a plain
auto-submitting form to 127.0.0.1 with no preflight. `WithSameOrigin` 403s every non-read request
whose origin isn't this page. Three rules: reads (GET/HEAD/OPTIONS) are exempt, so the SSE stream,
`<img>` blob loads and assets work; `Sec-Fetch-Site` is checked **before** `Origin`, which is what
makes the Vite dev proxy work (its forwarded `Origin` never matches `Host`), and an unrecognized
value must not read as "absent"; neither header present means no browser — curl — and is allowed.
`same-site` is refused (another port on localhost). `origin_test.go`.

## Review model

- Reviews resume by `(repo_path, base_ref, head_ref)` regardless of status, so exporting never
  orphans one.
- **The server captures the snippet** (`captureSnippet` in `annotate.go`, reading via `readSide`):
  clients send only the line range, so the stored text always matches the file. Line-0 file comments
  keep an empty snippet. Each comment records the `commit_sha` it was anchored at (best-effort).
  A `PATCH` re-captures **only when its range differs from the stored one** — the browser resends the
  stored lines when saving a body edit, so re-capturing unconditionally would re-anchor a moved
  comment to whatever now occupies its old lines and erase its staleness.
- `Side` rules (`side_test.go`): `api/side.go`'s `readSide` is the **only** side → git-read map, so
  capture and the staleness check can't read different sides; `sideOf` is the **only** wire
  validator, so no endpoint can skip it; test `Side.IsHead()`, never `== SideHead` — the zero value
  is `""`, and an equality test demotes a Go-built `Comment` to snippet matching.
- **Staleness is derived on every read** (`GetReview`, `CreateReview`, `Export`, add/update-comment):
  `anchorStatus` ∈ `current` | `moved` | `outdated`, plus `currentStartLine`/`currentEndLine`/
  `currentFilePath`, all `omitempty` and computed only in the API layer. Head-anchored comments with a
  `commit_sha` use `annotateByDiff`: diff that commit against head and map the range through the
  hunks (`git.MapOldLine`) — contiguous survival is `current`/`moved`, any deleted line is
  `outdated`; renames relocate to the new path. Worktree/index comments, no-sha comments and
  binaries fall back to snippet matching on their own side (unique match elsewhere → `moved`).
- **A review read must not spawn a git process per file** — it runs on every mutation in every tab
  plus every poller tick. `git.BatchObjects` reads many `<ref>:<path>` through one `cat-file
  --batch`, taking payloads by the header's byte count and correlating records by **position**
  (a found record reports the oid, not the spec); trees and oddities fall through to single reads.
  A terminator is told by the header's trailing `missing`/`ambiguous`, never by its field count —
  git echoes the spec back first, so a path with a space reads like a found record's three fields.
  A header the parser still can't read fails the **whole** batch: `warm` records an unanswered spec
  as genuinely absent, so a partial map would report live files as deleted.
  One `contentCache` keyed by `(side, path)`, warmed per side by `warmCache`, serves both staleness
  and reviewed-file hashing. Diff tracking is two-tier: path-scoped `git diff <sha> head -- <path>`,
  escalating to whole-tree find-renames only when the file reads as deleted (a pathspec reports a
  rename as a deletion); when several comments share a sha the whole-tree diff is read once instead.
  A cold or failed batch still reads per file, so correctness never rests on the batch parser.
  `annotate_test.go` asserts the scoped and whole-tree branches agree on renames, deletions, shifts
  and interior edits.
- **An unreadable repo is not a stale review.** `annotationBlocker` probes `isGitRepo` and whether
  `head_ref` resolves; on failure it sets `review.annotationError` and annotates nothing, so the
  stored state stands instead of reading as universally stale at HTTP 200.
- `reviewed_files` stores a SHA-256 fingerprint of the new-side content plus the `Side`. Every read
  re-hashes and drops marks whose content changed. An unreadable side at mark time (a reviewed
  deletion) stores `absentContentHash`, which holds only while the file stays unreadable; an empty
  fingerprint is a legacy row and always holds. `SetFilesReviewed` upserts a whole batch in one
  transaction with one ping; the API always takes a `filePaths` array.
- `summary` is review-level free text (`POST /api/reviews/{id}/summary`, trimmed). Rendered as
  `**Summary**`, not `## Summary`, since files own h2. `SetReviewSummary` reports a missing review
  via `RowsAffected` — blank is the legitimate way to clear. `ResetReview` clears it too.
- Threads are two levels: `replies` (body + timestamps; anchor and `type` stay on the root)
  cascade-delete with their comment, which cascades from its review. `foreign_keys` is in the DSN
  because it's per-connection; a single connection serializes access.
- `resolved` is a root flag (`POST /api/comments/{id}/resolved`), excluded from export.
  **`SetCommentResolved` deliberately does not bump `updated_at`** — that column drives the
  `(edited)` marker.
- New columns: one row in `store.migrate`'s `added` table (via the idempotent `ensureColumn`)
  **and** the `CREATE TABLE`. `author` columns default to `'reviewer'` so old rows backfill.
- Column-list consts pair with `scan*` helpers: the SELECT order and Scan order must move together.
- `GET /api/reviews/{id}/comments?author=` returns the same live annotation as `GetReview`,
  filtered to one root author — the read side for a review agent. Pure API-layer filter; `[]` when
  empty.

## Export

One rendering (`renderExport`) served two ways: `POST …/export` returns JSON (the browser needs the
filename beside the markdown) and `…/export.md` returns the markdown as the body (an agent needs
no `jq`). Same status transition; errors stay JSON on both. `export_test.go` pins the equivalence.
The `.md` shape carries the filename in `Content-Disposition`, so `sanitize` also drops `"` and `\`.
`?instructions=true` appends agent reply instructions (a curl against `/api/comments/{id}/replies`
using the request's `Host`). Resolved threads are excluded; a rename-moved comment files under its
new path.

## Live sync

- `GET /api/reviews/{id}/events` streams typed pings: `data: meta` (comment/reply/reviewed, via
  `notify`) or `data: diff` (content moved). `publish(reviewID, diff bool)`. `diff` upgrades a
  coalesced `meta`: a per-subscriber `atomic.Bool diffPending` rides beside the coalescing wakeup
  channel and the handler clears it with `Swap`. Sends are non-blocking, so a stalled tab never
  blocks a handler; empty entries prune on last unsubscribe; a 25s keepalive comment turns a
  half-open connection into a write error.
- `watch.go` runs one poller per review while it has subscribers (ref-counted), ticking every
  `watchInterval` (~1.5s) over `git.WorktreeFingerprint` and publishing `diff` on change. The
  fingerprint is content-free (HEAD sha + change set + mtimes). A git error is no-change; the
  baseline is seeded on the first tick so connecting never self-fires. Its git commands run with
  `GIT_OPTIONAL_LOCKS=0` (`git.runEnv`) so they never take `index.lock` under a concurrent commit.
