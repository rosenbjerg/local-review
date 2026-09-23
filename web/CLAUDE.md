# web/ — the React frontend

Strict TypeScript, React 18 with the React Compiler, Vite 8, bun. Root-level notes (commands,
cross-cutting rules, gotchas) are in the repo's `CLAUDE.md`; the API contract is in
`internal/CLAUDE.md`.

## Commands

```sh
bun install
bun run build     # tsc -b, then vite → dist (embedded by go:embed)
bun run dev       # :5173, /api proxied to 127.0.0.1:7777 (a running local-review)
bun run lint      # ESLint: rules-of-hooks + React Compiler rule (see ../COMPILER.md)
bun run test      # vitest, jsdom + Testing Library (vitest.config.ts, vitest.setup.ts)

# from the repo root — the React Compiler still compiles every file (CI runs --check)
bun scripts/compilercheck.ts [--check]
```

Test files are excluded from the build tsconfig and lint. Hook logic is tested via `renderHook`
with a mocked `api`.

## Layout

```
src/
  App.tsx                composition root: wires the hooks, owns pure view state (selected/opened files,
                         modal flags, comment sort + filter), derives allFiles / sortedComments / commentsByPath
  useReview.ts           data layer: repo/branch/diff-scope selection, create + resume, diff and SSE refetches,
                         the reqSeq stale-response guard, reviewed marks, summary
  useCommentActions.ts   optimistic comment/reply CRUD; identity-stable handlers
  useUndoableDelete.ts   thread deletes held for UNDO_MS behind UndoToast before they reach the API
  useJump.ts             comment/file navigation: activeComment, expand signals, jumpTo
  scrollTo.ts            the one way to scroll the diff column: re-aims every frame, lands long jumps
  useActiveFile.ts       scroll-spy over the diff column + suppress()
  usePanelResize.ts      the two pane widths + open flags; a drag writes grid-template-columns via ref
  useKeyboardShortcuts.ts  the one window keydown listener
  useOccurrenceHighlight.ts  select a word → light up its occurrences (CSS Custom Highlight API)
  useUnseenActivity.ts   agent comments/replies that arrived while the tab was hidden
  useCommentRefs.ts      delegated click/hover/focus for #<id> links
  useFocusTrap.ts  useListNavigation.ts (shared by Combobox, FontCombobox and AddFileModal)
  api.ts  types.ts  util.ts  storage.ts (typed localStorage, the lr.* keys)  time.ts
  highlight.ts           Shiki, JS regex engine, all languages lazy      mermaid.ts  ```mermaid → SVG
  prompts.ts             agent prompt templates ({{placeholder}}) + renderPrompt
  commentSort.ts  commentFilter.ts  commentTurn.ts  commentsByPath.ts  commentRef.ts  reviewNav.ts
  wordDiff.ts            intra-line diff        hunkGaps.ts  expandable hidden regions
  diffRows.ts            the diff table as data: buildRows + planRows       diffStats.ts  occurrences.ts
  mergeFiles.ts          carries a FileDiff's identity across a refetch that didn't change it
  fileHeight.ts          LARGE_FILE_LINES + what a LazyFile placeholder is worth
  theme.ts               theme registry + store (owns <html data-theme>)   themes/  hand-written Shiki themes
  fonts.ts               font-family override store (owns the inline --font-mono/--font-sans on <html>)
  localFonts.ts          Local Font Access store: permission state, the machine's families, a family's files as FontFaces
  fontNames.ts           name matching (normalizeName, nearestFamily, findFamily)   sfnt.ts  OS/2 + fvar → FontFace descriptors
  fonts/                 bundled woff2 + licences (Inter, Monaspace Neon, JetBrains Mono)
  styles.css             all CSS; the per-theme token blocks at the top
  components/
    TopBar               logo / selection breadcrumb + range phrase / review actions; equal-width ends
    FileExplorer         file tree, collapse, reviewed toggles, +/- counts, progress bar
    DiffView             per-file diff: fetches source, tokenizes, owns view/selection/reveal state, draws planRows
    FileHeader  MediaView  MarkdownView  LazyFile  FindBar
    CommentThread  CommentsPanel  CommentPreview  CommentRefPopover  ReviewSummary  CommentComposer  FileComments
    Modal + ExportModal  AgentPromptsModal  AddFileModal  SettingsModal  ResetConfirmModal
    UndoToast  SearchInput  Combobox  PaneRail  ViewToggle  CopyButton  ThemePicker  FontPicker  FontCombobox
    ErrorBoundary  EmptyState  icons
    small primitives: Chevron, CommentCount, DiffStatBadge, AnchorBadge, MetaTimestamps, HighlightMatch, Markdown
