# CLAUDE.md

Guidance for working in this repo. See `README.md` for user-facing usage.

## What this is

A local, single-user git review tool: review a branch's diff, leave line/range
comments, mark files reviewed, and export the review as markdown for a coding
agent. Go backend + React frontend, shipped as **one binary** (the built
frontend is embedded via `go:embed`).

## Commands

```sh
./start.sh <root-path> [flags]   # build frontend + binary, serve repos under root
```

Manual equivalent (frontend MUST be built before the binary — see Gotchas):

```sh
bun install --cwd web
bun run --cwd web build           # → web/dist (embedded)
go build -o local-review .
./local-review -root <folder>      # serves http://127.0.0.1:7777
# other flags: -port, -data-dir, -no-open, -retention-days

# frontend dev with hot reload (Vite proxies /api → :7777):
./local-review -root <folder> -no-open   # terminal 1
bun run --cwd web dev                    # terminal 2 → :5173

# regenerate docs/screenshot.png (README hero shot):
bun scripts/screenshot.ts                # --no-build to skip the rebuild, --keep to seed only
```

Checks: `go build ./...`, `go vet ./...`, `go test ./...`, `bun run --cwd web build`
(runs `tsc`),
`bun run --cwd web lint` (ESLint: rules-of-hooks + React Compiler rule; see `COMPILER.md`),
`bun run --cwd web test` (vitest; jsdom + Testing Library — `web/vitest.config.ts`,
`web/vitest.setup.ts`). Frontend hook logic (the `useReview` selection/refetch races)
is tested via `renderHook` with a mocked `api`; test files are excluded from the build
tsconfig and lint. There is no browser automation here — verify backend changes with
`curl` against a throwaway git repo; verify pure UI/DOM behavior manually.

**`./...` is wrong in CI**, though it's fine locally: it walks `web/node_modules`,
where an ESLint dependency (`flatted`) vendors a Go package of its own — twice over
under bun, which keeps a second copy in `node_modules/.cache`, both inside that tree.
`.github/workflows/ci.yml`
resolves the package list once as `GOPKGS=$(go list ./... | grep -v /web/node_modules/)`
and gofmt-checks `git ls-files '*.go'` — otherwise a dependency bump could fail our
gofmt gate on a file we don't own.

## Layout

```
main.go                  server: embeds web/dist, resolves DB path, prunes drafts, wraps the mux (error logging → same-origin guard), graceful shutdown, opens browser
scripts/screenshot.ts    regenerates docs/screenshot.png: fixture repo → seeded review → headless capture (see Screenshots below)
internal/git/git.go      git service (shells out to `git`): branches, merge-base, recent commits, diff parser (committed-range / working-tree / index variants), file content (ref/worktree/index), worktree fingerprint
internal/store/store.go  SQLite (modernc.org/sqlite, WAL): reviews, comments, replies, reviewed_files
internal/api/api.go      Server, repo resolution (repoFor: root-confined, symlink- and traversal-safe), route table
internal/api/handlers_git.go       read-only git endpoints: repos, branches, diff, files, commits, file, blob (+ mergeBase/resolveBase helpers)
internal/api/handlers_reviews.go   create/resume, read, reset, delete, summary, reviewed marks, export
internal/api/handlers_comments.go  comments + replies
internal/api/respond.go            decodeBody / pathID / writeJSON / httpError / storeError / notify
internal/api/validate.go           what the API refuses: validRef / validPath / validBody / validCommentType
internal/api/side.go               the anchor side: readSide (the one side→git-read map), sideLabel, sideOf
internal/api/annotate.go           live anchor status (diff tracking / snippet match), snippet capture, the batched content + diff caches
internal/api/reviewed.go           re-hashes reviewed files, dropping marks whose content moved
internal/api/origin.go             WithSameOrigin: the browser-write guard (Sec-Fetch-Site, then Origin)
internal/api/logging.go            WithErrorLogging: logs every 4xx/5xx with its body (Flush passes through, for SSE)
internal/api/events.go   in-memory SSE hub: per-review subscriber channels, publish/prune
internal/api/watch.go    per-review filesystem poller: fingerprints the repo while subscribed, pings on out-of-band change
internal/export/export.go  renders a review → canonical markdown
web/src/
  App.tsx                composition root: wires the hooks below, owns the pure view state
                         (selected/opened files, modal flags, comment sort + filter), derives
                         allFiles / sortedComments / commentsByPath, renders the 3-column layout
  useReview.ts           the review data layer: repo/branch/diff-scope selection, create + resume,
                         the diff and SSE refetches (and the reqSeq stale-response guard),
                         reviewed marks, summary
  useCommentActions.ts   comment/reply CRUD as optimistic mutations; identity-stable handlers
  useJump.ts             comment/file navigation: activeComment, the expand signals, jumpTo
  useActiveFile.ts       scroll-spy over the diff column (which file you're reading) + suppress()
  usePanelResize.ts      the two panel widths; a drag writes grid-template-columns via ref
  useKeyboardShortcuts.ts  the one window keydown listener behind every single-key shortcut
  api.ts                 fetch wrappers    types.ts  shared types    util.ts  clamp
  highlight.ts           Shiki wrapper: all languages, lazy-loaded, JS regex engine
  mermaid.ts             ```mermaid fences → SVG; lazy-loaded, runs after highlighting
  time.ts                relative/absolute timestamp + edited-marker helpers
  commentSort.ts         the comments-pane sort orders (file / started / activity)
  commentFilter.ts       the comments-pane filters (status / type / author / free-text
                         search) + the authors present
  commentTurn.ts         whose move a thread is waiting on (who spoke last) + the awaiting-you count
  commentsByPath.ts      group comments per file card + the by-value compare its memo uses
  commentRef.ts          the markdown-it rule that turns `#<id>` into a link to that comment
  reviewNav.ts           nextUnreviewed: the file `v` advances to
  wordDiff.ts            intra-line diff: token LCS → changed char ranges + the segment splitter
  hunkGaps.ts            the unchanged regions a hunk view hides: their line ranges + how much is revealed
  diffRows.ts            what the diff table shows, as data: buildRows (source/hunks/reveals → rows)
                         and planRows (rows + comments + selection → shading, thread and
                         composer placement, the file-comment and leftover buckets)
  diffStats.ts           per-file / whole-review added+removed line counts, off the hunks
  occurrences.ts         occurrence matching: term validation, whole-word vs substring, span→text-node mapping
  useOccurrenceHighlight.ts  select a word → light up its other occurrences in that file
  useUnseenActivity.ts   count agent comments/replies that arrived while the tab was hidden
  useCommentRefs.ts      delegated click/hover/focus handling for those `#<id>` links
  useFocusTrap.ts        modal focus hook: focus-in, Tab trap, restore on close
  prompts.ts             the agent prompts (one per review focus) as {{placeholder}}
                         templates + renderPrompt
  storage.ts             typed, error-swallowing localStorage helpers + the lr.* keys
  theme.ts               the theme registry (one entry per theme, naming its Shiki and
                         mermaid themes) + the theme store: the stored preference (a
                         theme, or "system" = GitHub Dark/Light by prefers-color-scheme)
                         and the theme it resolves to; owns <html data-theme>
  themes/darcula.ts      JetBrains Darcula's editor scheme as a hand-written TextMate
                         theme for Shiki (which ships no JetBrains theme)
  themes/newUi.ts        the New UI's Dark and Light schemes, likewise hand-written:
                         one scope map and two color records, since the pair assign
                         the same roles and differ only in their colors
  fonts/                 the bundled woff2 faces + their licences (all SIL OFL 1.1):
                         Inter (UI, roman + italic), Monaspace Neon (code, GitHub
                         themes), JetBrains Mono (code, Darcula) — see the @font-face
                         block at the top of styles.css
  components/
    TopBar.tsx           the repo / head / base breadcrumb (chrome-less pickers, `/`
                         and `→` between), the from picker + the three-way diff-side
                         toggle (Committed / Staged / Working tree),
                         the changed-file count + `+N -M` badge and compareTitle, reload,
                         the review-scoped buttons (agent prompts, export, reset), the
                         theme picker and help
    FileExplorer.tsx     left pane: hierarchical file tree, collapse, reviewed toggle,
                         per-file +/- counts, reviewed-progress bar (the head's bottom edge)
    DiffView.tsx         center: per-file diff — fetches the source, tokenizes, owns the
                         view/selection/reveal state, and draws the rows diffRows.ts
                         planned; Changed/Full toggle, auto-collapse large files
    FileHeader.tsx       the file card's header row: collapse, status + path, +/- counts,
                         comment count, reviewed checkbox, and the per-file view toggles
    MediaView.tsx        before/after image pair (via /api/blob) or the no-preview note; each
                         side falls back to "no longer in <side>" on a 404 it can't read
    LazyFile.tsx         viewport lazy-mount wrapper (IntersectionObserver) + scroll anchor
    FindBar.tsx          occurrence-highlight bar above the diff: term, n-of-N, prev/next
    CommentThread.tsx    a comment thread: root comment (edit/delete) + replies + reply composer
    CommentsPanel.tsx    right pane: cross-file comment overview, sort + filter selects, jump-to
    CommentPreview.tsx   the compact read-only comment (meta + clamped body), shared by the
                         pane and the `#<id>` popover; never linkifies nested refs
    CommentRefPopover.tsx  that popover: positioned from the anchor's rect (flip above,
                         clamp in), pointer-events: none
    ReviewSummary.tsx    the review's free-text summary above the comments pane (view/edit)
    CommentComposer.tsx  type pills (one-click radiogroup, built on the .badge-<type>
                         chips) + body textarea (reused for new/edit; replies hide the type)
    FileComments.tsx     a file's own threads + the "+ Add file comment" control; owns
                         the composer's open state (shared by the diff, media and
                         rendered-markdown views, which each held that flag before)
    MarkdownView.tsx     rendered (as-published) view of a .md file + file-level comments
    ExportModal.tsx      rendered-markdown preview (via Markdown) + Raw toggle + copy/download
    AgentPromptsModal.tsx  the agent prompts in an editable textarea: a group
                         ViewToggle (Address the review / Do a review) over a second
                         row that picks the review focus and names the author it
                         files as, Copy the rendered draft, Reset/Save the shown one
                         per repo
    AddFileModal.tsx     typeahead over the repo's tracked files (GET /api/files), to open a
                         file the branch didn't change and comment on it
    HelpModal.tsx        the keyboard-shortcuts overlay (`?`)
    ResetConfirmModal.tsx  names what a reset would delete, then does it
    Modal.tsx            shared dialog shell: backdrop, focus trap, Escape, dialog aria
    Combobox.tsx         searchable single-select — a native <select> can't filter, which
                         gets unwieldy with many branches
    PaneRail.tsx         the 28px stub a collapsed side pane leaves behind: the
                         reopen button, the pane's name set vertically, its count
    ViewToggle.tsx       data-driven segmented control (Changed/Full, Text/Image,
                         Code/Rendered, Preview/Raw, the diff side); the group's
                         `disabled` is for one valid value left, a per-option one
                         for a value that would do nothing in the current
                         selection (Committed, when the base resolves to head) —
                         and that one carries a `title` saying why
    CopyButton.tsx       clipboard button with idle/ok/fail state (lazy text builder)
    ThemePicker.tsx      the toolbar's theme select; reads and writes the theme store
                         directly, since the theme isn't review state
    ErrorBoundary.tsx    the app's only class component: shows a render-time throw plus a
                         reload and a "clear the lr.* keys" escape hatch
    EmptyState.tsx       the shape every empty state takes: a large faint icon, a
                         one-line statement, a hint saying what to do — and no
                         action button, since the controls they point at are all
                         in the toolbar
    icons.tsx            the inline icon set: one 24-grid, stroked in currentColor,
                         sized by prop — replaces the × ‹ › ↳ ✓ glyphs the chrome
                         was built from (each rendered at whatever weight and
                         baseline the platform font gave it)
    (small shared UI primitives: Chevron, CommentCount, DiffStatBadge, AnchorBadge,
     MetaTimestamps, HighlightMatch — <mark>s a needle in a plain string, shared by
     the explorer's file search and the comments pane's,
     Markdown — markdown-it + async Shiki code-fence highlight, then async mermaid
     render; `softBreaks` picks comment (GFM <br>) vs document (CommonMark)
     newline handling)
