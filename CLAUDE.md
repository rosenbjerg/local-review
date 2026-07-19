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
  time.ts                relative/absolute timestamp + edited-marker helpers
  useFocusTrap.ts        modal focus hook: focus-in, Tab trap, restore on close
  storage.ts             typed, error-swallowing localStorage helpers + the lr.* keys
  components/
    FileExplorer.tsx     left pane: hierarchical file tree, collapse, reviewed toggle
    DiffView.tsx         center: per-file diff, syntax highlight, inline threads/composer,
                         drag-select ranges, Changed/Full toggle, auto-collapse large files
    LazyFile.tsx         viewport lazy-mount wrapper (IntersectionObserver) + scroll anchor
    CommentThread.tsx    a comment thread: root comment (edit/delete) + replies + reply composer
    CommentsPanel.tsx    right pane: cross-file comment overview, jump-to
    CommentComposer.tsx  type select + body textarea (reused for new/edit)
    MarkdownView.tsx     rendered (as-published) view of a .md file + file-level comments
    ExportModal.tsx      rendered-markdown preview (via Markdown) + Raw toggle + copy/download
    AgentPromptsModal.tsx  copyable agent prompts (Address-the-review / Do-a-review),
                         ViewToggle to switch + Copy the active one
    Modal.tsx            shared dialog shell: backdrop, focus trap, Escape, dialog aria
    ViewToggle.tsx       data-driven segmented control (Changed/Full, Text/Image,
                         Code/Rendered, Preview/Raw)
    CopyButton.tsx       clipboard button with idle/ok/fail state (lazy text builder)
    (small shared UI primitives: Chevron, CommentCount, AnchorBadge, MetaTimestamps,
     Markdown — markdown-it + async Shiki code-fence highlight; `softBreaks` picks
     comment (GFM <br>) vs document (CommonMark) newline handling)
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
- **The diff view is two orthogonal transient axes**, *not* part of review identity —
  the review still resumes by `(repo, base_ref, head_ref)` and comments still anchor
  to whichever side they were added on, regardless of the view on screen. `/api/diff`
  takes `from` + `uncommitted` + `unstaged` and maps them to a `(from → to)` git range:
  - **`from`** sets the *before* side: `all` (or empty) → `merge-base(base, head)`,
    the whole branch (base defaults to the main branch); a commit sha → that commit,
    **exclusive** — `from = ResolveSHA(picked)`, so the picked commit is the baseline
    and is *not* shown. The commit list is `GET /api/commits` — `git log base..head`,
    scoped to the branch's own commits (never base-branch history behind the merge
    point) — surfaced in the UI as an always-present "from" picker with `All` on top.
  - **`uncommitted`** (bool) sets the *after* side: `false` → `head` (committed
    range, `git diff <from> head`); `true` → the working tree or the git index.
  - **`unstaged`** (bool, default true; only meaningful when `uncommitted`) picks
    which: `true` → working tree (`git diff <from>` + untracked, staged **and**
    unstaged); `false` → git index (`git diff --cached <from>`, no untracked —
    **staged only**). New side = working tree when `unstaged`, else the index.
  The response `base` is the resolved `from` ref (the merge-base, or the picked
  commit's sha) — what `/api/blob`'s "before" image uses.
  The `uncommitted` axis is only meaningful when head is the checked-out branch, so
  it's gated on that (the UI disables the checkbox otherwise). `useReview` holds the
  `from`/`uncommitted`/`unstaged` state, derives `effectiveUncommitted` (`uncommitted
  && headIsCurrent`) plus `worktreeSide` (`effectiveUncommitted && unstaged`) and
  `indexedSide` (`effectiveUncommitted && !unstaged`), which pick the anchor side
  threaded into add-comment / set-reviewed / file / blob calls.
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
  on `review.id`. The
  hub (`internal/api/events.go`) is in-memory with non-blocking coalescing sends, so
  a stalled tab never blocks a handler; empty review entries are pruned on the last
  unsubscribe. A 25s keepalive comment keeps the stream warm and turns a half-open
  connection into a write error so it unsubscribes. The frontend keeps a
  focus/visibility refetch as a fallback for the reconnect gap, gated on the stream
  not being `OPEN` — and it passes `diff` (a dead stream may have missed a content
  change).
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
- **Large change-sets stay responsive** via: `LazyFile` viewport-mounting (only
  near-viewport files fetch/tokenize/render), files > `LARGE_FILE_LINES` (500)
  auto-collapse, files > 2000 lines skip highlighting, and panel resize writes
  `grid-template-columns` to the DOM via ref (no per-mousemove re-render). Export
  markdown preview is rendered with `markdown-it` (`html:false`, so safe);
  Copy/Download always emit the raw markdown.
- **Keyboard shortcuts** live in one window `keydown` effect in `App.tsx`:
  `j`/`k` next/prev file, `n`/`p` next/prev comment (reading order via
  `orderedCommentIds`, stepping from `activeComment`), `e` export, `r` reload,
  `?` help overlay. The handler bails when the target is an input/textarea/select
  or a modifier is held, and while a modal is open, so it never fights the
  composer or the browser. The `?` header button opens the same overlay.

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
- Persisted UI prefs (panel widths) go in `localStorage` under `lr.*` keys.
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
