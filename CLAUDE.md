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
./start.sh <root-path> [flags]   # build frontend + binary, serve repos under root
```

Manual equivalent (frontend MUST be built before the binary — see Gotchas):

```sh
npm --prefix web install
npm --prefix web run build        # → web/dist (embedded)
go build -o local-review .
./local-review -root <folder>      # serves http://127.0.0.1:7777

# frontend dev with hot reload (Vite proxies /api → :7777):
./local-review -root <folder> -no-open   # terminal 1
npm --prefix web run dev                 # terminal 2 → :5173
```

Checks: `go build ./...`, `go vet ./...`, `npm --prefix web run build` (runs `tsc`),
`npm --prefix web run lint` (ESLint: rules-of-hooks + React Compiler rule; see `COMPILER.md`),
`npm --prefix web run test` (vitest; jsdom + Testing Library — `web/vitest.config.ts`,
`web/vitest.setup.ts`). Frontend hook logic (the `useReview` selection/refetch races)
is tested via `renderHook` with a mocked `api`; test files are excluded from the build
tsconfig and lint. There is no browser automation here — verify backend changes with
`curl` against a throwaway git repo; verify pure UI/DOM behavior manually.

## Layout

```
main.go                  server: embeds web/dist, resolves DB path, prunes drafts, opens browser
internal/git/git.go      git service (shells out to `git`): branches, merge-base, recent commits, diff parser (committed-range / working-tree / index variants), file content (ref/worktree/index), worktree fingerprint
internal/store/store.go  SQLite (modernc.org/sqlite, WAL): reviews, comments, replies, reviewed_files
internal/api/api.go      HTTP handlers (net/http, Go 1.22+ method+path routing)
internal/api/events.go   in-memory SSE hub: per-review subscriber channels, publish/prune
internal/api/watch.go    per-review filesystem poller: fingerprints the repo while subscribed, pings on out-of-band change
internal/export/export.go  renders a review → canonical markdown
web/src/
  App.tsx                top-level state, repo/branch pickers, 3-column resizable layout, all handlers
  api.ts                 fetch wrappers    types.ts  shared types
  highlight.ts           Shiki wrapper: all languages, lazy-loaded, JS regex engine
  mermaid.ts             ```mermaid fences → SVG; lazy-loaded, runs after highlighting
  time.ts                relative/absolute timestamp + edited-marker helpers
  commentSort.ts         the comments-pane sort orders (file / started / activity)
  commentFilter.ts       the comments-pane filters (status / type / author) + the authors present
  commentTurn.ts         whose move a thread is waiting on (who spoke last) + the awaiting-you count
  commentsByPath.ts      group comments per file card + the by-value compare its memo uses
  wordDiff.ts            intra-line diff: token LCS → changed char ranges + the segment splitter
  hunkGaps.ts            the unchanged regions a hunk view hides: their line ranges + how much is revealed
  diffStats.ts           per-file / whole-review added+removed line counts, off the hunks
  occurrences.ts         occurrence matching: term validation, whole-word vs substring, span→text-node mapping
  useOccurrenceHighlight.ts  select a word → light up its other occurrences in that file
  useUnseenActivity.ts   count agent comments/replies that arrived while the tab was hidden
  useFocusTrap.ts        modal focus hook: focus-in, Tab trap, restore on close
  storage.ts             typed, error-swallowing localStorage helpers + the lr.* keys
  components/
    FileExplorer.tsx     left pane: hierarchical file tree, collapse, reviewed toggle,
                         per-file +/- counts, reviewed-progress bar (the head's bottom edge)
    DiffView.tsx         center: per-file diff, syntax highlight, inline threads/composer,
                         drag-select ranges, Changed/Full toggle, expandable hidden regions,
                         auto-collapse large files
    LazyFile.tsx         viewport lazy-mount wrapper (IntersectionObserver) + scroll anchor
    FindBar.tsx          occurrence-highlight bar above the diff: term, n-of-N, prev/next
    CommentThread.tsx    a comment thread: root comment (edit/delete) + replies + reply composer
    CommentsPanel.tsx    right pane: cross-file comment overview, sort + filter selects, jump-to
    ReviewSummary.tsx    the review's free-text summary above the comments pane (view/edit)
    CommentComposer.tsx  type pills (one-click radiogroup, built on the .badge-<type>
                         chips) + body textarea (reused for new/edit; replies hide the type)
    MarkdownView.tsx     rendered (as-published) view of a .md file + file-level comments
    ExportModal.tsx      rendered-markdown preview (via Markdown) + Raw toggle + copy/download
    AgentPromptsModal.tsx  copyable agent prompts (Address-the-review / Do-a-review),
                         ViewToggle to switch + Copy the active one
    Modal.tsx            shared dialog shell: backdrop, focus trap, Escape, dialog aria
    ViewToggle.tsx       data-driven segmented control (Changed/Full, Text/Image,
                         Code/Rendered, Preview/Raw)
    CopyButton.tsx       clipboard button with idle/ok/fail state (lazy text builder)
    (small shared UI primitives: Chevron, CommentCount, DiffStatBadge, AnchorBadge,
     MetaTimestamps,
     Markdown — markdown-it + async Shiki code-fence highlight, then async mermaid
     render; `softBreaks` picks comment (GFM <br>) vs document (CommonMark)
     newline handling)
```