```

## Architecture notes

- **Root-scoped, multi-repo.** The server is started with `-root <folder>` and
  serves every git repo directly under it (`GET /api/repos`). Git-reading calls
  (`branches`/`diff`/`file`) and review creation take a `repo` param (a single
  path segment); `api.repoFor` validates it against the root and rejects traversal —
  and resolves both sides' symlinks before comparing, so a symlink dropped in the root
  can't point the tool at a repo outside it (`isGitRepo`'s `os.Stat` follows links).
  Review/comment/export endpoints work off `review_id` (which carries `repo_path`), so
  they need no `repo` param.
- **The repo picker is ordered by activity, to the day** (`listRepos`/
  `repoActivityDate` in `internal/api/api.go`). A repo is dated by the **mtime of its
  `.git/logs/HEAD`** — the reflog is appended on every commit, checkout, merge and
  pull, so it says when the reviewer last worked *in that repo*, and it costs one
  `os.Stat`. Reading the newest committer date across the refs instead would be one
  git process per repo on the endpoint that lists them all, and would still miss
  checkouts and branch switches; the fallbacks are `.git` itself (which is also the
  case where it's a gitlink **file**, for a worktree or submodule, and so has no
  `logs/` beneath it) and then nothing, an undated repo sorting last. The order is
  **the calendar date only, then the name** — never the timestamp: the two repos you
  switch between all day share a date, and a picker whose top entries traded places
  on every commit would be worse than the alphabetical one it replaced. `YYYY-MM-DD`
  is both what the wire carries (`lastActivity`, a date, because it's exactly what
  the order rests on) and what a string compare orders correctly. For the same reason
  the hint the picker shows is day-granular (`relativeDay` in `time.ts`, which parses
  the parts as **local** — `Date("2026-09-02")` is UTC midnight, i.e. the day before
  anywhere west of Greenwich): "2h ago" listed above "5h ago" would read as a broken
  sort when the tie-break is alphabetical. `TestListReposOrder` and `time.test.ts`
  pin both halves.
- **Backend is source of truth** for review state; React caches it and mutates
  via the API. Discrete actions (add/delete/toggle) save immediately.
- **A write must come from this page, or from no browser at all.** Binding to loopback
  keeps the network out, not the browser: every page the user visits can reach
  127.0.0.1, and a plain auto-submitting `<form>` is a CORS "simple request" — no
  preflight, so it lands in the handler. That reaches every POST here, including
  `/reset` (destroys a review and needs no body at all), `/resolved` (quietly drops
  threads from the export) and `/comments` (writes text into an artifact the user then
  hands a coding agent to act on). `api.WithSameOrigin` (`origin.go`, wrapped *inside*
  `WithErrorLogging` in `main.go` so a refusal logs like any other 4xx) answers those
  with a 403. Three rules: **reads are exempt** — GET/HEAD/OPTIONS change nothing, and
  the SSE stream, `/api/blob`'s `<img>` loads and the embedded assets have to work
  regardless of headers; **`Sec-Fetch-Site` is checked before `Origin`**, which is
  load-bearing for `bun run dev` (the browser talks to Vite on :5173, so its forwarded
  `Origin` never matches our `Host`, while `Sec-Fetch-Site` still reads `same-origin`) —
  and a value we fail to recognize must not read as "header absent", hence the
  normalize; **neither header means no browser**, which is allowed, because the
  agent-facing API has to keep working from curl and a non-browser client carries no
  ambient credentials to forge. `same-site` is refused — that's another port on
  localhost, not this app. The guard covers every non-read method, but POST is what it's
  *for*: PATCH/DELETE already force a preflight the attacking page can't get an answer
  to. `origin_test.go` pins it.
- **A list the API returns is `[]`, never `null`.** Go marshals a nil slice as `null`,
  and the client stores what it is given: `{"branches": null}` from a repo with no
  commits threw on `branches.find`, and because the repo selection is remembered in
  `lr.repo`, every reload re-selected that repo and threw again — the app stayed dead
  until localStorage was cleared by hand, and one freshly `git init`ed folder under
  `-root` was enough to trigger it. So initialize the slice (`ListBranches`,
  `listComments`, `listReviewedFiles`, `handleListComments`) **and** normalize on
  ingest (`useReview` does, at all three branch ingest points) — a null must not be
  able to reach state from any source. `ErrorBoundary` is the backstop for the class
  rather than that instance: a render-time throw now shows the message, a reload, and a
  "clear saved settings" escape hatch — the remembered selection being both the
  likeliest thing a crash is tied to and the one thing a plain reload won't undo. And
  `branchesLoaded` is what lets the empty state say "this repo has no commits yet"
  instead of asking for a branch that cannot exist.
- **Comments anchor to the new side** (HEAD path + line) and store a captured
  `snippet` so feedback survives line drift. The **server** captures that snippet
  from the anchored range at add time (`captureSnippet` in `annotate.go`, reading
  the same side the staleness check will — see `readSide`), so every client — the
  browser and API agents alike — sends only the line range; a bogus client-supplied
  snippet can't drift the record and the stored text always matches the file. Line-0
  file comments keep an empty snippet. Each comment also records the
  `commit_sha` it was anchored against (resolved live at add time; best-effort,
  may be empty) — an immutable record of the original position and when it held.
  **The anchor side is one three-valued `store.Side`** — `head` | `worktree` |
  `index` — on the wire (`"side"` on add-comment and set-reviewed; `?side=` on
  `/api/file` and `/api/blob`), in every signature that carries it, and back out to
  the schema's two boolean columns only inside `store/side.go`. It comes from the
  active diff view's `uncommitted`/`unstaged` axes (see below) and drives the
  snippet-capture and staleness sides. Three rules it exists to hold:
  `internal/api/side.go`'s **`readSide` is the only place** a side maps to a git
  read — the capture and the staleness check must read the same side or a comment
  reads as drifted the moment it's written, and that switch was previously written
  out three times; **`sideOf` is the only place** a wire value is validated, so the
  check can't be present on one endpoint and missing on another (it was: add-comment
  refused the impossible "both flags", set-reviewed accepted it); and **test
  `Side.IsHead()`, never `== SideHead`** — the zero value is `""`, so an equality
  test silently demotes any `Comment` built in Go without a side from precise
  diff-tracking to snippet matching. `side_test.go` pins all three.
- **Comment staleness is derived, never persisted.** The stored line numbers are
  the *original* anchor; the branch keeps moving, so `internal/api/annotate.go`
  recomputes a live `anchorStatus` (`current` | `moved` | `outdated`) on every
  review read (`handleGetReview`, `handleCreateReview`, `handleExport`, and the
  add-comment response). **Primary method: precise line tracking via git.** For a
  committed comment with a `commit_sha`, `annotateByDiff` diffs that commit against
  head (see the read strategy below for *which* diff) and maps the original range
  through the matched file's hunks (`git.MapOldLine`): every line
  surviving contiguously → `current` (same position) or `moved` (shifted, with
  derived `currentStartLine`/`currentEndLine`); any line deleted/modified →
  `outdated`. **Renames are followed:** when the matched file is a rename, the move
  relocates to the new path — `moved` with `currentFilePath` set (a pure R100 rename
  carries no hunks, so lines map 1:1) — while a rename whose anchored block was also
  edited still falls to `outdated` via the same contiguity check. This beats snippet
  matching, which can't tell a real move from a coincidental reappearance of the same
  lines. Diff-tracking is head-anchored only — worktree/index comments always
  snippet-match, since their side has no commit to diff against.
  **Fallback: snippet matching** — used for worktree/index comments, comments
  without a `commit_sha`, and binary files — compares the captured `snippet`
  against the current file on the comment's own side (`readSide`): match at the stored
  range → `current`; a unique match elsewhere → `moved`; gone/ambiguous/unreadable →
  `outdated`.
  The frontend renders the effective (relocated) line **and path** — a rename-moved
  comment groups/renders under its `currentFilePath` (see `effectivePath` in
  `types.ts` and `export.go`) and badges "moved from `<old>`"; the export files it
  under the new path too. `anchorStatus`/`currentStartLine`/`currentEndLine`/
  `currentFilePath` are computed on `store.Comment` in the API layer with
  `omitempty` — the store never reads or writes them.
- **A review read must not spawn a git process per file.** It runs on every
  comment/reply/reviewed mutation, in every open tab, plus every tick of the ~1.5s
  filesystem poller — i.e. continuously while an agent works, which is exactly when a
  review is large (measured at 60 comments + 60 reviewed files: 0.95s per read, nearly
  all of it process spawn). Three things keep it flat, all of them removing *spawns*
  rather than work. **`git.BatchObjects`** reads many `<ref>:<path>` objects through one
  `cat-file --batch`: payloads are taken by the byte count in each record header and
  never by scanning for a delimiter (file content can hold newlines, NULs, or something
  shaped exactly like a header), and records are correlated to inputs **by position**,
  since a found record reports the resolved oid rather than echoing the spec; trees and
  anything odd fall through to the single-object path that produced the old answer.
  **One `contentCache`**, keyed by `(side, path)` and warmed per side by `warmCache`
  before either half runs, serves *both* halves — comment staleness and reviewed-file
  fingerprints want the same files from the same sides and used to read them twice over.
  And **diff tracking is two-tier**: a cheap path-scoped `git diff <sha> head -- <path>`,
  escalating to the whole-tree find-renames diff only when the file reads as deleted
  (the pathspec reports a rename as a bare deletion, so the escalation is what tells a
  real deletion from a rename to follow) — except where **several** comments share one
  sha, where the whole-tree diff is read directly instead: one process, cached per sha,
  and it pairs renames itself. The batch's failure mode is what makes all of this safe:
  a cold or failed batch still reads per file, so correctness never rests on the batch
  parser. `annotate_test.go` asserts the scoped and whole-tree branches **agree** on
  renames, deletions, shifts and interior edits — that equivalence is the thing that
  could silently rot.
- **An unreadable repo is not a stale review.** Both halves of a review read infer
  staleness from a *failed* read — a comment whose side won't open is `outdated`, a
  reviewed file whose content won't hash reverts to unread — and that inference only
  holds while the repo itself is readable. Move or rename the repo directory (an
  ordinary thing to do), or delete the branch, or leave a rebase in flight, and every
  per-file read fails at once: the reviewer would be shown a review where every comment
  is stale and nothing is reviewed, at HTTP 200, with nothing saying why. So
  `annotationBlocker` probes those two conditions first (`isGitRepo`, then does
  `head_ref` resolve) and on either sets `review.annotationError` and annotates
  **nothing** — the stored state stands, and a banner says it isn't being checked.
- **A review carries a free-text `summary`** — the framing a pile of line comments
  can't give ("the auth refactor is fine, but the error handling needs a
  rethink"). Set via `POST /api/reviews/{id}/summary` (trimmed server-side, and
  again in `useReview.setSummary` so the optimistic value matches what a refetch
  returns), edited in `ReviewSummary.tsx` above the comments pane, and rendered by
  `export.Render` **above the counts and every file section**. It is deliberately
  labelled `**Summary**` rather than `## Summary`: files own the h2 level, so a
  heading there would read as a file named Summary to anything parsing the
  artifact by section. `SetReviewSummary` reports a missing review through
  `RowsAffected`, not through the text being blank — an empty summary is the
  legitimate way to clear one, which is also why the editor has no non-empty
  guard. **`ResetReview` clears it** alongside the comments and reviewed marks —
  it's review-level feedback like they are, so leaving it would carry one pass's
  framing into the next; it also counts toward `canReset`, so a review holding
  only a summary is still resettable. `App`'s `hasReviewState` is the single
  predicate behind both `canReset` and `requestReset`'s no-op guard, so the toolbar
  control can't enable a dialog that then declines to do anything.