```

## Data layer (`useReview`)

- Two view axes, not review identity: `from` (`all` or a sha, inclusive) and `uncommitted` +
  `unstaged`. `effectiveUncommitted = uncommitted && headIsCurrent`; `side` derives from the pair and
  is threaded into add-comment / set-reviewed / file / blob and into `DiffView`/`MediaView`.
- **The reviewer picks a `Side`, not two booleans.** `changeSide` is the one place it becomes the
  two axes and writes the per-repo pref (`lr.diffViewByRepo`). `from` is per-session (a sha belongs
  to one head's history). The restore lands in the branch-load `.then`, same update as `head` — the
  "head isn't checked out" guard would otherwise wipe it. Only the reviewer's pick writes the pref.
- **A base resolving to head takes the committed side away, not the base** (`baseIsHead`):
  `merge-base(head, head)` is head, so Committed is empty while the uncommitted sides still mean
  "just my uncommitted work". `effectiveUncommitted` is forced on and `TopBar` dims Committed with a
  reason. `baseOptions` offers head only while an uncommitted side shows; `changeHead` drops a base
  equal to the new head. Gated on `from === "all"`. `useReview.test.ts`, `topBar.test.tsx`.
- **Dropping a picked `from` needs proof.** Both commit fetches pass `COMMIT_LIMIT` (50); a sha
  missing from the refetched list is gone only when the list is shorter than the cap
  (`fromWasRemoved`) — a longer branch slides the window on every commit. `fromOptions` appends a kept
  pick the list lacks, or `Combobox` renders blank.
- `branchesLoaded` tells "still loading" from "a repo with no commits". Branches are normalized from
  `null` at every ingest point.
- **A no-op SSE ping must not churn state identity**: `keepIfSame`/`keepIfSameSet` keep the previous
  value when the new one is structurally equal. Downstream memos are keyed on identity.
- **The file list holds identity per file, not per list** (`mergeFiles.ts`). A `diff` ping does not
  mean *this* file moved: the poller fires on mtime, so one edit — or a save to identical bytes —
  used to re-identify every file in the diff, re-rendering every mounted card and re-running Shiki
  over its deleted lines. `mergeFiles` keeps a file's object when its JSON is unchanged, and the
  array itself when they all were. Keyed on **both** paths: a rename's old path is routinely another
  file's new path. That identity is exact (same object ⟺ equal content), which is what keeps
  `DiffView`'s `contentKey` invariant below honest. `mergeFiles.test.ts`, `useReview.test.ts`.
- SSE: the three ping kinds nest. Refetch the review on any ping; the diff on `diff` **or** `refs`;
  branches and commits on `refs` alone — the pickers read refs, a plain edit moves none, and
  refetching them on every ping cost five git processes only for `keepIfSame` to discard both.
  Refetch params come from a ref (the effect is keyed on `review.id`). Git-derived results are gated
  on the shared `reqSeq`; the review half is **not** (fetched by id). A hidden tab takes the review
  but defers the rest (`missedDiff`/`missedRefs`, replayed on visible, each carrying only what was
  actually missed). The focus/visibility refetch is the fallback when the stream isn't `OPEN`, and
  asks for everything — a dead stream may have missed anything. A `from` sha rebased away resets to
  `all`, which rides on the `refs` ping a rebase produces.
- `setSummary` trims, matching the server, so the optimistic value equals the refetched one.
- `App`'s `hasReviewState` is the one predicate behind both `canReset` and `requestReset`'s no-op
  guard, so the toolbar can't enable a dialog that then declines to do anything.
- `review.annotationError` (repo or head unreadable server-side) shows a banner saying staleness
  isn't being checked; the stored state is rendered as-is.
- `relativeDay` (`time.ts`) parses the picker's `YYYY-MM-DD` as **local** time — `Date("2026-09-02")`
  is UTC midnight, the day before anywhere west of Greenwich. `time.test.ts`.

## Files and cards

- A file the branch didn't change can carry comments: `AddFileModal` (over `GET /api/files`) adds a
  path to `openedFiles`, and `App`'s `allFiles` synthesizes an `unchanged` `FileDiff` for it — and
  for any comment whose path isn't in the diff, which is what makes agent comments on unchanged files
  visible and restores opened files after reload (`openedFiles` is session state). Synthetic cards are
  excluded from the reviewed-progress denominator; the topbar count and the explorer's `N/M` count
  the same population (`changedFiles`).
- **Diff/source consistency.** Hunks (`/api/diff`) and source (`/api/file`) must describe the same
  side. Nothing writes `files` for a selection the user left (`reqSeq`), and `DiffView`'s
  `contentKey` names repo + head + `side` **and the hunks** — on the worktree side the hunks are the
  only part that moves when a file changes on disk, so dropping them would leave `source` set and the
  fetch effect skipping it. Cards are keyed by path and `LazyFile` never unmounts them. A no-op
  refetch keeps the source.
  `diffView.test.tsx`.
- `/api/file` returns the side content came from; `DiffView` notes a `worktree` substitution on
  the card, and turns a 404 into a "No longer in `<side>`" note. `MediaView`'s `<img>` sides fall
  back to the same note via `onError`, keyed on src + `file.status`.
- A rename-moved comment groups and renders under its `currentFilePath` (`effectivePath` in
  `types.ts`, used by `commentsByPath`, the sorts, the filter, the explorer and `useJump`) and badges
  "moved from `<old>`". Group, render and **navigate** by that, never by the stored path — a jump
  naming the stored path scrolls to no card and expands no `DiffView`.
- Hunkless files (R100, mode-only, empty add/delete) get `noHunksNote` in Changed view. Files over
  `LARGE_FILE_LINES` (500) start collapsed, as do ones the backend flagged `generated` (lockfiles,
  `dist/`, snapshots — `internal/git/generated.go`), which carry a `generated` badge on the file
  header saying why. Nothing else changes: they stay in the tree, in the reviewed denominator and in
  `j`/`k`, and they still take comments. **`estFileHeight` has to agree with whatever starts a card
  collapsed** — a placeholder sized for an open card leaves every card below it jumping when this one
  mounts as a 44px header.
- **Never `scrollIntoView` the diff column.** `scrollTo.ts` owns every scroll into it — `useJump`,
  `App`'s `openFile` and mark-and-advance, and `useOccurrenceHighlight`'s find-step. A card mounts
  lazily and then grows again when its source lands and the gap rows appear, so a one-shot scroll
  animates to an offset that is stale before it arrives, and the further the jump the worse, because
  everything passed on the way mounts behind it. `scrollToAim` re-reads the target every frame; any
  frame that finds it further than `FAR_SCREENS` away skips to `APPROACH_SCREENS` short of it and
  animates only the arrival, which keeps the motion while leaving the cards behind it placeholders —
  the trip is what costs, since every card it passes mounts (a fetch and a tokenize) and never
  unmounts again. That test is per frame, not per target, so it also catches the case where the
  target is thrown screens away mid-flight — mark-and-advance collapsing the card being left. It
  keeps correcting for `SCROLL_MS` after arriving, and it holds on a `provisional`
  aim — the card standing in for a thread that hasn't mounted — for up to `MAX_WAIT`, then glides to
  the thread once it appears and calls `onTarget` so the caller can re-suppress the scroll-spy for a
  window that started late. One scroll per column: a new one cancels the one running, which is what
  keeps find-next from being yanked back by a jump still settling (FindBar is outside the column, so
  its clicks never reach the gesture cancel). Any wheel, touch or pointer gesture on the column
  cancels it too. `scrollTo.test.ts`.
- **A jump sets `selectedFile` itself.** `useActiveFile` cannot report the landing: a far jump's first
  scroll event falls inside its own suppression window, so leaning on the spy left mark-reviewed and
  j/k pointing at the file being left.
- `fileHeight.ts` is what an unmounted card is worth, and the `LARGE_FILE_LINES` threshold that
  starts one collapsed. The placeholder holds the scroll position of everything below it and a jump
  past it aims through it, so it counts what Changed view renders: a row per diff line, **one**
  metadata row per hunk (the gap bar carries the `@@` header, so the two never stack) plus the
  trailing gap, and open threads. Rows are sized off the live `--mono-offset` — the code size is a
  user setting spanning -4…+8px, so a fixed row height is out by two thirds at the ends of it.
  `fileHeight.test.ts` reads `styles.css` to pin `MONO_BASE_PX`/`MONO_LINE_RATIO` against it. A
  hunkless entry in the diff (R100 rename, mode-only, empty add) renders one note row; only a
  synthetic `unchanged` card opens in Full view on a file of unknown length.
- Images render as a before/after pair via `/api/blob`; SVG is text with a Text/Image toggle; `.md`
  gets Code/Rendered (`MarkdownView`). Both take line-0 file comments; `FileComments` owns the
  composer state.
- The view says what it compares: a changed-file count + `+N -M` badge, with `compareTitle` naming
  both resolved ends. Nothing else — every other readout restated a control beside it.

## The diff table

- `diffRows.ts` plans it as data: `buildRows` (mode, source, hunks, reveals → rows) and `planRows`
  (shading, thread placement, composer position, the file-comment and leftover buckets). `DiffView`
  only draws. Threads hang by **effective end** line; `leftover` is what the walk didn't render;
  composer inline vs trailing are mutually exclusive; the composer waits for `dragging`.
  `diffRows.test.ts`.
- `hunkGaps.ts` derives the hidden regions from the `@@` headers, not the hunk lines (a pure deletion
  has none); one unparseable header yields no gaps at all. Each gap carries `delta`
  (`oldLine = newLine + delta`). git writes a zero-length side as the line **before** the change.
  The bar keeps `row-hunk` (tells occurrence highlighting it's metadata). Reveals reset with
  `contentKey`.
- `wordDiff.ts`: tokenize, trim shared head/tail (keeps the quadratic LCS off the common case), LCS
  the middles. Declines on `MAX_CHARS`/`MAX_TOKENS`, below `MIN_SIMILARITY`, or a change spanning
  both whole lines. Ranges keyed by line number (old for deletions, new for additions).
  `splitPieces` cuts Shiki segments at range boundaries. Marks clear on `.row-selected` **and**
  `.row-comment-active`. `wordDiff.test.ts`.
- Shiki (`highlight.ts`): JS regex engine (oniguruma's wasm failed to load), one Shiki theme per UI
  theme registered up front, grammars lazy per file. Whole file tokenized once; deleted lines
  per-line; files > 2000 lines skip highlighting. Both tokenize effects list the theme in deps.
- **`EXT_EXTRA` is where an extension Shiki doesn't know names the language it really is** —
  `.xcstrings` is JSON, `.plist` and `.svg` are XML. A value Shiki doesn't recognise fails silently:
  `langForPath` returns null and the file renders as plain text, indistinguishable from "no grammar
  exists". `highlight.test.ts` resolves every value against the alias map, so a typo or a Shiki
  upgrade that renames a language fails there. `internal/export`'s `extToLang` is a separate map
  serving markdown fences; the two are deliberately independent, but an alias worth adding is
  usually worth adding to both, or a snippet exports unfenced while the UI colours it.
- Mermaid (`mermaid.ts`): a second pass after highlighting, only the `language-mermaid` fence,
  lazy import. Load-bearing: `htmlLabels: false` (else awaits `<img>` loads from untrusted source),
  `securityLevel: 'strict'`, `suppressErrorRendering: true`. `useMaxWidth: false` per diagram type;
  re-initializes when the theme differs; cache keyed by source, skipped across a mid-render switch.
- Occurrence highlighting (`useOccurrenceHighlight`, rules in `occurrences.ts`): CSS Custom
  Highlight API, so no DOM and no cap. Case-sensitive; whole-word only for identifier-shaped terms;
  the selection must start and end in one `tr:not(.row-hunk) > td.line-content`; `.sign` is excluded
  from the text-node walk; triple-click ignored. **The `MutationObserver` repaint is load-bearing**
  (Shiki swaps text nodes for spans). Exits: click away, origin card scrolled out, Escape — which must
  `removeAllRanges()`. `FindBar` sits **below** the scroller (above would jump the diff) and every
  control `preventDefault`s mousedown, or the click collapses the selection it acts on. Changed view
  offers "Search full file" via `data-view-mode` + `showFullSignal`.

## Performance: nothing may cost O(files scrolled past)

`LazyFile` mounts a card once and never unmounts it, so anything per-render that scales with the
mounted set reads as "it gets slow around file 70". `diffViewMemo.test.tsx`.
- Per-file work in `FileExplorer` (unmemoized, re-rendered by the scroll-spy) stays behind `useMemo`.
- `useActiveFile` scans `root.children` for `#file-<path>` anchors — never a subtree query.
- `.file-body` carries `content-visibility: auto` — not `.file`, which would clip the sticky header.
- `DiffView` is `memo`ised with `samePropsExceptComments`: every prop by identity except `comments`
  by value. `commentsByPath` shares one empty array; `useCommentActions` returns one memoized
  object; `onToggleReviewed` takes the path so `App` can pass one shared handler. **A prop that
  takes a new identity each render silently disables the whole thing** — and the compiler is what
  keeps the rest of them stable, so a bailout in `useReview` or `useCommentActions` breaks this
  boundary without breaking anything visible. `diffViewMemo.test.tsx` pins the comparator and the
  handler identities; `scripts/compilercheck.ts` pins the compiler.
