# local-review — Spec

A local, single-user tool for reviewing a git branch (or specific commits on a branch), leaving comments on lines and line ranges, and exporting the review as a markdown file to hand to a local coding agent.

## Goals

- Review the diff a branch introduces, with GitHub-style ergonomics, entirely locally.
- Comment on any line (changed or not), individually or as a range.
- Produce a clean markdown artifact — file path + line(s) + code snippet + comment — for an agent to act on.

## Non-goals (for now)

- Multi-user / collaboration / auth.
- Cross-machine sync or remote hosting.
- Posting reviews back to GitHub/GitLab.

---

## Architecture

- **Single Go binary.** The React app is built and embedded via `embed.FS`; Go serves the static assets and a JSON API, then opens the browser at `localhost:PORT`.
- **Git access by shelling out** to the real `git` binary (`os/exec`) — correct on renames, submodules, `.gitattributes` diff filters; less code than go-git.
- **Backend is source of truth** for review state; the React app is a cache over it.
- **SQLite** via `modernc.org/sqlite` (pure Go, no cgo). WAL mode enabled.
  - DB file lives in a **data directory**, `~/.local-review/` by default and overridable with `-data-dir`, so one central DB serves every repo regardless of launch directory.
  - The data directory is created on startup (a leading `~` is expanded, relative paths are made absolute).
- Rows are keyed by absolute `repo_path`, so the tool can serve many repos from one DB.

---

## Diff model

- A review compares a **base** and a **head**.
  - Default base = `git merge-base <head-branch> <main-branch>` — "what this branch introduces." Main branch name is configurable.
  - Base is overridable (pick an explicit ref).
- **MVP: cumulative diff vs base** (one diff view for the whole branch).
- **Later: per-commit stepping** — walk each selected commit's own diff.
- `head_sha` is recorded on the review so the exact reviewed state is unambiguous.

### Anchoring

- All comments anchor to the **new side**: HEAD-side file path + line number. That's what the agent needs to edit.
- Comments are allowed on **any line**, not just changed lines.
- The **code snippet** at the anchored line(s) is captured and stored with the comment, so feedback survives line drift after further commits.

### View modes

- The diff view toggles between **full file** and **changed-lines-only**.
- View mode is purely a rendering concern over the same file content; commenting on any line works in either mode.

---

## Data model (SQLite)

```sql
reviews(
  id            INTEGER PRIMARY KEY,
  repo_path     TEXT NOT NULL,      -- absolute path
  base_ref      TEXT NOT NULL,
  head_ref      TEXT NOT NULL,
  head_sha      TEXT NOT NULL,      -- exact reviewed commit
  status        TEXT NOT NULL,      -- 'draft' | 'exported'
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

comments(
  id            INTEGER PRIMARY KEY,
  review_id     INTEGER NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
  file_path     TEXT NOT NULL,      -- new-side path
  start_line    INTEGER NOT NULL,   -- new-side anchor
  end_line      INTEGER NOT NULL,   -- == start_line for single-line
  snippet       TEXT NOT NULL,      -- captured code for drift resistance
  type          TEXT NOT NULL,      -- 'bug' | 'suggestion' | 'question' | 'nit'
  body          TEXT NOT NULL,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);
```

- A review is found/resumed by `(repo_path, base_ref, head_ref)`.

### Persistence behavior

- Discrete actions (create comment, delete, change type) save **immediately**.
- Comment **body text** is debounced (~500ms) to avoid a write per keystroke.
- On load, the frontend hydrates from `GET` of the review + comments.
- **Retention sweep on startup**: prune `draft` reviews older than N days (configurable).
- Exported reviews are **kept as lightweight history**; manual delete available. Retention is a setting so history can't grow unbounded.

---

## API surface

Git-reading (backend as git service):

- `GET  /api/branches` — list local branches; identify the configured main branch.
- `GET  /api/diff?base=<ref>&head=<ref>` — parsed diff (hunks) for the cumulative branch diff.
- `GET  /api/file?path=<p>&ref=<ref>` — full file content (for full-file view + snippet capture).

Review state (backend as source of truth):

- `POST   /api/reviews` — create/find a review for `(repo, base, head)`; returns review + `head_sha`.
- `GET    /api/reviews/:id` — review + all comments.
- `GET    /api/reviews` — list reviews (history).
- `DELETE /api/reviews/:id` — delete a review.
- `POST   /api/reviews/:id/comments` — add a comment.
- `PATCH  /api/comments/:id` — edit body/type/range.
- `DELETE /api/comments/:id` — delete a comment.

Export:

- `GET /api/reviews/:id/export` — render the canonical markdown (server-side, single formatter). Marks the review `exported`.

---

## Export / handoff

- Backend renders the markdown from the DB — **one canonical formatter**.
- Frontend shows a **review panel** with a rendered preview and access to the raw markdown.
- **Copy** → raw markdown to clipboard (`navigator.clipboard.writeText`).
- **Download** → `Blob` + `<a download="code-review-<branch>-<shortsha>.md">`, pure browser download. No backend file I/O.

### Markdown output format

```markdown
# Review: <head-branch> → <base-ref> @ <shortsha>

_<N> comments across <M> files_

## <file/path/one.go>

### L42–58 · bug
```<lang>
<captured snippet>
```
<comment body>

### L102 · suggestion
```<lang>
<captured snippet>
```
<comment body>

## <file/path/two.tsx>

### L7 · nit
...
```

- Grouped by file, comments ordered by start line.
- Single line renders as `L42`, range as `L42–58`.
- Language fence inferred from file extension.
- Snippet is the captured code (drift-proof), not re-read from the current tree.

---

## MVP scope

1. Branch picker → create/resume review vs merge-base.
2. Diff view with full-file / changed-only toggle.
3. Click a line or drag a range → typed comment; comments panel.
4. Immediate autosave to SQLite; resume on reload.
5. Export panel: rendered preview + copy + download.

### Deferred

- Per-commit stepping.
- Side-by-side diff view.
- Review history browser (beyond basic list).
- Per-repo picker UI (initially: whichever repo path is provided/launched against).