## Architecture notes

- **Root-scoped, multi-repo.** The server is started with `-root <folder>` and
  serves every git repo directly under it (`GET /api/repos`). Git-reading calls
  (`branches`/`diff`/`file`) and review creation take a `repo` param (a single
  path segment); `api.repoFor` validates it against the root and rejects
  traversal. Review/comment/export endpoints work off `review_id` (which carries
  `repo_path`), so they need no `repo` param.
- **Backend is source of truth** for review state; React caches it and mutates
  via the API. Discrete actions (add/delete/toggle) save immediately.
- **Comments anchor to the new side** (HEAD path + line) and store a captured
  `snippet` so feedback survives line drift. The **server** captures that snippet
  from the anchored range at add time (`captureSnippet` in `annotate.go`, reading
  the same side the staleness check will — the git index for an `indexed` anchor,
  the working tree for a `worktree` anchor, else `head_ref`), so every client — the
  browser and API agents alike — sends only the line range; a bogus client-supplied
  snippet can't drift the record and the stored text always matches the file. Line-0
  file comments keep an empty snippet. Each comment also records the
  `commit_sha` it was anchored against (resolved live at add time; best-effort,
  may be empty) — an immutable record of the original position and when it held.
  **The anchor side is three-valued**, carried by two mutually-exclusive flags:
  `worktree` (anchored against the on-disk working tree) and `indexed` (against the
  git index / staged content); neither set ⇒ `head_ref`. They come from the active
  diff view's `uncommitted`/`unstaged` axes (see below) and drive the snippet-capture
  and staleness sides.
- **Comment staleness is derived, never persisted.** The stored line numbers are
  the *original* anchor; the branch keeps moving, so `internal/api/annotate.go`
  recomputes a live `anchorStatus` (`current` | `moved` | `outdated`) on every
  review read (`handleGetReview`, `handleCreateReview`, `handleExport`, and the
  add-comment response). **Primary method: precise line tracking via git.** For a
  committed comment with a `commit_sha`, `annotateByDiff` runs
  `git diff <commit_sha> head` (the **whole** diff, no pathspec — so git can pair a
  rename; restricting to the old path would report a bare deletion) and maps the
  original range through the matched file's hunks (`git.MapOldLine`): every line
  surviving contiguously → `current` (same position) or `moved` (shifted, with
  derived `currentStartLine`/`currentEndLine`); any line deleted/modified →
  `outdated`. **Renames are followed:** when the matched file is a rename, the move
  relocates to the new path — `moved` with `currentFilePath` set (a pure R100 rename
  carries no hunks, so lines map 1:1) — while a rename whose anchored block was also
  edited still falls to `outdated` via the same contiguity check. This beats snippet
  matching, which can't tell a real move from a coincidental reappearance of the same
  lines. Diff-tracking is head-anchored only — `worktree`/`indexed` comments always
  snippet-match, since their side has no commit to diff against.
  **Fallback: snippet matching** — used for worktree/index comments, comments
  without a `commit_sha`, and binary files — compares the captured `snippet`
  against the current file (the git index for `indexed` comments via `repo.IndexFile`
  / `git show :path`, the working tree for `worktree` comments via
  `repo.WorktreeFile`, else `head_ref` via `git show head:path`): match at the stored
  range → `current`; a unique match elsewhere → `moved`; gone/ambiguous/unreadable →
  `outdated`.
  The frontend renders the effective (relocated) line **and path** — a rename-moved
  comment groups/renders under its `currentFilePath` (see `effectivePath` in
  `types.ts` and `export.go`) and badges "moved from `<old>`"; the export files it
  under the new path too. `anchorStatus`/`currentStartLine`/`currentEndLine`/
  `currentFilePath` are computed on `store.Comment` in the API layer with
  `omitempty` — the store never reads or writes them. Diffs are cached per distinct
  commit_sha (the whole diff), file reads per path, per review read.
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
  only a summary is still resettable.