- `App` keys the comment-id `Set` on the joined id list, not the array, or every ping re-runs
  markdown-it + Shiki in every thread.

## Comments pane

- `commentSort.ts` is the one ordering authority and feeds both the pane and `orderedCommentIds`,
  so `n`/`p` step what's on screen. Comments group by file in every sort (`file` / `started` /
  `activity`); resolved sinks within its file, never out of its group; a file sits where its
  first-listed comment would in a flat sort; the group key is read **after** the within-file sort;
  `id` is the mandatory tie-break (second-granular timestamps). `commentSort.test.ts`.
- `commentFilter.ts`: status (open / resolved / outdated / awaiting you / awaiting agent), type,
  root author, free-text `query`. Not persisted; resets on `review.id`. Author choices come from the
  review's own comments (`authorsOf`, roots only). `query` matches the whole thread (replies too)
  and both paths; `queryNeedle` is the only normalizer, shared with `HighlightMatch`; the body is
  deliberately not marked. Everything else that counts comments ignores the filter.
  `commentsPanel.test.tsx`.
- `commentTurn.ts`: whose move, by who spoke last (highest reply id, else the root). Resolved beats
  turn; outdated doesn't. Shown as a left edge on the item, the `awaitingYou` header count (whole
  review, doubles as a filter, stays rendered at zero while on), and the two status values.