- **Threads are two levels.** A comment is a thread root; the `replies` table
  holds follow-ups (body + timestamps only — anchor and `type` stay on the root).
  A reply's `comment_id` FK cascade-deletes it with its comment (and the comment
  chain-cascades from its review), so replies never orphan. `GetReview` nests
  `replies` under each comment; reply mutations publish the same SSE ping.
- **A thread can be resolved** — a `resolved` flag on the root comment (toggled
  via `POST /api/comments/{id}/resolved`). Resolved threads are dimmed in the UI
  and **excluded from the export** (the artifact carries only open, actionable
  feedback). The column is backfilled onto older DBs by the `added` table in
  `store.migrate` — one row per post-initial-schema column, applied through the
  idempotent `ensureColumn`; a new column needs a row there *and* an entry in the
  `CREATE TABLE` above, so a fresh DB gets it without the migration.
  **Resolving deliberately does not bump `updated_at`** — that column tracks the
  last body/type edit, which the UI surfaces as an `(edited)` marker (`time.ts`
  `wasEdited`), and resolving isn't an edit (it has its own flag). Keep it that
  way if you touch `SetCommentResolved`, or the marker will fire on resolve.
- **Comments and replies carry an `author`.** The identities the server tells
  apart purely by this field (there's no auth/session): `"reviewer"` — the human,
  tagged explicitly by the browser app (`api.ts`); `"agent"` — the coding agent
  addressing the review, which is the API default so it needn't set it; and one
  **`"<focus>-review-agent"` per review focus** (`correctness`, `security`, `design`,
  `test`), which the matching *Do-a-review* prompt sends on every comment and reply
  so each pass's findings stay distinct from the other passes' and from the coding
  agent's replies to them. The shared `-review-agent` suffix keeps that family
  recognisable in the pane, in the export headings and to a future "any review agent"
  filter; the authors themselves must stay **distinct**, or two focuses collapse into
  one filter choice and one `?author=` poll (`prompts.test.ts` pins both). The
  columns' DDL/migration default is
  `'reviewer'`, so rows created before the field existed backfill as the
  reviewer's. Author shows in the thread meta and in the export heading/reply lines.
- **`GET /api/reviews/{id}/comments`** returns a review's comments as JSON with
  the same live annotation as `GetReview` (anchor status, replies nested), and an
  optional `?author=` narrows to one root author. It's the read side for an
  *adversarial-review* agent: `?author=security-review-agent` gives that focus only
  the threads it started — its own comments plus any reviewer/coding-agent replies —
  without the other focuses' comments, the reviewer's own, or the reviewed-file list. Pure API-layer filter over
  `GetReview`+`annotateReview` (no store/SQL change); empty result is `[]`, not
  null. Distinct from the reply-oriented markdown `export`, which is the
  reviewer→coding-agent artifact.
- **`#<id>` in a comment or reply body links to that comment** (`commentRef.ts`):
  with several identities writing, threads end up referring to one another, and a bare
  "see #42" that isn't clickable makes the reader hunt. Detection is a markdown-it
  **core rule** over text tokens, which is what makes it skip inline code and fenced
  blocks for free; it also skips text already inside a link, so a ref in a markdown
  link or a linkified URL (`…/pr#42`) can't nest `<a>` tags. It is **gated on the
  review's comment ids**, passed as render `env` via `Markdown`'s `commentIds` prop —
  only comment and reply bodies pass it, so stray "issue #42" prose, unknown ids,
  markdown files and the export preview all stay plain. The anchors are `innerHTML`, so
  interaction is one set of **delegated** document listeners (`useCommentRefs`): click →
  `jumpTo`, reusing the pane's highlight/expand/cross-file-mount path rather than a
  second navigation implementation; hover (250ms) or focus (immediate) →
  `CommentRefPopover`, dismissed on leave or on **any** scroll, since a scroll moves the
  anchor out from under the rect the popover was placed against. The popover is
  `pointer-events: none` and shares `CommentPreview` with the comments pane — which
  deliberately does *not* linkify refs, so a preview can't spawn a preview. `App` keys
  the id `Set` on the **joined id list**, not on the comments array: a no-op SSE
  refetch returns structurally equal comments in a fresh array, and a new `Set`
  identity there would re-run markdown-it + Shiki in every thread on every ping.
- **The branch pickers are ordered by last activity, grouped by prefix**
  (`sortBranches`/`branchGroup` in `internal/git/git.go`). Ordering by the tip
  commit's committer date is what puts the branch you were just on near the top of a
  repo with a hundred of them; ordering *flatly* by that date, though, scatters
  `abc/*` through the list, so a prefix (everything before the first `/`) stays
  together and the **group** sits at its newest member's date — the picker still reads
  chronologically without breaking the family up. A slashless branch is its own group,
  so it takes its own place by date. Two things keep their precedence ahead of the
  date: locals before remotes, and the pinned trunks (`main`/`master`/`develop`/
  `development`/`dev`/`staging`) first — a stale trunk is still the base you want
  offered. A remote's leading remote name is neither its prefix (every remote shares
  it) nor part of the name that ranks it: `origin/abc/*` groups as `origin/abc`, and
  `branchRank` matches the name *after* the remote, so `origin/main` and
  `origin/staging` head the remote group the way `main` and `staging` head the locals.
  Without that the base picker — the only picker showing remotes — buried
  `origin/main` under whichever `origin/<feature>` was pushed most recently, which is
  precisely the ref it exists to offer. Each option shows the date it was ordered on
  (`branchHint` in `useReview.ts`), like the comment sorts do — an order the list doesn't explain reads
  as arbitrary. The separator in both format strings is a **literal `\x1f` byte, not
  git's `%x1f` escape**: `git branch --format` prints that escape verbatim (`git log`
  expands it, which is why `RecentCommits` can use it), and the whole listing came
  back empty the one time it was written that way. `git_test.go`'s `TestSortBranches`
  pins the grouping, `TestBranchRank` the remote trunks, and
  `git_shell_test.go`'s `TestListBranchesOrderedByActivity` the parse end to end.
- **Diff base** defaults to the main-branch *name* (stored on the review); the
  `/api/diff` handler resolves it to `merge-base(base, head)` at query time, so
  the review shows only what the branch introduces. `MainBranch()` prefers a
  local `main`/`master`, then falls back to the remote default
  (`origin/HEAD`) / `origin/main` / `origin/master` — so a branch worked off
  `origin/main` with no local trunk still gets an auto base. If nothing
  resolves it returns `""` and create-review/diff ask for an explicit base. A base
  that no longer resolves (a local `main` deleted after checking out a remote branch)
  falls back to that auto default rather than failing with a raw "ambiguous argument"
  from git — `resolveBase`, used by diff, commits and create-review alike. Two refs
  with **no common ancestor** are a bad selection, not a server fault, so
  `git.ErrNoMergeBase` answers **400** with prose naming both ends
  (`mergeBaseStatus`/`mergeBaseError`); anything else from `merge-base` stays a 500
  carrying git's own message. **A base that resolves to head takes the committed
  side away, not the other way round** (`baseIsHead` in `useReview`).
  `merge-base(head, head)` is head, so `git diff head head` is empty whatever the
  repo holds — but the base is not the thing to refuse: on the main branch `auto` has
  nothing else to resolve to, and a single-branch repo has no other base in existence.
  What *is* meaningless is only the committed side; the uncommitted ones still read
  "just my uncommitted work", which on `main` is the whole point of the tool. So
  `effectiveUncommitted` is forced on (like the `headIsCurrent` gate beside it —
  derived, so it never touches the stored pref) and `TopBar` dims **Committed alone**
  with a title saying why. Two corollaries: `baseOptions` offers head only while an
  uncommitted side is showing (plus whatever `base` already holds, or `Combobox`
  renders the control blank), and `changeHead` / the branch-load restore still drop a
  base equal to the *new* head — head may not be checked out there, which would leave
  the committed side forced *and* empty. It's gated on `from === "all"`: a picked
  commit is the before side and the base goes unused, so the committed range is real
  again. `useReview.test.ts` and `topBar.test.tsx` pin all of it.