- **Threads are two levels.** A comment is a thread root; the `replies` table
  holds follow-ups (body + timestamps only — anchor and `type` stay on the root).
  A reply's `comment_id` FK cascade-deletes it with its comment (and the comment
  chain-cascades from its review), so replies never orphan. `GetReview` nests
  `replies` under each comment; reply mutations publish the same SSE ping.
- **A thread can be resolved** — a `resolved` flag on the root comment (toggled
  via `POST /api/comments/{id}/resolved`). Resolved threads are dimmed in the UI
  and **excluded from the export** (the artifact carries only open, actionable
  feedback). The column is backfilled onto older DBs by `store.ensureColumn`,
  the idempotent add-column helper to reuse when adding future columns.
  **Resolving deliberately does not bump `updated_at`** — that column tracks the
  last body/type edit, which the UI surfaces as an `(edited)` marker (`time.ts`
  `wasEdited`), and resolving isn't an edit (it has its own flag). Keep it that
  way if you touch `SetCommentResolved`, or the marker will fire on resolve.
- **Comments and replies carry an `author`.** Three identities the server tells
  apart purely by this field (there's no auth/session): `"reviewer"` — the human,
  tagged explicitly by the browser app (`api.ts`); `"agent"` — the coding agent
  addressing the review, which is the API default so it needn't set it; and
  `"review-agent"` — the adversarial reviewer, which the *Do-a-review* prompt has
  it send on every comment and reply so its findings and follow-ups stay distinct
  from the coding agent's replies to them. The columns' DDL/migration default is
  `'reviewer'`, so rows created before the field existed backfill as the
  reviewer's. Author shows in the thread meta and in the export heading/reply lines.
- **`GET /api/reviews/{id}/comments`** returns a review's comments as JSON with
  the same live annotation as `GetReview` (anchor status, replies nested), and an
  optional `?author=` narrows to one root author. It's the read side for an
  *adversarial-review* agent: `?author=review-agent` gives it only the threads it
  started — its own comments plus any reviewer/coding-agent replies — without the
  reviewer's separate comments or the reviewed-file list. Pure API-layer filter over
  `GetReview`+`annotateReview` (no store/SQL change); empty result is `[]`, not
  null. Distinct from the reply-oriented markdown `export`, which is the
  reviewer→coding-agent artifact.
- **Diff base** defaults to the main-branch *name* (stored on the review); the
  `/api/diff` handler resolves it to `merge-base(base, head)` at query time, so
  the review shows only what the branch introduces. `MainBranch()` prefers a
  local `main`/`master`, then falls back to the remote default
  (`origin/HEAD`) / `origin/main` / `origin/master` — so a branch worked off
  `origin/main` with no local trunk still gets an auto base. If nothing
  resolves it returns `""` and create-review/diff ask for an explicit base.
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
  it's gated on that (the UI disables the checkbox otherwise). `useReview` holds the
  `from`/`uncommitted`/`unstaged` state, derives `effectiveUncommitted` (`uncommitted
  && headIsCurrent`) plus `worktreeSide` (`effectiveUncommitted && unstaged`) and
  `indexedSide` (`effectiveUncommitted && !unstaged`), which pick the anchor side
  threaded into add-comment / set-reviewed / file / blob calls.
  **`uncommitted`/`unstaged` are remembered per repo** (`lr.diffViewByRepo`, keyed by
  repo alone — they describe how you look at a repo, not at a branch or review);
  `from` stays per-session, since a sha belongs to one head's history. The restore
  happens in the *branch-load* `.then`, in the same update as `head`: the guard above
  clears `uncommitted` whenever head isn't the checked-out branch, and while branches
  are loading it never is. And only the reviewer's toggles write
  (`changeUncommitted`/`changeUnstaged`) — persisting from an effect on the state
  would let that guard, or the `unstaged` reset, erase the stored choice.
- **The view has to say what it compares.** Four controls (repo/head/base/from plus
  the two checkboxes) can name a range but not explain it, and a reviewer's reflex is
  to check the result against their git client — where a mismatched file count reads
  as a bug in this tool. So `TopBar` states the comparison outright: a **changed-file
  count** next to the `+N -M` badge, and a `compareTitle` tooltip naming **both ends**
  in words (which commit the before side resolved to and why — merge-base with base,
  or the parent of the picked commit *whose own changes are included* — against head /
  working tree / index). Two counts are deliberately different numbers and each says
  so: the topbar counts `files` (what the diff changes, the number that matches a git
  client), while the explorer's `N/M reviewed` denominator counts `allFiles`, which
  also holds the synthetic cards for files opened only to comment on — its tooltip
  splits the two apart. The usual divergences left are honest ones the readout now
  explains: the default before side is the **merge-base**, not `HEAD`, so it lists the
  whole branch where a client's "changed files" lists only uncommitted work; renames
  pair into one file (`--find-renames`); and an untracked *directory* lists as its
  individual files, where `git status` collapses it to one entry.
- **DB lives in `~/.local-review/`** by default; override the directory with the
  `-data-dir` flag (a leading `~` is expanded, relative paths are made absolute).
  One DB serves many repos, keyed by abs path.
- Reviews resume by `(repo_path, base_ref, head_ref)` regardless of status, so
  exporting (which sets status `exported`) never orphans an in-progress review.
- `reviewed_files` persists per-file "reviewed" state, keyed by path within a
  review. Each mark also captures a **content fingerprint** (SHA-256 of the
  file's new-side content) and the side it was seen on (`worktree`/`indexed` flags:
  on-disk working tree, git index, or `head_ref`), mirroring how comments record
  their three-valued anchor side.
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
  ref/worktree/index resolution (a `indexed=true` param reads `git show :path`) and
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
  (not oniguruma — avoids a browser wasm-load failure) and `github-dark`. All
  ~235 grammars are available, each lazily fetched per file. Extensions resolve
  to language ids via Shiki's own alias metadata (+ a tiny extras map). `DiffView`
  tokenizes the whole file once and renders tokens per line (avoids per-line
  breakage on multi-line constructs); deleted lines are highlighted per-line.
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
  `headRef` + the worktree/index flags — not just fingerprint the hunks. Hunks proxy
  the content of a file the diff *touched*; a synthetic `unchanged` card has none, so
  a hunks-only key is constant for it and it would keep another branch's text forever.
  Cards are keyed by path in `App.tsx` and `LazyFile` never unmounts them, so nothing
  else resets that state. Covered by `web/src/diffView.test.tsx` — including that a
  no-op diff refetch still *keeps* the source, or every ping would refetch every
  expanded file.
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
  comments tie constantly and `id` is the mandatory tie-break. Resolving doesn't
  count as activity, since `SetCommentResolved` deliberately doesn't bump
  `updated_at`. The time sorts show the sorted-on timestamp on each item so the
  order explains itself. Purely client-side over data the pane already has.
- **A thread has a turn** (`web/src/commentTurn.ts`): with three identities writing
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
- **The comments pane is filterable** (`web/src/commentFilter.ts`) on three axes —
  status (open / resolved / outdated / awaiting you / awaiting agent), `type`, and
  the thread's root `author`. Status carries two axes in one select — how a thread
  stands and whose move it is — because the answers are mutually exclusive in
  practice (a resolved thread has no turn) and a fourth select would crowd the row
  for a combination nobody wants; the two turn values need no resolved check of
  their own, since `turnOf` already calls a resolved thread `none`. With
  three identities writing comments (see *author*, above), "only what `review-agent`
  found" is the view a sort can't give. Like the sort it feeds **both** the pane and
  `orderedCommentIds`, so `n`/`p` steps what's on screen; unlike the sort it is
  **not persisted** — a filter remembered from a previous session would open the
  pane already hiding comments — and it **resets when `review.id` changes**, since a
  filter set on one review would silently hide another's. Author choices come from
  the review's own comments (`authorsOf`), because authors are open-ended: the API
  default is `agent`, but a client can send any string. The pane's count reads
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
  reload, `/` focus the file search, `?` help overlay, `Enter`/`Shift+Enter` next/prev
  occurrence match (only while a highlight is live, and never from a focused
  button/link, so it can't steal the key from a control), `Escape` clear an occurrence
  highlight. The handler bails when the target is an input/textarea/select
  or a modifier is held, and while a modal is open, so it never fights the
  composer or the browser — which is also what leaves `Escape` to the `Modal` shell
  and the comment composer. The bail covers **the whole `.composer` subtree**, not
  just its textarea: the type pills and Cancel/Submit are focusable, and `v`/`e`
  firing off one of them would act on the review mid-comment. That's also why
  `CommentComposer` binds ⌘/Ctrl+Enter and Escape on its **root** rather than the
  textarea — bound any narrower, both keys would be dead everywhere the global
  handler has stood down. Covered by `useKeyboardShortcuts.test.ts` and
  `commentComposer.test.tsx`. The `?` header button opens the same overlay.

## Conventions

- Go: standard library only for HTTP; errors bubble up as JSON via `httpError`.
- Frontend: strict TS (`noUnusedLocals`/`noUnusedParameters` on) — no dead code.
  Match the existing component style; keep CSS in `web/src/styles.css` (no CSS-in-JS).
- CSS colors come from the `:root` custom properties — never raw hex in a rule.
  Surfaces (`--bg`, `--bg-elev`, `--bg-hover`, `--border`, `--text`, `--muted`,
  `--accent`), the diff-row shades (`--add-bg`/`--add-border`/`--del-bg`/
  `--sel-bg`), and the semantic status palette (`--danger`/`--success`/`--warn`/
  `--info`, each with a matching `-border` shade) used by `.status-*`/`.fstat-*`/
  `.badge-*` and danger controls. Plus a few derived/utility tokens:
  `--accent-hover` (brighter accent for the hover state of `.btn-primary`),
  `--danger-soft` (translucent danger tint for hover fills + the error banner),
  `--on-accent` (foreground on saturated accent/success fills), `--backdrop`
  (modal scrim), and `--checker-bg`/`--checker-fg` (transparent-image
  checkerboard). Add a var rather than reintroduce a literal.
- Corner radii come from a fixed scale, never a literal: `--radius-sm` (inline
  chips — status labels, code, kbd, thumbnails), `--radius-md` (controls & cards
  — buttons, inputs, threads, code blocks), `--radius-lg` (large surfaces — file
  cards, modals), `--radius-pill` (count/type badges).
- Persisted UI prefs (panel widths, comment sort, and the per-repo base branch and
  diff-view axes) go in `localStorage` under `lr.*` keys, via `storage.ts`. Validate
  a stored value on read (`isCommentSort`, `normalizeDiffView`) so a stale or
  impossible one falls back to the default rather than reaching the app.
- Modals (`.modal` inside a `.modal-backdrop`) close on Escape and backdrop
  click, and use `useFocusTrap` for focus-in / Tab-trap / restore-on-close —
  give a new modal the same treatment (mark its safe default control
  `data-autofocus`). The global keyboard shortcuts in `App.tsx` must bail while
  a modal is open (see the `showExport`/`showPrompts`/`showHelp`/
  `confirmingReset` guards).

## Gotchas

- **Build the frontend before `go build`** — `//go:embed all:web/dist` fails to
  compile if `web/dist` is empty. A tracked `web/dist/.gitkeep` keeps it
  compilable on a fresh clone; a Vite plugin (`preserveGitkeep`) recreates it
  after each build since `emptyOutDir` wipes the folder.
- `web/dist` bundle and `local-review.db*` are gitignored; don't commit them.
- Changing the markdown output? `internal/export` is the single canonical
  formatter — the frontend never generates markdown (the preview only *renders* it).
  `Render` can optionally append **agent reply instructions** (a curl example
  against `/api/comments/{id}/replies`), gated by the `instructions` query param
  on `POST /api/reviews/{id}/export`; the export modal's checkbox drives it and
  remembers the last choice in `localStorage` under `lr.exportInstructions`. The
  curl base URL comes from the export request's `Host`.
- Go's build cache has occasionally embedded a **stale `web/dist`**; if the served
  bundle doesn't match disk, `rm` the binary and rebuild. `start.sh` (vite → go)
  is the reliable path.
- Importing Shiki's `bundledLanguages` pulls in a ~600KB `wasm-*.js` chunk that's
  **dynamically imported but never called** (we use the JS engine) — dead weight
  on disk, not fetched at runtime. Don't chase it.
- The build runs the **React Compiler** (auto-memoization) unconditionally, and
  `npm run lint` runs `eslint-plugin-react-hooks@7`'s rules (rules-of-hooks +
  the compiler diagnostics) — see `COMPILER.md`. `react-compiler-runtime` is a real
  dependency (the `useMemoCache` polyfill for React 18). The intentional partial-dep
  effects surface as `exhaustive-deps` warnings, not inline disables (which would
  make the compiler rules distrust the whole file); `set-state-in-effect` is off.
```