- `#<id>` links (`commentRef.ts`): a markdown-it **core rule** over text tokens (skips code fences,
  inline code and existing links), gated on the review's ids via `Markdown`'s `commentIds` prop —
  only comment and reply bodies pass it. Interaction is delegated (`useCommentRefs`): click →
  `jumpTo`; hover 250ms / focus → `CommentRefPopover` (`pointer-events: none`, flip/clamp from the
  anchor rect, dismissed on **any** scroll). `CommentPreview` never linkifies, so a preview can't
  spawn one.
- `Markdown` runs markdown-it with `html: false` everywhere (comment bodies, `.md` files, the export
  preview) — bodies come from API agents, so raw HTML is never rendered.
- **A thread delete is deferred, not reversed** (`useUndoableDelete`). One click hides the thread
  (App filters `hidden` out of `comments`, so every count and list agrees) and `UndoToast` offers
  Undo for `UNDO_MS`; the `DELETE` goes out when the window closes, another delete starts, the review
  changes, or on `pagehide` (`keepalive`). Nothing on the server has to un-delete, so ids, `#<id>`
  links, replies and anchors come back exactly as they were. The cost: other tabs and agents still
  see the thread during the window. A 404 on commit counts as deleted (a reset got there first).
  Replies still delete at once. `remove` is `commentActions.onDelete`, so it must keep its identity
  — the review-change flush reads it through a ref for that reason. `useUndoableDelete.test.ts`.