- **The diff view is two orthogonal axes**, *not* part of review identity —
  the review still resumes by `(repo, base_ref, head_ref)` and comments still anchor
  to whichever side they were added on, regardless of the view on screen. `/api/diff`
  takes `from` + `uncommitted` + `unstaged` and maps them to a `(from → to)` git range:
  - **`from`** sets the *before* side: `all` (or empty) → `merge-base(base, head)`,
    the whole branch (base defaults to the main branch); a commit sha → that commit,
    **inclusive** — `from = ParentSHA(picked)`, so the picked commit's *own* changes
    are part of the diff ("from this commit onwards", which is how a reviewer reads
    the picker, and it makes `from=<the branch's oldest commit>` identical to `all`).
    `ParentSHA` takes the **first** parent (a merge's later parents sit behind it) via
    one `rev-list --parents -n 1`, which is what separates a legitimately parentless
    **root commit** — reported as `git.EmptyTreeSHA`, so its diff is its whole
    content — from a ref that doesn't resolve (a bare `rev-parse <ref>^` fails
    identically for both). The commit list is `GET /api/commits` — `git log
    base..head`, scoped to the branch's own commits (never base-branch history behind
    the merge point) — surfaced in the UI as an always-present "from" picker with
    `All` on top.
  - **`uncommitted`** (bool) sets the *after* side: `false` → `head` (committed
    range, `git diff <from> head`); `true` → the working tree or the git index.
  - **`unstaged`** (bool, default true; only meaningful when `uncommitted`) picks
    which: `true` → working tree (`git diff <from>` + untracked, staged **and**
    unstaged); `false` → git index (`git diff --cached <from>`, no untracked —
    **staged only**). New side = working tree when `unstaged`, else the index.
  The response `base` is the resolved `from` ref (the merge-base, or the picked
  commit's **parent**) — what `/api/blob`'s "before" image uses.
  The `uncommitted` axis is only meaningful when head is the checked-out branch, so
  it's gated on that (the UI disables the whole side toggle otherwise). `useReview`
  holds the `from`/`uncommitted`/`unstaged` state and derives `effectiveUncommitted`
  (`uncommitted && headIsCurrent`) plus the single `side: Side` (`"head"` unless
  uncommitted, then `"worktree"`/`"index"` by `unstaged`) threaded into add-comment /
  set-reviewed / file / blob calls and into `DiffView`/`MediaView` as one prop.
  **The reviewer picks that `Side`, not the two booleans.** The three reachable
  combinations *are* `Side`, so the toolbar is one segmented control over it and
  `useReview.changeSide` is the single place it becomes the two axes the API takes —
  which also makes the pref one write. As two dependent checkboxes (the second only
  appearing once the first was on) it took two clicks to reach the index and a write
  per axis persisted the other axis's pre-update value.
  **`uncommitted`/`unstaged` are remembered per repo** (`lr.diffViewByRepo`, keyed by
  repo alone — they describe how you look at a repo, not at a branch or review);
  `from` stays per-session, since a sha belongs to one head's history. The restore
  happens in the *branch-load* `.then`, in the same update as `head`: the guard above
  clears `uncommitted` whenever head isn't the checked-out branch, and while branches
  are loading it never is. And only the reviewer's own pick writes (`changeSide`) —
  persisting from an effect on the state would let that guard, or the `unstaged`
  reset, erase the stored choice.
- **A file the branch didn't change can still carry comments.** `GET /api/files`
  (the repo's tracked files at head) backs a typeahead (`AddFileModal`), and the chosen
  path becomes a synthetic `unchanged` `FileDiff` in `App`'s `allFiles` — no hunks,
  rendered in Full view, where every line is commentable. The same mechanism derives a
  card from any **comment** whose path isn't in the diff, which is what makes a comment
  an agent filed on a non-changed file visible and jumpable in the browser instead of
  only in the export — and what restores an opened file after a reload, since
  `openedFiles` itself is session state, deliberately not persisted. The backend needed
  nothing: it captures snippets and annotates anchors for any path. Two consequences
  documented below: these cards are excluded from the reviewed-progress denominator
  (they aren't work the branch asked for), and they're why `DiffView`'s `contentKey`
  can't be derived from the hunks alone.
- **The view has to say what it compares.** Four controls (repo/head/base/from plus
  the two checkboxes) can name a range but not explain it, and a reviewer's reflex is
  to check the result against their git client — where a mismatched file count reads
  as a bug in this tool. So `TopBar` states the comparison outright: a **changed-file
  count** next to the `+N -M` badge, and a `compareTitle` tooltip naming **both ends**
  in words (which commit the before side resolved to and why — merge-base with base,
  or the parent of the picked commit *whose own changes are included* — against head /
  working tree / index). **Both counts name the same population:** the topbar counts
  `files` (what the diff changes, the number that matches a git client), and the
  explorer's `N/M reviewed` progress counts only those too — `changedFiles`, i.e.
  `allFiles` minus the synthetic `unchanged` cards for files opened only to comment
  on. Those cards stay listed and markable, but they aren't work the branch asked
  for, so counting them would put a denominator on screen that no git client agrees
  with; the tooltip says how many are excluded. The usual divergences left are honest
  ones the readout now explains: the default before side is the **merge-base**, not
  `HEAD`, so it lists the whole branch where a client's "changed files" lists only
  uncommitted work; renames pair into one file (`--find-renames`); and an untracked
  *directory* lists as its individual files, where `git status` collapses it to one
  entry.
- **A file the diff touched can have no hunks** — a pure rename (`R100`), a mode-only
  change (`chmod +x`), an empty file added or deleted. Changed view builds its rows
  from the hunks, so such a card rendered *blank*: counted in the file list, with
  nothing to show for it. `DiffView`'s `noHunksNote` states which of those it is
  (above the table, alongside the missing/substituted notes, so the fallback rows for
  file-level comments still render). Gated on `mode === "changed"` and `!unchanged`:
  Full view renders the source, and the synthetic card for a file opened only to
  comment on is hunkless by construction and lives in Full view. Covered by
  `web/src/diffView.test.tsx`.
- **DB lives in `~/.local-review/`** by default; override the directory with the
  `-data-dir` flag (a leading `~` is expanded, relative paths are made absolute).
  One DB serves many repos, keyed by abs path.
- **The server has to exit cleanly, and SSE is what makes that awkward.** A stream
  lives as long as its tab, so `main` derives every request context from a `baseCtx`
  and cancels it on SIGINT/SIGTERM *before* `srv.Shutdown`: `handleEvents` waits on
  `r.Context()`, and without the cancel Shutdown would block on the open streams until
  its deadline, leaving the deferred `st.Close()` too late to checkpoint the WAL
  cleanly. For the same reason `ReadHeaderTimeout` is set but `ReadTimeout`/
  `WriteTimeout` are **not** — those would abort streams that legitimately read nothing
  and write for minutes. The listener is bound explicitly before the browser opens, so
  a port-in-use failure aborts instead of opening a tab at a server that isn't there.
  `-retention-days` (default 30) prunes draft reviews older than that on startup;
  `<= 0` disables pruning, since a non-positive cutoff would sit at/after now and wipe
  every draft.
- Reviews resume by `(repo_path, base_ref, head_ref)` regardless of status, so
  exporting (which sets status `exported`) never orphans an in-progress review.
- `reviewed_files` persists per-file "reviewed" state, keyed by path within a
  review. Each mark also captures a **content fingerprint** (SHA-256 of the
  file's new-side content) and the `store.Side` it was seen on, exactly as comments
  record their anchor side.
  Like comment staleness, "still reviewed" is **derived, never trusted from the
  flag alone**: on every review read `internal/api/reviewed.go` re-hashes the
  current content of that side and drops any file whose fingerprint no longer
  matches — so a file that changes after being marked reviewed reverts to unread.
  A file whose side can't be read at mark time (a reviewed **deletion** has no
  new-side content) stores an `absentContentHash` sentinel, not a real hash: it
  holds only while the file stays unreadable and reverts if the file returns —
  so re-adding a deleted-then-reviewed file drops the mark. An empty fingerprint
  is reserved for legacy pre-fingerprint rows and always holds. `SetFilesReviewed`
  upserts (`DO UPDATE`), so re-reviewing a
  changed file refreshes the fingerprint. (Surfaces on the next review refetch,
  which the filesystem poller now triggers ~1.5s after an out-of-band push — see
  Live multi-tab sync — with SSE ping and focus as the other triggers.)
  It writes a whole batch in one transaction with a single change ping, so a
  **folder-level toggle** (mark/unmark every file under a folder) lands atomically.
  The API always takes a `filePaths` array — a single file is just a one-element
  batch.
- **Live multi-tab sync** via SSE: `GET /api/reviews/{id}/events` streams a
  **typed** ping — `data: meta` or `data: diff` — whenever that review changes.
  `publish(reviewID, diff bool)` distinguishes them: metadata-only mutations
  (comment/reply/reviewed-file, via the `notify` helper) send `meta`; changes that
  move file content send `diff`. The client refetches the whole review on either,
  but the **diff only on a `diff` ping** (ping-and-refetch — backend stays source of
  truth, no per-event payloads), so comment churn doesn't re-pull the whole diff
  while an agent's edits or a fresh commit still surface without a manual reload. A
  `diff` ping also refetches the **branch list and commit picker** (the git state
  moved, so an out-of-band checkout must update `headIsCurrent` and new/rebased
  commits must reach the `from` picker; a picked `from` sha that was rebased away
  resets to `all`).
  **That reset needs proof, not absence.** The picker asks for the newest
  `COMMIT_LIMIT` (50) commits of `base..head` — both fetches pass it explicitly — so a
  sha missing from the refetched list is only *gone* when the list is shorter than the
  cap (`fromWasRemoved`). On a longer branch a single new commit slides the window and
  drops the oldest listed commit, which is still perfectly valid to diff from;
  resetting on that silently widened a narrowed review to the whole branch, and pings
  are frequent enough (every commit, plus the ~1.5s poller on any edit) that it landed
  mid-review. The other half is that a kept pick must stay **labelled**: `Combobox`
  renders its value by finding it among the options, so `fromOptions` appends an entry
  for a `from` the list no longer holds — without it the control goes blank while the
  diff is still narrowed to that commit. Covered by `web/src/useReview.test.ts` (both
  the conclusive reset and the window slide). The non-ping commits effect needs no
  such check: the only writers of `base` reset `from` in the same update
  (`changeRepo`/`changeHead`), and the base picker is disabled while a commit is
  picked (`baseRelevant`), so it can't strand a selection.
  `diff` is a superset that **upgrades** a pending `meta`: a per-subscriber
  `atomic.Bool diffPending` rides alongside the coalescing wakeup channel and the
  handler clears it with `Swap`, so a dropped (coalesced) wakeup never loses the
  fact that the diff moved. The refetch params (repo + head/base/from + the resolved
  diff-view opts) come from a ref in `useReview`, since the SSE effect is keyed only
  on `review.id`. **A ping's git-derived results (diff/branches/commits) are gated on
  the shared `reqSeq`** — a view-axis toggle keeps `review.id`, so the effect's
  `cancelled` flag never fires, and an older in-flight ping would otherwise land hunks
  from the side you just left (see *Diff/source consistency* below). The review half
  is deliberately **not** gated: it's fetched by id, so gating it would swallow the
  comment/reviewed updates the ping was sent to deliver. The
  hub (`internal/api/events.go`) is in-memory with non-blocking coalescing sends, so
  a stalled tab never blocks a handler; empty review entries are pruned on the last
  unsubscribe. A 25s keepalive comment keeps the stream warm and turns a half-open
  connection into a write error so it unsubscribes. The frontend keeps a
  focus/visibility refetch as a fallback for the reconnect gap, gated on the stream
  not being `OPEN` — and it passes `diff` (a dead stream may have missed a content
  change).
  **A hidden tab takes the review half of a ping but defers the diff half**
  (`missedDiff`, replayed on the next visible). Taking the review is what feeds the
  unseen-activity badge below — a tab that skipped the fetch entirely would have
  nothing to count. Deferring the diff is the other half of that bargain, and the
  replay is **load-bearing**: the focus fallback stands down while the stream is
  `OPEN`, so a diff dropped here would have nothing left to fetch it and the tab
  would come back showing stale hunks.
  The `diff` pings come not just from commits landing but from a **filesystem
  poller** covering **out-of-band** changes an agent makes without hitting the API —
  editing files or committing. `internal/api/watch.go` runs one poller per review *while it
  has SSE subscribers* (ref-counted, so tabs share it; stops on the last
  disconnect), ticking every `watchInterval` (~1.5s) over
  `git.WorktreeFingerprint` and publishing on change. The fingerprint is
  content-free (HEAD sha + the tracked/untracked change set + those paths' mtimes),
  so it catches commits, new/deleted files, and re-edits without reading file
  content — flat cost even on large diffs. A git error (mid-rebase) is treated as
  no-change; the baseline is seeded on the first tick so connecting never self-fires.
  The fingerprint's git commands run with `GIT_OPTIONAL_LOCKS=0` (via
  `git.runEnv`), so this on-a-timer read never refreshes/writes the index and can't
  make a concurrent agent `commit` fail on `index.lock`.
- **Image & binary files.** `parseDiff` flags binary files (`Binary` on
  `FileDiff`, from git's "Binary files … differ" line; also set for untracked
  binaries). `DiffView` renders raster images (png/jpg/gif/webp/bmp/ico/avif) as
  a **before/after** pair via `GET /api/blob` (raw bytes + image `Content-Type`;
  before = the resolved merge-base `diff.base`, after = head or the working tree);
  non-image binaries show a "no preview" note. **SVGs are a text diff by default**
  with a per-file Text/Image toggle. These media files have no lines, so they take
  **file-level comments anchored at line 0** (empty snippet ⇒ always `current`;
  exported and labelled as `file`, not `L0`). `/api/blob` shares `/api/file`'s
  side resolution (`?side=index` reads `git show :path`) and
  working-tree fallback.
- **A path can outlive its file**, so absence is a **404, never a 500**. A comment
  anchored before a rename or delete keeps asking for the old path (and the frontend
  synthesizes a file card for it), so `/api/file` and `/api/blob` answer 404 —
  `"<path> does not exist in <side>"` — when the path, or the ref itself, is gone
  from the side asked for; only a genuine git/IO failure is a 500. A ref read that
  `git.ErrNotFound` says the ref can't satisfy falls back to the **on-disk copy** —
  a file can exist in the working tree without existing at the ref (an uncommitted
  new file a reviewer commented on). That fallback is gated on `ErrNotFound`
  *precisely*: catching every error would answer a git failure with working-tree
  content against ref-computed hunks, i.e. the wrong-lines mismatch with no visible
  cause. And because a ref read can't promise the ref supplied it, `/api/file`
  returns **`worktree`** — the side the content actually came from, as opposed to the
  echoed `ref` it was asked for. `DiffView` compares the two and notes the
  substitution on the card, so on-disk text is never rendered as the ref's.
  `git.ErrNotFound`
  marks the case, wrapped by `FileContent`/`IndexFile`/`WorktreeFile`; the git reads
  confirm absence with `git cat-file -e` instead of matching stderr, whose wording
  varies by git version and locale. A path that can't name a repo file at all —
  absolute, `..`-escaping, or `.git` in any case variant — is instead a **400** from
  `validPath` (next to `validRef`), which runs before any side is read so the answer
  doesn't depend on which side happened to reject it; `git.WorktreeFile` keeps its
  own equivalent guard for paths reaching it from elsewhere. The frontend's `req`
  throws an `ApiError` carrying the status, and `DiffView` turns a 404 into a
  "No longer in `<side>`" note on the card (falling back out of Rendered view) so
  the stranded comments render against an explanation, not a blank card. `MediaView`'s
  before/after sides can't read that status (they're `<img src>`), so each falls
  back to the same note via `onError`, keyed on src + `file.status` so a view-axis
  toggle or the file reappearing retries the load.
- **Markdown files** (`.md`/`.markdown` with a new side) get a per-file
  **Code/Rendered** toggle, mirroring SVG's Text/Image. Rendered mode swaps the
  diff table for `MarkdownView` — the new-side content run through the shared
  `Markdown` component (`softBreaks={false}`, `.markdown-body`) plus file-level
  (line-0) comments, like the image view. Line-anchored commenting stays in Code
  view; the Changed/Full toggle is hidden while rendered. Default is Code.
- **Syntax highlighting** (`highlight.ts`): Shiki with the **JS regex engine**
  (not oniguruma — avoids a browser wasm-load failure) and one Shiki theme per
  UI theme (see *Themes*), all registered up front since a token's color is
  resolved at tokenize time. All
  ~235 grammars are available, each lazily fetched per file. Extensions resolve
  to language ids via Shiki's own alias metadata (+ a tiny extras map). `DiffView`
  tokenizes the whole file once and renders tokens per line (avoids per-line
  breakage on multi-line constructs); deleted lines are highlighted per-line.
- **A changed row is marked at its edge, not just by its fill.** The hairline that
  divides the gutter from the code carries the row's status — `--border` on a context
  row, `--add-border`/`--del-border` on a changed one — so the eye can find the
  changes in a long hunk without the row fill having to shout. The `+`/`-` sign
  stays **muted grey** on every row: the fill and the bar already say added or
  deleted, and colouring the sign to match made a third mark on the same row that
  read as noise. It stays the **1px** border it recolors — widened to 2px (with an
  inset shadow, since a border-width that differed by row would shift the code column
  a pixel on every add) it read as a stripe down the diff rather than an edge on a
  row. `.sign` is padded on the right only (`0 3px 0 0`) to stand off the code — as
  `content-box`, since the global `border-box` would take the padding out of its
  `1ch` cell rather than adding to it; on its left, `.line-content`'s own padding
  already holds it clear of the bar — and both of that rule's sides are the same
  3px, so one gap size runs the whole row. Every code row renders a sign (a context row's
  is a space), so the shift is uniform. The bar sits on the gutter's
  **right** edge because
  `.row-commented`/`.row-comment-active` own the left one and a row can be both
  commented and changed. `--del-border` is per theme rather than derived from
  `--danger` because Darcula's deletion is deliberately grey.
  The table's `line-height` is a **fixed 19px**, not a ratio: the gutter, the code
  and the smaller-type hunk headers have to share one baseline grid, and a unitless
  line-height would give the 11.5px hunk row a shorter line than the 12.5px code
  beside it.
- **Nothing in the diff table may reset padding on a bare `td`.** `.diff td` is
  specificity (0,1,1) and every cell rule — `.gutter`, `.line-content`,
  `.gap-gutter` — is (0,1,0), so a `padding: 0` there silently beats all of them and
  the gutter and the code run flush against their borders. It did, for a long time,
  and the symptom is invisible in the source: editing `.gutter`'s padding changes
  nothing whatsoever. Cells that want no padding just don't ask for any (a `td` has
  none from the UA stylesheet). The same trap is still live one level down —
  `.thread-row > td { padding: 0 }` voids `.thread-cell`'s padding — left alone only
  because switching it on now would indent every inline thread.
- **A thread is a raised card, and the fill ladder is what draws it.** Nothing in a
  thread has a border: `.thread` is `--bg-elev` + `--elev-1` over the diff, its meta
  band steps up to `--bg-hover`, and a `.reply` is recessed to `--bg` — so every
  edge is a fill change. Three things that ladder is holding up. `.thread-cell` is
  bare padding, because banding the whole cell drew two more full-width hairlines
  across the diff and made the thread read as a strip spliced into the table rather
  than a card on it. The thread's fill has to differ from **both** surfaces it
  renders on (inline in the diff, and in the file-level list under a markdown or
  media view — `--bg` in both cases), which is why it's the raised one. And a reply
  at `--bg` puts the `.md-body` code chips (`--bg-hover`) two steps clear of the body
  behind them, where against the old `--bg-elev` reply fill they nearly sank in.
  Replies stay **one card each** rather than becoming a shared left rail: a rail can
  only bracket the whole run, saying nothing about the boundaries inside it.
- **Word-level intra-line diff** (`wordDiff.ts`): a one-character edit rendered as
  a whole line deleted and a whole line added makes the reader diff it by eye, so
  a changed line shades only the spans that changed. Pure and covered by
  `wordDiff.test.ts`: tokenize (word runs / whitespace runs / single punctuation),
  trim the shared head and tail — which is what keeps the **quadratic** LCS off
  the common case of one word changed in a long line — then LCS the middles and
  turn the token flags into character ranges. Three ways it declines, all
  deliberate: lines too long (`MAX_CHARS`/`MAX_TOKENS`, since a minified bundle is
  one enormous "line"), a pair below `MIN_SIMILARITY` (different code, not an edit
  — this is also what makes positional pairing safe when a del run and add run
  have different lengths), and a change spanning both whole lines, which says
  nothing the row shade doesn't. Ranges are keyed by **line number** — deletions
  by old, additions by new — so the Changed and Full views look rows up the same
  way even though Full renders no deleted rows. `splitPieces` cuts the Shiki
  segments at the range boundaries so colour and changedness compose rather than
  one overwriting the other; the extra nesting is safe for occurrence
  highlighting, whose `textNodesIn` walks all descendants and rejects only
  `.sign`. The marks are cleared on `.row-selected` **and `.row-comment-active`**,
  both of which replace the row's add/del shade with `--sel-bg` — a rule that
  swaps a row shade has to clear the word marks too, or they sit on a background
  they were never picked against.
- **The diff table is planned as data, then drawn** (`diffRows.ts`). `buildRows`
  turns (mode, source, hunks, reveals) into rows; `planRows` decides everything about
  those rows that isn't rendering — the shading flags, which threads hang under which
  row, where the composer goes, and the two buckets for comments that can't sit on a
  row. `DiffView` maps the result to `<tr>`s and nothing else. The split exists
  because the rules are the non-obvious part and they were previously interleaved with
  JSX in an unmemoized loop, i.e. untestable without a DOM: a thread is placed by its
  **effective end** line (so a moved comment follows its code); `leftover` is defined
  by what the walk actually rendered, not by any property of a comment — which is what
  catches a Changed view hiding the line *and* an outdated anchor with one rule; the
  composer's inline position and its trailing fallback are **mutually exclusive**; and
  the composer waits for `dragging` to end, or it would flicker under every row a drag
  passes over. `diffRows.test.ts` pins each of those (checked by breaking them one at
  a time), which is the point of the module existing.
- **Expandable hidden regions** (`hunkGaps.ts`): Changed view shows only the hunks
  and Full view the whole file, so reading the few lines around a change meant
  loading all of it. The gaps between hunks (and before the first / after the last)
  now carry a bar that reveals context from the **already-fetched `source`**, so an
  expansion costs no request. `hunkGaps` derives each gap from the **`@@` headers**,
  not from the hunk lines — a pure-deletion hunk has no new-side lines to derive
  from — and one unparseable header returns no gaps at all rather than a set that
  is silently off by the mis-parsed hunk's size. It also carries each gap's `delta`
  (`oldLine = newLine + delta`), which holds only because a gap by definition
  contains no changes; that's what keeps the left gutter honest in revealed rows.
  Note git writes a **zero-length side as the line _before_ the change** (`+4,0` =
  "after new line 4"), so both edges are off by one there — `lastBefore`/`lastOf`
  are the only places that know it. The bar carries the following hunk's `@@`
  header, so the two never stack, and a fully-revealed gap emits **neither** (the
  lines run continuously into the hunk, so the header would be noise). It keeps
  `row-hunk` on the bar's row: that class is what tells occurrence highlighting the
  cell is metadata, not file text. Revealed rows are ordinary context rows, so
  commenting, occurrence highlighting, and inline threads all work in them for
  free. Reveal state resets with `contentKey`, alongside the cached source it reads
  — the two describe the same side and must move together.
- **Themes are one token block plus two renderer names and a code face** (`theme.ts`,
  `styles.css`).
  Every color the UI paints is a `--*` token, so a theme is a
  `:root[data-theme="<id>"]` block restating all of them, plus a `THEMES` entry
  naming the Shiki theme (token colors) and the mermaid theme (diagram fills) that go
  with it — the two renderers that bring their own palettes, and the only colors the
  tokens don't reach. Three rules. **The store owns `<html data-theme>`**: `theme.ts`
  is a module store (`useTheme`/`setTheme` over `useSyncExternalStore`) rather than
  App state, because `DiffView`, `Markdown` and the picker each need it where they
  are, and threading it would add a prop to every card and rendered body (the
  memoised `DiffView` included); it applies the attribute at import and on every set,
  so the attribute and the React value can't disagree. **What's stored is a
  preference, not a theme**: `lr.theme` holds a theme id or `system` — the default,
  resolving to GitHub Dark or Light by `prefers-color-scheme` and following the OS
  live (a `change` listener on the media query) until a theme is picked outright, at
  which point the pick stays put when the desktop flips. The picker shows the
  preference (`useThemePref`), so System stays visibly selected; everything that
  renders reads the resolved theme (`useTheme`). No `matchMedia` — jsdom, or any
  browser we'd not want to paint light unasked — resolves dark. **The default block
  also matches a bare `:root`** (`:root, :root[data-theme="github-dark"]`), and
  `readStoredPref` trusts `lr.theme` only if it names a theme or `system`, so a
  removed or misspelt id falls back to `system` rather than painting nothing.
  **Rendered colors are keyed on
  the theme**: Shiki tokens carry resolved hex, so both `tokenize` effects in
  `DiffView` and the highlight + mermaid passes in `Markdown` take the theme and list
  it in their deps; mermaid's theme is global config, so `renderMermaid`
  re-initializes when the wanted theme differs from the configured one, keys its
  cache on the theme, and declines to cache an SVG a mid-render switch may have
  recolored. The opaque word marks and `--sel-bg` are hand-picked per theme (they
  sit on row shades a translucent tint vanishes against), and `color-scheme` flips
  with the block so native controls follow. **A theme's Shiki side is either one of
  Shiki's own or a hand-written TextMate theme under `themes/`** — Shiki ships no
  JetBrains themes, and an IDE scheme is ~20 colors, so `themes/darcula.ts` maps each
  `.icls` attribute onto the scopes the bundled grammars emit for it; most identifiers
  deliberately stay the default color, which is what makes it read as the IDE's.
  `themes/newUi.ts` does the same for the New UI pair, off the platform's own
  `expUI_darkScheme.xml`/`expUI_lightScheme.xml`, but from **one** scope map: the two
  schemes assign the same roles (`DEFAULT_KEYWORD`, `DEFAULT_STRING`,
  `DEFAULT_FUNCTION_DECLARATION`, …) and differ only in the ~18 colors those roles
  take, so a shared builder is what stops the pair drifting apart rule by rule.
  `theme.test.ts`, `topBar.test.tsx` and `diffView.test.tsx` pin the store, the picker
  and the re-tokenize; `themeBlocks.test.ts` parses `styles.css` and fails if a
  `THEMES` entry has no block or a block skips a token (a skipped token doesn't fall
  back to the default's value — `<html>` has no parent to inherit from — it paints
  the browser's initial color, in that theme only).
- **Mermaid diagrams** (`mermaid.ts`): a second enhancement pass over rendered
  markdown, same `(html) => Promise<string | null>` shape as `highlightBlocks`
  and chained after it in `Markdown`, so it applies **everywhere** `Markdown`
  renders non-inline (markdown files, comment/reply bodies, the export preview);
  the comments-pane inline preview bails before either pass. Only the
  `language-mermaid` fence tag is matched (Shiki registers no aliases for it),
  and `import("mermaid")` sits behind that check, so a review with no diagrams
  never fetches the ~635KB chunk. Running *after* highlighting is what makes the
  failure path free — a fence mermaid can't parse is left as the colored source
  Shiki produced, so the `catch` needs no fallback of its own. Three settings are
  load-bearing: **`htmlLabels: false`** (the HTML-label path keeps `<img>` through
  sanitization and then *awaits its load* — an outbound fetch from a
  localhost-only tool, on diagram source an API agent can author),
  **`securityLevel: 'strict'`** (same untrusted-source reason; strips
  `javascript:` click URLs), and **`suppressErrorRendering: true`** (else a bad
  diagram injects mermaid's error graphic into `document.body`, outside the
  container we render into). Diagrams draw at natural size (`useMaxWidth: false`,
  which has to be set per diagram type — there's no root-level equivalent) and
  scroll inside `.mermaid-diagram`. Renders are cached by source; ids come from a
  counter because each SVG's internal `<style>` selects on its own id.
- **Occurrence highlighting** (`useOccurrenceHighlight.ts`): select a word in a diff
  line and every other occurrence of it in that file lights up, so a variable's uses
  read at a glance. Painted with the **CSS Custom Highlight API** — `Range`s over the
  existing text nodes registered as `CSS.highlights.set("occ", …)` and styled by
  `::highlight(occ)` — so it creates no DOM and can't disturb the per-token spans
  `highlight.ts` renders. That also makes it **uncapped**: no elements per match, so a
  common word costs nothing to mark. The matching rules are pure (`occurrences.ts`,
  covered by `occurrences.test.ts`): case-sensitive, **whole-word only when the
  term is identifier-shaped** (an arbitrary selection like `foo.bar` or `x + 1` has no
  boundary to respect), plus a span→text-node mapping, since tokenizing splits one
  line's text across many nodes. A selection counts only when it starts **and ends**
  in the same `tr:not(.row-hunk) > td.line-content` — one check that rules out
  multi-line drags, the gutters, hunk-header metadata, and comment-thread text; the
  `.sign` (+/-/space) text node is excluded from the walk, or every offset in the line
  would shift by one. Triple-click is ignored (via `e.detail`) since it selects a whole
  line. **The `MutationObserver` repaint is load-bearing:** Shiki swaps a line's single
  text node for per-token spans when its grammar resolves, detaching every range built
  before that — without it the highlight would vanish moments after appearing (it also
  covers the Changed/Full toggle and a refetched diff). Three ways out: click away (an
  empty selection), scrolling the origin file card out of view (`IntersectionObserver`,
  so a long file stays lit while you scan down it), and Escape — which **must also
  `removeAllRanges()`**, or the next mouseup/keyup re-derives the same term and the
  highlight returns.
  The **find bar** (`FindBar.tsx`) sits below the diff scroller, in flow inside a
  `.diff-pane` wrapper: it can't be sticky inside `.diff-column` (the file headers
  already own `top: 0` there), and it has to go **below** rather than above, or the
  bar entering would push the scroller's top edge down and jump the whole diff every
  time a highlight appears. It shows the term, `n of N`, and prev/next. The
  current match carries a second registration (`occ-active`, `priority: 1`), and the
  counter **starts on the occurrence you selected** rather than the file's first, so
  `Enter`/`Shift+Enter` step forward from where you were reading (wrapping at the
  ends). Every control in the bar **must `preventDefault` on mousedown**
  (`keepSelection`): a plain click collapses the text selection, which *is* the
  dismiss gesture, so the buttons would otherwise destroy the highlight they act on.
  Since only rendered rows can be searched, a file in **Changed** view also offers a
  *Search full file* button — the card publishes its mode as `data-view-mode` (only
  when the Changed/Full toggle applies) and the bar signals `DiffView` via a
  `showFullSignal` prop, following `expandTarget`'s pattern; the repaint recounts.
  Line-based diff rows only: not `MarkdownView`, `MediaView`, or comment bodies.
- **Diff/source consistency — the "wrong lines" class of bug.** A file card renders
  two independently-fetched things that must describe the same side: the **hunks**
  (from `/api/diff`) and the **full-file source** (from `/api/file`). Full view
  renders `source` and marks adds from the hunks; Changed view renders hunk rows but
  takes each add/context line's *syntax tokens* from `source`, keyed by new-side line
  number — so a `source` that disagrees with the hunks silently prints the wrong text
  against the current line numbers, in whichever of the two views is highlighted.
  Anything that lets them drift shows up as "wrong lines that a reload fixes", so two
  rules hold. (1) Nothing may write `files` for a selection the user has moved past —
  hence the `reqSeq` gate on the ping refetch above. (2) `DiffView`'s `contentKey`
  (which drops the cached `source`) must name **which side** is being read — `repo` +
  `headRef` + the `side` — not just fingerprint the hunks. Hunks proxy
  the content of a file the diff *touched*; a synthetic `unchanged` card has none, so
  a hunks-only key is constant for it and it would keep another branch's text forever.
  Cards are keyed by path in `App.tsx` and `LazyFile` never unmounts them, so nothing
  else resets that state. Covered by `web/src/diffView.test.tsx` — including that a
  no-op diff refetch still *keeps* the source, or every ping would refetch every
  expanded file.
- **Either side pane collapses to a 28px rail, never to zero.** A pane with no
  edge left on screen is one the reviewer has no way back to, and the 6px resizer
  beside it is a hairline that says nothing about what it hides — so `PaneRail`
  holds the reopen button, the pane's name and the count it was showing.
  `usePanelResize` owns the two open flags alongside the two widths, and a
  collapsed pane **keeps its stored width**, so reopening restores it instead of
  snapping to the default. Three things that go with it: its resizer turns inert
  while it's shut (`resizer-inert`, `tabIndex -1`, handlers dropped) — a drag
  would otherwise clamp the stored width back up to the minimum while the pane
  stayed collapsed; `/` **opens** the files pane before focusing its search, on
  the frame after the commit, since the input doesn't exist until then; and both
  flags persist (`lr.leftOpen`/`lr.rightOpen`), like the widths beside them.
- **Large change-sets stay responsive** via: `LazyFile` viewport-mounting (only
  near-viewport files fetch/tokenize/render), files > `LARGE_FILE_LINES` (500)
  auto-collapse, files > 2000 lines skip highlighting, and panel resize writes
  `grid-template-columns` to the DOM via ref (no per-mousemove re-render). Export
  markdown preview is rendered with `markdown-it` (`html:false`, so safe);
  Copy/Download always emit the raw markdown.
- **Nothing may cost O(files scrolled past).** `LazyFile` mounts a card once and
  never unmounts it, so a long scroll leaves every file visited mounted — a `tr`
  and a syntax-token `span` per line. That is deliberate (unmounting would refetch
  and re-tokenize on every pass), and it makes any per-frame or per-render work
  that scales with the mounted set degrade the further into a review you get,
  which reads as "it gets slow around file 70". Five things hold that line, and
  each is easy to undo by accident:
  - **Per-file work in the explorer stays behind a memo.** The scroll-spy sets
    `selectedFile` as you scroll, which re-renders `FileExplorer` (unmemoized) —
    so anything it computes per file runs per scroll frame. `statByFile`
    (`diffStats.ts`) walks every hunk line in the review, hence the `useMemo` on
    `files`; add a second such computation without one and it lands in that loop.
  - **The scroll-spy stays off the diff's DOM.** `useActiveFile` scans
    `root.children` for the `#file-<path>` anchors, which are always direct
    children of `.diff-column`. A `[id^="file-"]` subtree query (what it used to
    do) has no fast path and walks every element under the column, once per
    scroll frame.
  - **`.file-body` carries `content-visibility: auto`** (+ `contain-intrinsic-size:
    auto`), so the browser skips style/layout/paint for off-screen cards while
    React keeps them mounted — the half that makes mounting-forever affordable.
    It belongs on `.file-body`, not `.file`: the containment would clip the sticky
    `.file-header`, and `.file-body` already excludes it (that's what its
    `overflow: hidden` is for).
  - **A no-op SSE ping must not churn state identity.** Pings are frequent (every
    comment/reply/reviewed mutation, plus the ~1.5s filesystem poller) and mostly
    carry no news, but parsed JSON is a fresh object graph every time. `useReview`'s
    refresh keeps the previous value when the new one is structurally the same
    (`keepIfSame`/`keepIfSameSet`), because identity is what the whole memo graph
    downstream is keyed on. The diff's file list is deliberately exempt — a `diff`
    ping means the git state actually moved.
  - **`DiffView` is `memo`ised with a custom comparator** (`samePropsExceptComments`),
    since the React Compiler can't cache per-iteration inside `App`'s file map.
    Every prop compares by identity except `comments`, which compares by value
    (a review read always rebuilds it). That rests on the props actually being
    stable: `commentsByPath.ts` groups comments once (one shared empty array for
    the many files with none), `useCommentActions` reads the live list through a
    ref so its handler bag doesn't churn, and `onToggleReviewed` takes the path so
    `App` can pass one shared handler instead of a per-card closure. **Adding a
    prop that takes a new identity each render silently disables the whole thing.**
    Covered by `web/src/diffViewMemo.test.tsx`.
- **The comments pane is sortable** — `web/src/commentSort.ts` is the single
  ordering authority, and `App.tsx` feeds its output to *both* the pane and
  `orderedCommentIds`, so `n`/`p` always steps in the order on screen. Comments
  **group by file in every sort**; only the keys change: `file` (default) — file-tree
  index then line, `started` — `createdAt` ascending, `activity` — the thread's last
  change (comment `createdAt`/`updatedAt` and every reply's) descending. Two rules
  hold across all three: **resolved sinks within its file** (never out of its group,
  so group order ignores `resolved` — an all-resolved file keeps its natural slot),
  and **a file sits where its first-listed comment would sit in a flat sort**, so the
  grouped list reads as that flat order with each file hoisted to its first
  appearance. The group key is therefore read *after* the within-file sort — else a
  bumped resolved thread would hoist its file while sitting at the bottom of it.
  Timestamps are second-granular (`store.go` writes RFC3339), so batch-created
  comments tie constantly and `id` is the mandatory tie-break. All of the above is
  pinned by `web/src/commentSort.test.ts` — each rule there was checked to fail if
  the rule is removed, the group-key ordering one included, since none of them are
  visible from reading the comparator alone. Resolving doesn't
  count as activity, since `SetCommentResolved` deliberately doesn't bump
  `updated_at`. The time sorts show the sorted-on timestamp on each item so the
  order explains itself. Purely client-side over data the pane already has.
- **A thread has a turn** (`web/src/commentTurn.ts`): with several identities writing
  comments, the pane is a two-way conversation, and the question a sort can't answer
  is which threads have come back to *you*. `turnOf` derives it from who spoke last —
  the newest reply's author, else the root's — as `you` (they spoke last), `them`
  (you did), or `none`. Derived, never stored, like `anchorStatus`. Three rules:
  the identity test is **reviewer vs not-reviewer**, never a list of agent names
  (authors are open-ended, an API client sends its own — same constant and reason as
  `useUnseenActivity`); **resolved beats turn** (`none` whatever was said last, or
  every dismissed finding would keep asking for a reply) while **outdated doesn't**
  (the line moved, the question didn't); and "last" is the **highest reply id**, since
  second-granular timestamps tie constantly. It surfaces three ways, all off the one
  predicate: a left edge on the pane item (`comment-nav-awaiting`) — only the
  actionable side is marked, so "unmarked = handled" stays readable, and it's an edge
  rather than a dim so it composes with the resolved/outdated opacity; the
  `awaitingYou` count in the pane header, which **doubles as the filter for what it
  counts** (and so stays rendered at zero while that filter is on, or answering the
  last thread would strand you in an empty pane with the toggle gone); and the two
  status-filter values below. The count is taken over the **whole review**, not the
  filtered list — narrowing on another axis must not read as "nothing left to do".
- **The comments pane is filterable** (`web/src/commentFilter.ts`) on four axes —
  status (open / resolved / outdated / awaiting you / awaiting agent), `type`,
  the thread's root `author`, and a free-text `query`. Status carries two axes in
  one select — how a thread stands and whose move it is — because the answers are mutually exclusive in
  practice (a resolved thread has no turn) and a fourth select would crowd the row
  for a combination nobody wants; the two turn values need no resolved check of
  their own, since `turnOf` already calls a resolved thread `none`. With
  several identities writing comments (see *author*, above), "only what
  `security-review-agent` found" is the view a sort can't give. Like the sort it feeds **both** the pane and
  `orderedCommentIds`, so `n`/`p` steps what's on screen; unlike the sort it is
  **not persisted** — a filter remembered from a previous session would open the
  pane already hiding comments — and it **resets when `review.id` changes**, since a
  filter set on one review would silently hide another's. Author choices come from
  the review's own comments (`authorsOf`), because authors are open-ended: the API
  default is `agent`, but a client can send any string.
  **The `query` axis is the pane's search**, and it's an axis rather than its own
  state so it inherits all of that: the Clear button, the `N of M` count, the
  reset-on-review-change, and — the load-bearing one — feeding `orderedCommentIds`,
  so `n`/`p` steps a searched list like a filtered one. Frontend-only by nature
  rather than by concession: `App` already holds every thread in memory, so there is
  nothing a server round-trip could match that `matchesQuery` can't. Three rules.
  **It matches the thread, not the root comment** — every reply body counts, since
  the pane lists roots and a term appearing only in an agent's reply still has to
  surface the thread holding it (the opposite call from `authorsOf`, where counting
  replies would offer a choice that filters to nothing). **Both paths count**, so a
  rename-moved comment is findable under its old name as well as the one it now
  renders under. And **`queryNeedle` is the only place** the raw input becomes a
  needle (trimmed, lowercased): the pane highlights matches with the same needle it
  filtered by, so a whitespace-only query narrows nothing and a `<mark>` can never
  sit on text that isn't why the row is listed. The **body is deliberately not
  marked** — it renders through `Markdown` (markdown-it → `innerHTML`), so
  highlighting inside it would need DOM post-processing or the Custom Highlight API,
  for a preview that's clamped anyway; a match past the clamp or inside a reply shows
  an unmarked item, and the thread is one click away. `commentsPanel.test.tsx` pins
  the controlled-input contract and the highlighting. The pane's count reads
  `N of M` while narrowed, and everything else that counts comments (the explorer
  badges, the export button) deliberately ignores the filter — those describe the
  review, not the pane. Filtering never touches the store or the export.
- **The tab title carries unseen agent activity** (`useUnseenActivity.ts`): handing a
  review to an agent means waiting somewhere else, and the tab is the only surface
  that can say "it answered" while you're in an editor. Comments and replies whose
  `author` isn't `reviewer` count — the reviewer's own come from this app (or a
  second tab of it) and are never news. The count is keyed on **visibility alone**
  (hidden accumulates, visible clears), the same axis the ping refetch uses. Two
  rules keep it honest: whatever is already on a review at the **first** read is
  history, not activity (else opening a review in a background tab would badge its
  whole history), and the `seen` set **re-primes on `review.id`**, so switching
  reviews doesn't count the new one's comments as arrivals.
- **Keyboard shortcuts** live in one window `keydown` effect in
  `useKeyboardShortcuts.ts`: `j`/`k` next/prev file, `n`/`p` next/prev comment (pane
  order via `orderedCommentIds`, stepping from `activeComment`), `v` mark the
  selected file reviewed and jump to the next unreviewed one (`nextUnreviewed` in
  `reviewNav.ts`; unmarking deliberately stays put), `e` export, `r`
  reload, `/` focus the file search, `?` help overlay, `[`/`]` show or hide the files /
  comments pane (the brackets sit either side of the diff the way the panes do),
  `Enter`/`Shift+Enter` next/prev
  occurrence match (only while a highlight is live, and never from a focused
  button/link, so it can't steal the key from a control), `Escape` clear an occurrence
  highlight. The handler bails when the target is an input/textarea/select
  or a modifier is held, and while a modal is open (the one exception being `?`, which
  still closes the help overlay), so it never fights the composer or the browser —
  which is also what leaves `Escape` to the `Modal` shell and the comment composer.
  The bail covers **the whole `.composer` subtree**, not just its textarea: the type
  pills and Cancel/Submit are focusable, and `v`/`e` firing off one of them would act
  on the review mid-comment. That's also why `CommentComposer` binds ⌘/Ctrl+Enter and
  Escape on its **root** rather than the textarea — bound any narrower, both keys would
  be dead everywhere the global
  handler has stood down. Covered by `useKeyboardShortcuts.test.ts` and
  `commentComposer.test.tsx`. The `?` header button opens the same overlay.

## Screenshots

`scripts/screenshot.ts` regenerates `docs/screenshot.png` end to end, because the
README's hero shot went stale over ~50 commits of visible UI work the last time it
was a manual act. It clones **this repo** into a temp dir at a pinned commit
(`FIXTURE_SHA`), resets `main` to that commit's parent so the branch diffs to
exactly it, seeds a review through the public API, and captures headless Chromium
over the DevTools protocol. Six things are load-bearing:

- **The fixture is a real commit of this repo**, not an invented demo project —
  the diff is real Go and TypeScript, and `ada5041` is chosen because its
  `useReview.ts` changes are mostly *modified* lines, which is what puts the
  word-level intra-line shading in frame. A rewritten history breaks the clone
  loudly rather than silently shooting something else.
- **Never port 7777, never the default data dir.** It refuses 7777 outright and
  aborts unless `GET /api/repos` returns exactly the one fixture repo — a stray
  instance that won the port would be serving the developer's real reviews, and
  every seeding call is a write. Same incident as the first gotcha below.
- **Seeding omits `base`** so the server resolves it exactly as the browser will.
  A review is keyed on `(repo, base_ref, head_ref)`, so a mismatch would leave the
  page creating a second, empty review instead of resuming the seeded one.
- **Dark is emulated, not stored.** The theme preference defaults to `system`, so
  `Emulation.setEmulatedMedia` with `prefers-color-scheme: dark` is what resolves
  it to GitHub Dark — set before the first navigate, so it never paints light.
- **Waiting is on a signal, not a delay.** Shiki tokenizes asynchronously and
  fetches each file's grammar lazily, so `settled()` polls until the token count
  stops moving; a timed capture lands on unhighlighted code.
- **Framing is three steps in order**: scroll the card into view (LazyFile mounts
  only near the viewport, so its thread doesn't exist before that), assert the
  card is in Changed view and click the pill if not, *then* centre the thread —
  switching view moves every row below it, so centring first would be undone.

Comment anchors are line numbers into the fixture commit's new side, so after
changing `FIXTURE_SHA` or the seeded comments, run with `--keep` and read the
snippets back off `GET /api/reviews/1` to confirm each landed where it was meant
to — a wrong line still captures a snippet and still reads as `current`.

## Conventions

- Go: standard library only for HTTP; errors bubble up as JSON via `httpError`, and a
  handler that returns a list initializes the slice so it marshals as `[]`, not `null`.
- Frontend: strict TS (`noUnusedLocals`/`noUnusedParameters` on) — no dead code.
  Match the existing component style; keep CSS in `web/src/styles.css` (no CSS-in-JS).
- CSS colors come from the per-theme token blocks at the top of `styles.css` — never
  raw hex in a rule, and a new token needs a value in **every** theme's block.
  Surfaces (`--bg`, `--bg-elev`, `--bg-hover`, `--border`, `--text`, `--muted`,
  `--accent`), the diff-row shades (`--add-bg`/`--add-border`/`--del-bg`/
  `--sel-bg`) plus the intra-line word marks (`--add-word-bg`/`--del-word-bg`, opaque
  rather than tinted — over the row shades a translucent one is almost invisible), the
  occurrence highlight (`--occ-bg`/`--occ-bg-active`), and the semantic status palette
  (`--danger`/`--success`/`--warn`/`--info`, each with a matching `-border` shade — the
  darker, fill-suitable half) and the two elevation colors (`--shadow-color` plus the
  `--highlight-color` that carries a lift where a shadow can't, on a dark surface).
  Plus a few derived/utility tokens, which live in the **shared** `:root` at the top
  rather than in each theme's block, since they're the same formula in every palette:
  `--accent-hover` (brighter accent for the hover state of `.btn-primary`), the
  `-soft` tints (`--accent-soft`/`--danger-soft`/`--success-soft`/`--warn-soft`/
  `--info-soft`/`--muted-soft` — a semantic color at ~12-14% alpha via `color-mix`,
  the fill behind every `.status-*`/`.badge-*` mark and the hover of a control that
  carries that color), `--control-border` (the outline of a small control that has
  to be findable on its own — the checkbox: `--border` is a *divider* colour, and
  at ~1.4:1 on `--bg-elev` it disappears entirely at the bottom of the luminance
  range, so this pulls it two thirds of the way to `--muted` for ~3:1 in every
  theme), `--accent-ring` (the wider, fainter halo behind the focus
  outline), the two elevation steps (`--elev-1` for a bar that something scrolls
  under, `--elev-2` for a surface floating free of the page — modal, dropdown,
  popover), `--on-accent` (foreground on saturated accent/success fills),
  `--backdrop` (modal scrim), `--checker-bg`/`--checker-fg` (transparent-image
  checkerboard) and `--font-sans`. Add a var rather than reintroduce a literal — and
  a derived one belongs in the shared block, so three themes can't round it three
  ways (which is what the hand-written `--danger-soft` values did).
- **Status and type marks are tinted fills, not outlines.** `.status-*`, `.badge-*`
  and `.explorer-count` paint their color's `-soft` tint with a transparent border
  (kept only for the metrics): a dozen of these show at rest, and an outline on each
  competes with the borders that actually divide the layout. `.type-pill` builds on
  `.badge-<type>`, so a pill already wears its tint — what it adds is a hairline in
  its own color and a solid `-border` fill when selected.
- **The resizer is the divider between two panes, and the only one.** Its 6px track
  is the grab target and the 1px hairline down the middle is the edge (3px and accent
  while grabbed) — so `.explorer-column` and `.side-column` carry no border of their
  own: they're `--bg-elev` against the diff's `--bg`, so the surface change already
  separates them and the hairline lands between. Filling the whole track *and*
  keeping the pane borders (what this was) put a 7px grey slab on each side of the
  diff. Its focus ring is drawn inset, since the panes on both sides clip overflow.
- **Entrance motion is only for surfaces the reviewer just summoned** — the modal,
  the combobox dropdown, the `#<id>` popover, a composer (`fade-in`/`surface-in`/
  `dialog-in`, 120-160ms, a 4-8px rise, all off under `prefers-reduced-motion`).
  Deliberately **not** threads, diff rows or comment items: those re-render on every
  SSE ping — every comment, reply and reviewed mark, plus the ~1.5s filesystem
  poller — so an entrance there would fire continuously the whole time an agent is
  working.
- **Fonts ship in the binary, and `--font-mono` belongs to the theme.** The faces are
  vendored under `web/src/fonts` and pulled in by `url()` from the `@font-face` block
  at the top of `styles.css`, so Vite hashes them into `web/dist` and `go:embed`
  carries them — the tool has no network at runtime, so a font it doesn't carry is a
  font it doesn't have. `--font-sans` (Inter) is shared, but **`--font-mono` is a
  per-theme token**: a theme that borrows an editor's colors should borrow the code
  face that editor is designed around, so the GitHub themes get Monaspace Neon and
  the three JetBrains themes get JetBrains Mono. Every stack keeps the old system fallbacks behind the
  bundled family, so a face that fails to load degrades to what the app used before.
  Three rules for adding one: **woff2 only** (every browser that runs this app reads
  it, so a woff sibling is dead weight in the binary); **never subsetted** — a diff
  can contain any character at all, and a code font missing glyphs shows the reviewer
  tofu where the file has text; and **`font-display: swap`**, so a face that fails to
  resolve leaves readable fallback text instead of hiding it for three seconds.
  JetBrains Mono is the one static pair (400 + 700) rather than a variable face —
  upstream ships no variable woff2, only a variable `.ttf`.
- Corner radii come from a fixed scale, never a literal: `--radius-xs` (controls
  too small for anything larger — the 14px checkbox, where `--radius-sm` leaves a
  2px straight edge, i.e. a circle, and a checkbox that reads as a radio is worse
  than a square one), `--radius-sm` (inline chips — status labels, code, kbd,
  thumbnails), `--radius-md` (controls & cards — buttons, inputs, threads, code
  blocks), `--radius-lg` (large surfaces — file cards, modals), `--radius-pill`
  (count/type badges).
- **Checkboxes are drawn here, not by the platform.** `appearance: none` on the
  bare `input[type="checkbox"]`, with the tick and the indeterminate bar as
  `::after` — a native one ignores every token but `color-scheme`, sizes itself
  differently per browser, and lands at a weight that has nothing to do with the
  tinted chips around it. The real `<input>` stays, so the wrapping `<label>`s and
  the tree's `indeterminate` property still work. Two traps: the `*` reset at the
  top doesn't match pseudo-elements and `box-sizing` isn't inherited, so the tick
  states `border-box` itself or its borders overhang the box; and the fill is
  `--accent`, not `--success` — the latter is spoken for by the reviewed-progress
  bar sitting right above those rows, and white clears the greens by less.
- **Both side panes reveal their per-row marks on pane hover, not row hover** —
  the explorer's unchecked boxes on `.explorer-column:hover`, the comments pane's
  delete buttons on `.side-column:hover`. Each of those is a pass down the list
  (mark off the files you've read; decide which threads to drop), and a mark that
  only exists under the pointer makes every item a separate act of aiming — while
  five always-on marks per tree row, or a `--danger` glyph on every comment card,
  is noise down a narrow column. `opacity`, never `display`, so nothing reflows
  under the pointer, and `:focus-within`/`:focus-visible` carries the keyboard,
  which has no hover. A *checked* or indeterminate box always shows: that one is
  state rather than an affordance — which is also why the explorer's reveals need
  an `.explorer-list` in the selector, or they lose on specificity to the
  `:not(:checked):not(:indeterminate)` rule and the box never appears at all.
- Persisted UI prefs (panel widths and open/collapsed flags, selected repo,
  comment sort, color theme, the
  export's instructions checkbox, and the per-repo base branch, diff-view axes and
  agent prompts) go in `localStorage` under `lr.*` keys, via
  `storage.ts`. Validate a stored value on read (`isCommentSort`, `isThemePref`, `normalizeDiffView`,
  `readPromptOverride`'s non-blank-string check) so a stale or impossible one falls
  back to the default rather than reaching the app.
- Modals (`.modal` inside a `.modal-backdrop`) close on Escape and backdrop
  click, and use `useFocusTrap` for focus-in / Tab-trap / restore-on-close —
  give a new modal the same treatment (mark its safe default control
  `data-autofocus`). **A backdrop click is a press _and_ a release on the
  backdrop**, tracked across `mousedown`/`mouseup` in `Modal.tsx`: a `click`
  fires on the common ancestor of the two, so selecting text in the prompt
  editor and releasing outside the dialog reported the backdrop as the click's
  target and discarded the edit. `modal.test.tsx` pins both drag directions. The global keyboard shortcuts in `App.tsx` must bail while
  a modal is open (see the `showExport`/`showPrompts`/`showHelp`/`showAddFile`/
  `confirmingReset` guards, passed to `useKeyboardShortcuts` as one `modalOpen` flag).

## Gotchas

- **Never test against the default port (7777) or the default data dir.** A real
  instance is usually already running on 7777 against the developer's own repos and
  reviews. A test server started there **fails to bind and exits**, and every
  subsequent request silently hits the *live* instance instead — which is how a
  probe of `POST /api/reviews/{id}/reset` once wiped a real review's comments,
  reviewed marks and summary (there is no undo). Always
  `-port <something unusual> -data-dir <tmp>`, and **confirm the server you started
  is the one answering** (check its log for `listen … address already in use`, and
  that `GET /api/repos` returns *your* fixture repos) before sending any write.
  The one exception is the Vite dev proxy, which hardcodes `127.0.0.1:7777` in
  `vite.config.ts` — testing that path means stopping the real instance first.
- **Build the frontend before `go build`** — `//go:embed all:web/dist` fails to
  compile if `web/dist` is empty. A tracked `web/dist/.gitkeep` keeps it
  compilable on a fresh clone; a Vite plugin (`preserveGitkeep`) recreates it
  after each build since `emptyOutDir` wipes the folder.
- `web/dist` bundle and `local-review.db*` are gitignored; don't commit them.
- **The frontend toolchain is bun, and `web/bunfig.toml` is what keeps Node out of
  it.** `bun install` / `bun run --cwd web <script>`; the lockfile is `web/bun.lock`
  (committed — `bun install --frozen-lockfile` is what CI installs with), and there
  is no `package-lock.json` any more. But vite, vitest, tsc and eslint all ship bins
  with a `#!/usr/bin/env node` shebang, which bun **honors by default** — so without
  the `[run] bun = true` in `web/bunfig.toml` every script silently spawns Node again,
  and both workflows (which install no Node at all) fail on the runner's ambient
  version instead. Delete that file and the build stops being reproducible without
  telling you. The whole toolchain is verified to run on bun's own runtime, so the
  Node engine floor Vitest used to impose no longer applies to us.
- Changing the markdown output? `internal/export` is the single canonical
  formatter — the frontend never generates markdown (the preview only *renders* it).
  It is served in **two shapes over one rendering** (`renderExport`): `export`
  returns JSON, because the browser renders the markdown in a preview and needs the
  download filename beside it, and `export.md` returns the markdown *as the body*,
  because an agent digging it out of an envelope needs a `jq` the copyable prompt
  can't assume is installed — and that pipeline failing is the prompt's **first**
  instruction failing. Same render, same status transition, and errors stay JSON on
  both. `export_test.go` pins the equivalence, which is the thing that could rot
  silently: only the JSON shape is ever exercised by the app. The `.md` shape carries
  the filename in `Content-Disposition`, which is why `sanitize` also drops `"` and
  `\` — a git ref may legally contain them and the parameter is quoted.
  `Render` can optionally append **agent reply instructions** (a curl example
  against `/api/comments/{id}/replies`), gated by the `instructions` query param
  on `POST /api/reviews/{id}/export`; the export modal's checkbox drives it and
  remembers the last choice in `localStorage` under `lr.exportInstructions`. The
  curl base URL comes from the export request's `Host`.
- **The agent prompts are templates, not strings** (`web/src/prompts.ts`). A reviewer
  can edit either one and **Save** it for the repo (`lr.agentPromptsByRepo`), where it
  outlives the review it was edited against — so the review-specific values are
  `{{origin}}`/`{{reviewId}}`/`{{headRef}}`/`{{baseRef}}`, substituted by `renderPrompt`
  at **copy** time. Interpolating them when the modal opens (what the old
  `buildReplyPrompt(review, origin)` did) would bake one review's id and refs into the
  saved text and silently mis-brief the next agent, so keep any new volatile value a
  placeholder and add it to `PROMPT_PLACEHOLDERS` — which the editor lists and
  `prompts.test.ts` pins against what actually resolves, both directions. An
  unrecognised token is left standing rather than blanked: the text is hand-edited, and
  `{{orgin}}` in a copied curl says what went wrong where a gap would not. Save refuses
  a blank template and `readPromptOverride` reads one as absent — two halves of the same
  rule, since a stored blank would leave the editor with no default left to fall back
  to. `App` keys the modal on `repo` so a switch remounts it instead of saving one
  repo's drafts under another's key. Covered by `web/src/agentPromptsModal.test.tsx`.
  **"Do a review" is one prompt per focus** — Correctness, Security, Design, Tests —
  and deliberately **one focus per run**: they differ by how the agent *traverses* the
  code (security follows untrusted input inward from the entry points, design reads
  well outside the diff, tests enumerate behaviours and look for the assertions), and
  merging several into one brief collapses those distinct traversals into a single
  cheap pass over the diff, with an undefined finding budget. Run several by running
  the agent several times — they file into the same review under different authors, so
  the pane filters them apart. Only the brief differs, so `reviewTemplate` composes
  each from a shared head and API block; what a reviewer *saves* is still one complete
  self-contained template per focus, under its own key. Correctness keeps the original
  `review` key, so a template saved before the focuses existed still resolves — `kind`
  is deliberately independent of both `label` and `author` for that reason. And the
  author is `{{author}}`, never a literal: each review prompt names it three times (the
  POST body, the `?author=` poll, the reply body), and an agent filing under one name
  while polling another would see none of its own threads and report nothing to answer.
  `renderPrompt` takes the review's values plus the *selected prompt's* author, which
  is why `PromptVars` extends `ReviewVars` and the modal merges the two at copy time.
- Go's build cache has occasionally embedded a **stale `web/dist`**; if the served
  bundle doesn't match disk, `rm` the binary and rebuild. `start.sh` (vite → go)
  is the reliable path.
- Importing Shiki's `bundledLanguages` pulls in a ~600KB `wasm-*.js` chunk that's
  **dynamically imported but never called** (we use the JS engine) — dead weight
  on disk, not fetched at runtime. Don't chase it.
- The build runs the **React Compiler** (auto-memoization) unconditionally, and
  `bun run lint` runs `eslint-plugin-react-hooks@7`'s rules (rules-of-hooks +
  the compiler diagnostics) — see `COMPILER.md`. `react-compiler-runtime` is a real
  dependency (the `useMemoCache` polyfill for React 18). The intentional partial-dep
  effects surface as `exhaustive-deps` warnings, not inline disables (which would
  make the compiler rules distrust the whole file); `set-state-in-effect` is off.
  The compiler is its **own Vite plugin** (`@rolldown/plugin-babel` +
  `reactCompilerPreset`), because `@vitejs/plugin-react` has had no `babel` option
  since v6 — see `COMPILER.md` for that and for why the native Rust compiler behind
  `react({ compiler: true })` is deliberately not used.
- **Vite 8 bundles with Rolldown and transforms with Oxc**, not Rollup and esbuild,
  so the config options are `build.rolldownOptions` / `worker.rolldownOptions` /
  `optimizeDeps.rolldownOptions` and `oxc` — the `rollupOptions` and `esbuild` names
  every other Vite project still uses are deprecated shims here. None are set today
  (the config is just `plugins` + `build.outDir`/`emptyOutDir` + `server.proxy`), and
  the chunk-size warning Shiki's ~235 lazy grammars trigger points at the Rolldown
  option. CSS minification is LightningCSS, which leaves the `color-mix()` tokens and
  `:has()` selectors `styles.css` relies on intact. Nothing here runs on Node — see
  the bun gotcha below.