- `useUnseenActivity`: non-reviewer comments/replies arriving while hidden count into the tab title.
  Whatever is on the review at the first read is history; `seen` re-primes on `review.id`.

## Shell and chrome

- Keyboard shortcuts (`useKeyboardShortcuts.ts`): `j`/`k` files, `n`/`p` comments, `v` mark
  reviewed + jump to `nextUnreviewed`, `e` export, `r` reload, `/` file search (opens the pane
  first, focuses next frame), `?` settings, `[`/`]` panes, `Enter`/`Shift+Enter` occurrence
  matches, `Escape` clears the highlight. Bails on inputs, modifiers, open modals (except `?`), and
  the whole `.composer` subtree — which is why `CommentComposer` binds ⌘/Ctrl+Enter and Escape on its
  **root**. `useKeyboardShortcuts.test.ts`, `commentComposer.test.tsx`.
- `SettingsModal` is one grid for every label/control pair (`.settings-form`, rows set to
  `display: contents` so the components keep their wrapper while the grid gets their children) — each
  row laying itself out was what left the labels and fields ragged. The two shortcut tables sit side
  by side (`.settings-cols`); stacked they were most of the dialog's height.
- Modals use the `Modal` shell: backdrop, `useFocusTrap`, Escape, `title` (names the dialog via a
  `useId`'d h2), `controls`, `actions`, `close` (`button` | `autofocus` | `none`). A backdrop click is
  a mousedown **and** mouseup on the backdrop (`modal.test.tsx`). Global shortcuts bail while any
  modal is open (`modalOpen`).
- Either side pane collapses to a 28px `PaneRail`, never to zero. `usePanelResize` owns the open
  flags with the widths; a collapsed pane keeps its stored width and its resizer goes inert
  (`resizer-inert`, `tabIndex -1`). Both persist (`lr.leftOpen`/`lr.rightOpen`).
- `Combobox` is a searchable select — its value is always one of its options; `rangePreview` draws
  the from picker as a timeline. `FontCombobox` is the free-text sibling, not a flag on it: a font
  name is whatever you type, so the two disagree about what the input holds and what blur means.
  They share `useListNavigation` and `useAnchoredList`, which are the halves that generalise.
- `useAnchoredList` positions a dropdown against the **viewport**, which is what a list inside a
  scrolling container needs — an absolute one is clipped by the scroller. `Combobox` takes it behind
  `floating`; the topbar's pickers have no scroller over them and leave it off.
  `ViewToggle` is data-driven; a per-option `disabled` carries a `title` saying why.
  `SearchInput`'s Escape clears a non-empty field, blurs or bubbles (`emptyEscape`) an empty one.
- `TopBar`: three tracks with equal-width ends (`flex: 1 1 0`) so the selection centres on the bar;
  the range phrase is `from` the commit picker `to` the side toggle. Icon-only buttons carry a
  `title` **and** an `aria-label`.
- Agent prompts (`prompts.ts`) are templates: `{{origin}}`/`{{reviewId}}`/`{{headRef}}`/`{{baseRef}}`/
  `{{author}}` are substituted by `renderPrompt` at **copy** time — never on open, or a saved prompt
  bakes one review's ids in. Unknown tokens stay standing. Save refuses blank and `readPromptOverride`
  reads blank as absent. Saved per repo (`lr.agentPromptsByRepo`); the modal is keyed on `repo`. One
  prompt per review focus (Correctness keeps the `review` key), one focus per run; authors stay
  distinct. `agentPromptsModal.test.tsx`, `prompts.test.ts`.
- `ErrorBoundary` is the only class component: shows the throw, a reload, and a "clear the lr.*
  keys" escape hatch.

## Themes

- Every color is a `--*` token; a theme is a `:root[data-theme="<id>"]` block restating **all** of
  them plus a `THEMES` entry naming its Shiki and mermaid themes. `themeBlocks.test.ts` parses
  `styles.css` and fails if a block skips a token (there's no fallback — `<html>` inherits nothing).
- `theme.ts` is a module store (`useSyncExternalStore`) and owns `<html data-theme>`. The stored value
  is a **preference**: `system` (GitHub Dark/Light by `prefers-color-scheme`, followed live) or a theme
  id. The picker shows the preference (`useThemePref`); renderers read the resolved theme (`useTheme`).
  No `matchMedia` resolves dark. The default block also matches bare `:root`; `readStoredPref` trusts
  only a known id.
- The preference is **per repo** (`lr.themeByRepo`), with `lr.theme` as the default and migration.
  `setThemeRepo` is called from an `App` effect on `repo`; the store seeds from `lr.repo` at import so
  the first paint is right, and `setThemeRepo("")` is a no-op.
- Rendered colors are keyed on the theme: `DiffView`'s tokenize effects and `Markdown`'s highlight +
  mermaid passes list it in deps. Word marks and `--sel-bg` are hand-picked per theme.
- **A theme block answers to any element carrying `data-theme`, not only `:root`**, which is how the
  picker paints each row in the theme it names — the colours are the theme's own rather than a palette
  copied into TypeScript. Only base tokens follow a row: the derived ones (`--accent-soft` and
  friends) resolve where they are declared, on `:root`. `themeBlocks.test.ts` fails if a block loses
  its `.theme-option` selector, which would silently flatten every row.
- A Shiki theme is either one Shiki bundles (`@shikijs/themes`) or hand-written under `themes/` from the
  editor's own scheme file; a dark/light pair can share **one** scope map. Check a hand-written one by
  tokenizing samples in node. `--font-mono` is a per-theme token: a theme borrowing an editor's colors
  borrows its code face, and one with no face of its own borrows JetBrains Mono. `Theme.mono` restates
  that face for the font picker's placeholder, and `themeBlocks.test.ts` fails if the two drift.

## Fonts

- A theme's face is the first entry of its `--font-mono`; the tail every theme shares lives once as
  `--mono-fallback` (`--sans-fallback` for `--font-sans`), so an override names a face and appends the
  var rather than restating the stack.
- `fonts.ts` is a module store like `theme.ts`, but it paints **inline custom properties on `<html>`** —
  an inline style is what outranks a `:root[data-theme=…]` block. Clearing one must `removeProperty`,
  never write the theme's current face back inline, or the next theme switch keeps the old face.
- The cascade is per field: this repo's pick (`lr.fontsByRepo`) over the default across repos
  (`lr.fonts`) over the theme's face. A field holds the repo's **own** pick and its placeholder names
  what an empty one falls back to, so inheriting and picking the same value stay distinguishable.
  **Set as default for all repos** writes `lr.fonts` and empties `lr.fontsByRepo` — every repo's saved
  pick goes, this one's included, so they all follow the new default instead of a stale duplicate.
- Sizes are an **offset** from the app's own, not an absolute: `--mono-offset` feeds
  `--font-size-mono`, `--sans-offset` feeds the whole `--text-*` scale, and the zero must carry its
  unit — a bare `0` makes the calc invalid and takes every size using it down at once. Clamped to
  `MIN_FONT_OFFSET`…`MAX_FONT_OFFSET` on read, not just on input, so a hand-edited store can't
  produce a 200px UI. The range is deliberately wider than most people will want in either direction:
  at the floor the scale's smallest step is down to 6px, which is the reader's call to make.
- **The two axes split by surface, not by face.** The family override follows the token, so a mono
  face lands everywhere monospaced. The mono *size* reaches code only — the diff (its hunk headers
  included, at `--font-size-mono - 1px`), the export textarea and preview, `.markdown-body pre code`.
  Mono-faced chrome like file paths and `kbd` sizes off the interface scale: wanting a bigger diff
  isn't wanting a bigger file tree.
- **Form controls inherit the face globally** (`button, input, select, textarea { font-family: inherit }`
  in `styles.css`). The UA gives them its own font, which is how the file tree — names inside a
  `<button>` — once ignored the interface font while everything around it followed it. A control
  wanting mono says `var(--font-mono)` itself; none needs a per-rule `inherit`.
- An offset of 0 is a **pick**, not an absence: it means "this repo stays put though the default across
  repos moved". Reset, not a zero, is how a field goes back to inheriting — which is why the family
  fields show the repo's own pick and the size fields show the effective one.
- **`CSS.supports` answers syntax, never availability** — it says yes to Consolas on a Mac, and its
  one-argument form wants a whole declaration (`"font-family: Consolas"`), not a bare name. The
  suggestion list is probed instead (`isFamilyAvailable`): measure the probe string on a canvas in
  `"<face>", <generic>` against that generic alone, across all three generics because one can
  coincide by chance. Bundled faces and generic keywords skip the probe — a bundled face the current
  theme isn't using may not be loaded yet and would read as missing. One context for every probe
  there will be, and a verdict cached per family. A typed face that isn't installed gets a warning
  under the field rather than being refused.
- **A face the browser blocks by name can still arrive as bytes** (`localFonts.ts`). Brave lets a page
  use only the local fonts that ship with the OS (its `brave_font_whitelist`) and Safari hides
  user-installed fonts outright, so the probe truthfully calls SF Pro or a Nerd Font missing on a
  machine that has it. Both take a web font unconditionally, and the Local Font Access API
  (`queryLocalFonts`, Chromium only) hands back every installed file's bytes behind a permission
  prompt: `ensureFace` registers a family's files as `FontFace`s from those bytes, weight, slant and
  width read out of each file's `OS/2`/`fvar` (`sfnt.ts`) so bold and italic land on the right file.
  Rules: nothing about it exists in a browser without the API — the note then says "isn't available
  to this browser", which is as much as Firefox or Safari lets us know. The prompt needs a click and
  Chromium consumes the activation, so the ask is the suggestion under the field at the moment it is
  the answer, never a settings row; once granted no activation is needed and the list loads on its
  own (the permission persists per origin, port included). Only the picked family is ever loaded, never the list — an 18-file family is
  megabytes. A bundled face is never asked for, or the machine's copy would be registered over the
  shipped one; `isBundledFace` is also why the field doesn't probe one. A no is not remembered by
  either store, so a grant made later in site settings (`PermissionStatus.onchange`) reaches the
  pick, and the probe's cached verdict is dropped when the face lands — the warning would otherwise
  outlive the fix. `localFonts.test.ts`, `fontsLocal.test.ts`, `fontPicker.test.tsx`,
  `fontPickerLocal.test.tsx`, `sfnt.test.ts`.
- **Ligatures are one switch, and it knows the face.** `calt` is where JetBrains Mono keeps its
  ligatures (it has no `liga` table at all), as do Fira Code and the rest — but in Monaspace `calt` is
  texture healing, and its ligatures are opt-in stylistic sets. So off omits `"calt" 0` for a
  Monaspace face, and on adds `ss01`–`ss05`, `ss07`–`ss10`, without which Monaspace shows eight
  ligatures where JetBrains Mono shows its whole set — the same code rendering differently per theme.
  Both branches ask `ligatureSetsFor` the one question — does this face keep its ligatures in
  addressable sets — rather than testing for Monaspace twice.
  `font-feature-settings` is the only property used for it: its precedence against `font-variant-*` is
  defined but easily misremembered, so the two are never mixed, and nothing on the code surfaces uses
  the latter. Ligatures break at element boundaries anyway, so a `=>` split by a word-diff range or a
  Shiki token renders unligated whatever the switch says.
- **`fontFeatures.ts` is generated, and it is the only place a set's meaning is recorded.**
  `bun scripts/fontfeatures.ts` decodes the bundled WOFF2 (directory → brotli → `GSUB`, `name`) and
  reads each `ss##`/`cv##` UI name out of its `FeatureParams`, so "ss03 is Arrows" comes from
  Monaspace rather than from anyone's memory, and a font upgrade that renumbers a set fails CI
  (`--check`) instead of mislabelling a checkbox. Only bundled faces are in it: nothing in the
  browser reports a font's feature table — `document.fonts` and `FontFace` give back only what you
  set — and the metric probe behind `isFamilyAvailable` has no analogue here, because canvas can't
  carry `font-feature-settings` and monospace ligatures preserve their advance width anyway. Reading
  an installed face would take the bytes `localFonts.ts` now gets from the Local Font Access API,
  which the same parser would take; it isn't done.
- **The per-group checkboxes silence `liga`, and only once one is off.** Monaspace's `liga` holds
  lookups 38-46, disjoint from every stylistic set's (48-144) and shared with none of them, so it is
  a ninth source of ligatures the sets neither contain nor suppress — left on, it goes on drawing an
  arrow after Arrows is unchecked. So `featuresFor` adds `"liga" 0` exactly when a group is off:
  every group on emits the same value it always did, and an untouched switch cannot regress. Every
  group off emits the ligatures-off value rather than an empty one, or the face's own defaults would
  show through what reads as fully off. The groups render only while the switch is on — they refine
  it, they are not a second route to the same off — and a face with no readable table gets a sentence
  saying its ligatures move together instead of an empty row. `ligatureSetsOff` stores what is *off*,
  so a set added by a font upgrade is on by default, and the tags are Monaspace's: a pick sits dormant
  in storage under another face and comes back, because only a set the face's own table names is
  applied.
- **`--code-features` goes wherever `--font-mono` goes, and nowhere else.** `font-feature-settings`
  inherits, and `ss01`–`ss10` are private to a face: the list composed for Monaspace's ligatures is,
  in Inter, `ss05` circled and `ss06` squared characters. `.diff` sets the token on the table, so it
  reached the inline threads and composer nested in it and drew a ring around every capital and digit
  in a comment. `.thread-cell` resets it to `normal`, and the two `code` rules set it beside the face
  rather than only on `pre code` — inline code used to ligate in a thread and not in the panel. Any
  new rule that puts a face back inside a code surface has to put the features back too.
- **`fonts.ts` subscribes to `theme.ts`** (`subscribeTheme`) — the one edge between the two stores.
  With no family override the code face is the theme's, so a theme switch changes which features
  apply. It repaints without `commit`: no `FontState` moves, so the React consumers stay put.
- The face pickers are `FontCombobox`, each row drawn in the face it names (a sample of `0O1lI` for
  code, where telling those apart is the job). Three things it has to get right: the list is
  `position: fixed` from the input's rect, because the settings body scrolls and would clip an
  absolute one — the modal's entrance animation sets no lasting transform, so `fixed` still means the
  viewport; filtering follows what has been **typed since opening**, not the value, or reopening
  after a pick filters the list down to the face already chosen; and the close-on-scroll listener
  exempts scrolls originating inside the list, or following the keyboard selection closes it.
  Clearing is a row naming the fallback, not an empty field — empty reads as "nothing" when it means
  "whatever the theme brings". Rows are grouped into what ships with the app and what this machine
  turned out to have, and the list closes with a line saying anything else installed can be typed:
  the list is a probe of a few dozen guessed names, not the set of choices. With font access granted
  the machine's own families (`known`) join that group, but only as matches for what is typed — two
  hundred rows is not a list — and while access could still be asked for, the closing line offers
  it, on mousedown like a row, since a click would land after the blur that closes the list.
  `fontCombobox.test.tsx`.
- **Font names go wrong at the spacing**, not the spelling — the family really is
  `JetBrainsMono Nerd Font`, and CSS resolves neither a near miss nor a hint about one. So the filter
  matches on `normalizeName` (lowercased, non-alphanumerics dropped), which finds the face from the
  spacing anyone would type, and `nearestFamily` offers the closest installed name under a face the
  probe says isn't there — prefix either way, else an edit distance inside a third of the length.
- A custom property takes almost any token sequence, so an invalid family isn't refused on the way in:
  it makes every `font-family: var(--font-mono)` invalid at computed-value time and drops the whole app
  to the browser's default serif. `normalizeFamily` gates the paint (`CSS.supports` where it exists)
  while the store keeps what was typed, so an unfinished quote doesn't clear the field mid-edit.
  `fonts.test.ts`, `settingsModal.test.tsx`.

## CSS conventions (`styles.css`)

- Colors only via tokens; a new token needs a value in every theme block. Derived tokens (`-soft`
  tints, `--elev-1`/`--elev-2`, `--accent-hover`, `--accent-ring`, `--control-border`, `--on-accent`,
  `--backdrop`, `--checker-*`, `--font-sans`, `--mono-fallback`, `--sans-fallback`,
  `--code-features`) live once in the shared `:root`. Radii from
  `--radius-xs|sm|md|lg|pill`.
- **Type sizes only via the scale** — `--text-2xs|xs|sm|md|base|lg|xl` for the interface,
  `--font-size-mono` inside code surfaces — never a raw px, which wouldn't move with the reader's size
  offset and would drift out of step with everything around it. `em` inside `.markdown-body` is fine:
  it inherits from a scale step.
- Status/type marks are tinted `-soft` fills with transparent borders, not outlines. A thread is a
  raised card drawn by fills alone (`--bg-elev` / `--bg-hover` meta / `--bg` replies), no borders.
- A changed row is marked by recoloring the 1px gutter hairline (`--add-border`/`--del-border`) on
  the gutter's **right** edge (`.row-commented` owns the left). The `+`/`-` sign stays muted grey;
  `.sign` is `content-box`. Table `line-height` is one value for the whole table, never per row
  (`--font-size-mono` x 1.52 — the 19px it always was, at the default size).
- **Nothing may reset padding on a bare `.diff td`** — (0,1,1) beats every cell rule, silently.
  The same trap is live one level down: `.thread-row > td { padding: 0 }` voids `.thread-cell`'s
  padding, left alone because removing it would indent every inline thread.
- The resizer's 6px track is the only divider between panes; the pane columns carry no border.
- Entrance motion only on surfaces the reviewer summoned (modal, dropdown, popover, composer);
  never on threads or rows, which re-render on every ping.
- Checkboxes are drawn (`appearance: none`, tick as `::after` with its own `box-sizing`); fill is
  `--accent`, not `--success`. Both side panes reveal per-row marks on **pane** hover via `opacity`;
  the explorer's rule needs `.explorer-list` or it loses to `:not(:checked)`.
- Fonts: vendored woff2 under `src/fonts`, `url()`'d from the `@font-face` block; woff2 only, never
  subsetted, `font-display: swap`.
- Persisted prefs go under `lr.*` via `storage.ts`; validate on read (`isCommentSort`, `isThemePref`,
  `normalizeDiffView`, `normalizeFamily`) so a stale value falls back.

## Gotchas

- `bunfig.toml`'s `[run] bun = true` is load-bearing: vite/vitest/tsc/eslint ship `#!/usr/bin/env
  node` bins, which bun honors by default, and CI installs no Node.
- The React Compiler runs unconditionally via `@rolldown/plugin-babel` + `reactCompilerPreset`
  (`@vitejs/plugin-react` has no `babel` option since v6 — see `../COMPILER.md`). Intentional
  partial-dep effects surface as `exhaustive-deps` warnings (five of them), never inline disables.
- **A file the compiler can't lower is skipped in silence** — the build passes, lint passes, and
  the file just loses its memoization. `DiffView`, `FileExplorer`, `useReview` and
  `useCommentActions` were all bailing out, which is why `samePropsExceptComments` had never
  once returned true. `bun scripts/compilercheck.ts --check` is the guard (CI); `COMPILER.md`
  lists the syntax to avoid — `try`/`finally`, a conditional inside a `try`, `x++` on a captured
  local, a ref written during render, `?.` in a logical test, `for (;;)`, a call above its
  declaration.
- Vite 8 is Rolldown + Oxc: `build.rolldownOptions` / `oxc`, not `rollupOptions` / `esbuild`.
  LightningCSS leaves `color-mix()` and `:has()` intact.
- `dist/.gitkeep` is tracked; the `preserveGitkeep` plugin recreates it after `emptyOutDir`.
- Shiki's `bundledLanguages` pulls a ~600KB `wasm-*.js` chunk that's never fetched. Don't chase it.
- `vite.config.ts` hardcodes the `127.0.0.1:7777` proxy; testing that path means stopping the real
  instance first.
