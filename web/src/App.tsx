import { useEffect, useMemo, useRef, useState } from "react";
import { AddFileModal } from "./components/AddFileModal";
import { AgentPromptsModal } from "./components/AgentPromptsModal";
import { CommentRefPopover } from "./components/CommentRefPopover";
import { CommentsPanel } from "./components/CommentsPanel";
import { DiffView, LARGE_FILE_LINES } from "./components/DiffView";
import { ExportModal } from "./components/ExportModal";
import { FileExplorer, orderedFiles } from "./components/FileExplorer";
import { FindBar } from "./components/FindBar";
import { SettingsModal } from "./components/SettingsModal";
import { LazyFile } from "./components/LazyFile";
import { PaneRail } from "./components/PaneRail";
import { ResetConfirmModal } from "./components/ResetConfirmModal";
import { ReviewSummary } from "./components/ReviewSummary";
import { TopBar } from "./components/TopBar";
import { EmptyState } from "./components/EmptyState";
import {
  IconFileDiff,
  IconFolder,
  IconGitBranch,
  IconGitCommit,
  IconX,
} from "./components/icons";
import { useActiveFile } from "./useActiveFile";
import { useCommentActions } from "./useCommentActions";
import { useCommentRefs } from "./useCommentRefs";
import { useJump } from "./useJump";
import { useKeyboardShortcuts } from "./useKeyboardShortcuts";
import { useOccurrenceHighlight } from "./useOccurrenceHighlight";
import { usePanelResize } from "./usePanelResize";
import { useReview } from "./useReview";
import { useUnseenActivity } from "./useUnseenActivity";
import { setFontsRepo } from "./fonts";
import { setThemeRepo } from "./theme";
import type { CommentFilter } from "./commentFilter";
import { NO_FILTER, authorsOf, filterComments } from "./commentFilter";
import type { CommentSort } from "./commentSort";
import { isCommentSort, sortComments } from "./commentSort";
import { awaitingYouCount } from "./commentTurn";
import { commentsFor, groupByPath } from "./commentsByPath";
import { totalStat } from "./diffStats";
import { nextUnreviewed } from "./reviewNav";
import type { FileDiff } from "./types";
import { effectivePath } from "./types";
import { LS, getString, setString, writeBasePref } from "./storage";
import { clamp } from "./util";

export default function App() {
  const {
    repos,
    reposLoaded,
    repo,
    changeRepo,
    branches,
    branchesLoaded,
    head,
    changeHead,
    base,
    setBase,
    review,
    files,
    baseSha,
    comments,
    setComments,
    reviewedFiles,
    from,
    setFrom,
    commitCount,
    headIsCurrent,
    baseIsHead,
    loading,
    error,
    setError,
    side,
    changeSide,
    shortSha,
    repoOptions,
    headOptions,
    baseOptions,
    fromOptions,
    startReview,
    resetReview,
    setReviewedPaths,
    toggleReviewed,
    setSummary,
  } = useReview();

  // Files opened only to comment on. Session state: the comment-bearing ones re-derive from `comments` on reload.
  const [openedFiles, setOpenedFiles] = useState<string[]>([]);
  const [showAddFile, setShowAddFile] = useState(false);
  const [showExport, setShowExport] = useState(false);
  const [showPrompts, setShowPrompts] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [confirmingReset, setConfirmingReset] = useState(false);
  const [commentSort, setCommentSort] = useState<CommentSort>(() => {
    const stored = getString(LS.commentSort);
    return isCommentSort(stored) ? stored : "file";
  });
  const [commentFilter, setCommentFilter] = useState<CommentFilter>(NO_FILTER);
  const diffColRef = useRef<HTMLDivElement>(null);
  const explorerSearchRef = useRef<HTMLInputElement>(null);
  // Plain state on purpose: the React Compiler keeps unchanged DiffViews from re-rendering on it.
  const [selectedFile, setSelectedFile] = useState<string | null>(null);

  const {
    leftW,
    rightW,
    leftOpen,
    rightOpen,
    toggleLeft,
    toggleRight,
    gridTemplateColumns,
    mainRef,
    startResize,
    onResizeKey,
  } = usePanelResize();
  const { suppress: suppressActiveFile } = useActiveFile(diffColRef, setSelectedFile, review?.id);
  const { activeComment, expandTarget, expandComment, jumpTo, jumpToFile, resetJump } = useJump({
    comments,
    setSelectedFile,
    onProgrammaticScroll: suppressActiveFile,
  });
  const [showFullSignal, setShowFullSignal] = useState<{ path: string; n: number } | null>(null);
  const highlight = useOccurrenceHighlight(!!review, diffColRef);
  const refHover = useCommentRefs(jumpTo);
  const { commentActions, handleAddComment, handleDelete } = useCommentActions({
    review,
    comments,
    setComments,
    setError,
    side,
  });


  const unseen = useUnseenActivity(comments, review?.id);

  useEffect(() => {
    const badge = unseen > 0 ? `(${unseen}) ` : "";
    document.title = review
      ? `${badge}${repo} · ${review.headRef} → ${review.baseRef} — local-review`
      : "local-review";
  }, [review, repo, unseen]);

  // A filter carried into another review would silently hide its comments.
  useEffect(() => {
    setCommentFilter(NO_FILTER);
  }, [review?.id]);

  // Both stores ignore the empty repo the first render carries, having seeded from the remembered one.
  useEffect(() => {
    setThemeRepo(repo);
    setFontsRepo(repo);
  }, [repo]);

  // Keyed on repo alone, deliberately (resetJump isn't a dep); useReview resets its own data.
  useEffect(() => {
    if (!repo) return;
    setSelectedFile(null);
    setOpenedFiles([]);
    resetJump();
  }, [repo]);

  function showFullFile() {
    const path = highlight.path;
    if (path) setShowFullSignal((s) => ({ path, n: (s?.n ?? 0) + 1 }));
  }

  // One predicate behind both canReset and requestReset's guard, so they can't drift apart.
  const hasReviewState = comments.length > 0 || reviewedFiles.size > 0 || !!review?.summary;

  function requestReset() {
    if (!review || !hasReviewState) return;
    setConfirmingReset(true);
  }

  function performReset() {
    setConfirmingReset(false);
    resetReview();
  }

  function openFile(path: string) {
    setShowAddFile(false);
    setOpenedFiles((s) => (s.includes(path) ? s : [...s, path]));
    setSelectedFile(path);
    suppressActiveFile();
    // The card mounts on the next render; defer the scroll until it exists.
    setTimeout(
      () => document.getElementById(`file-${path}`)?.scrollIntoView({ behavior: "smooth", block: "start" }),
      50
    );
  }

  function estFileHeight(f: FileDiff): number {
    const path = f.newPath || f.oldPath;
    const lines = f.hunks.reduce((n, h) => n + h.lines.length, 0);
    const collapsed = reviewedFiles.has(path) || lines > LARGE_FILE_LINES;
    if (collapsed) return 44;
    if (f.binary) return 400;
    return Math.min(lines, 400) * 18 + 44;
  }

  // Synthetic cards for paths the diff didn't touch: opened here, or anchoring a comment — which
  // is also what restores them after a reload.
  const allFiles = useMemo(() => {
    const inDiff = new Set(files.map((f) => f.newPath || f.oldPath));
    const extras = new Set<string>();
    for (const p of openedFiles) if (p && !inDiff.has(p)) extras.add(p);
    for (const c of comments) {
      const p = effectivePath(c);
      if (p && !inDiff.has(p)) extras.add(p);
    }
    const synthetic: FileDiff[] = [...extras].map((p) => ({
      oldPath: p,
      newPath: p,
      status: "unchanged",
      hunks: [],
    }));
    return [...files, ...synthetic];
  }, [files, openedFiles, comments]);

  // Off the real diff: the synthetic cards in `allFiles` have nothing to count.
  const diffStat = useMemo(() => totalStat(files), [files]);

  const orderedDiffFiles = useMemo(() => orderedFiles(allFiles), [allFiles]);
  const orderedFilePaths = useMemo(
    () => orderedDiffFiles.map((f) => f.newPath || f.oldPath),
    [orderedDiffFiles]
  );
  // Keyed on the joined id list, not the array: a no-op SSE refetch must keep the Set's
  // identity, or every <Markdown> re-runs markdown-it + Shiki.
  const commentIdKey = comments.map((c) => c.id).join(",");
  const commentIds = useMemo(
    () => new Set(commentIdKey ? commentIdKey.split(",").map(Number) : []),
    [commentIdKey]
  );
  // Per-file slices are what let DiffView's memo skip cards whose comments didn't change.
  const commentsByPath = useMemo(() => groupByPath(comments), [comments]);

  // The pane and the n/p nav share one ordering and one filter.
  const sortedComments = useMemo(
    () => sortComments(filterComments(comments, commentFilter), commentSort, orderedFilePaths),
    [comments, commentFilter, commentSort, orderedFilePaths]
  );
  const commentAuthors = useMemo(() => authorsOf(comments), [comments]);
  // Off the unfiltered list on purpose: this count describes the review, not the pane.
  const awaitingYou = useMemo(() => awaitingYouCount(comments), [comments]);
  const orderedCommentIds = useMemo(() => sortedComments.map((c) => c.id), [sortedComments]);

  function moveFile(delta: number) {
    const fileList = orderedDiffFiles.map((f) => f.newPath || f.oldPath);
    if (fileList.length === 0) return;
    const cur = selectedFile ? fileList.indexOf(selectedFile) : -1;
    const next =
      cur === -1 ? (delta > 0 ? 0 : fileList.length - 1) : clamp(cur + delta, 0, fileList.length - 1);
    jumpToFile(fileList[next]);
  }
  function moveComment(delta: number) {
    if (orderedCommentIds.length === 0) return;
    const cur = activeComment != null ? orderedCommentIds.indexOf(activeComment) : -1;
    const next =
      cur === -1
        ? delta > 0
          ? 0
          : orderedCommentIds.length - 1
        : clamp(cur + delta, 0, orderedCommentIds.length - 1);
    jumpTo(orderedCommentIds[next]);
  }

  // Unmarking stays put: undoing a keystroke shouldn't also move you.
  function markReviewedAndAdvance() {
    if (!selectedFile) return;
    if (reviewedFiles.has(selectedFile)) {
      toggleReviewed(selectedFile, false);
      return;
    }
    toggleReviewed(selectedFile, true);
    const next = nextUnreviewed(orderedFilePaths, selectedFile, reviewedFiles);
    if (!next) return;
    // Deferred: marking collapses the card above the target, invalidating an offset computed first.
    setTimeout(() => jumpToFile(next), 50);
  }

  useKeyboardShortcuts({
    enabled: !!review,
    modalOpen: showSettings || confirmingReset || showExport || showPrompts || showAddFile,
    settingsOpen: showSettings,
    loading,
    onNextFile: () => moveFile(1),
    onPrevFile: () => moveFile(-1),
    onNextComment: () => moveComment(1),
    onPrevComment: () => moveComment(-1),
    onExport: () => setShowExport(true),
    onReload: startReview,
    onMarkReviewed: markReviewedAndAdvance,
    onOpenSettings: () => setShowSettings(true),
    onCloseSettings: () => setShowSettings(false),
    // Open the pane first; the input only exists on the frame after the commit.
    onFocusSearch: () => {
      if (leftOpen) explorerSearchRef.current?.focus();
      else {
        toggleLeft();
        requestAnimationFrame(() => explorerSearchRef.current?.focus());
      }
    },
    onToggleFilesPane: toggleLeft,
    onToggleCommentsPane: toggleRight,
    hasHighlight: highlight.term !== null,
    onNextMatch: highlight.next,
    onPrevMatch: highlight.prev,
    onDismissHighlight: highlight.clear,
  });

  return (
    <div className="app">
      <TopBar
        selection={{
          repo,
          repoOptions,
          onRepoChange: (v) => {
            changeRepo(v);
            setString(LS.repo, v);
          },
          head,
          headOptions,
          onHeadChange: changeHead,
          base,
          baseOptions,
          onBaseChange: (v) => {
            setBase(v);
            writeBasePref(repo, v);
          },
          baseRelevant: from === "all",
          from,
          fromOptions,
          onFromChange: setFrom,
          commitCount,
          headIsCurrent,
          baseIsHead,
          side,
          onSideChange: changeSide,
          loading,
          onReload: startReview,
        }}
        actions={{
          onShowPrompts: () => setShowPrompts(true),
          onShowExport: () => setShowExport(true),
          onReset: requestReset,
          onShowSettings: () => setShowSettings(true),
        }}
        status={{
          review,
          shortSha,
          baseSha,
          // `files`, not `allFiles`: the synthetic cards aren't changes this diff made.
          fileCount: files.length,
          stat: diffStat,
          openCommentCount: comments.filter((c) => !c.resolved).length,
          canReset: hasReviewState,
        }}
      />

      {error && (
        <div className="error banner" role="alert">
          <span>{error}</span>
          <button
            className="banner-dismiss"
            onClick={() => setError(null)}
            title="Dismiss"
            aria-label="Dismiss error"
          >
            <IconX />
          </button>
        </div>
      )}

      {/* Not an error: nothing failed, the server just couldn't read the repo to judge staleness. */}
      {review?.annotationError && (
        <div className="warn banner" role="status">
          <span>
            {review.annotationError}. Comment staleness and reviewed marks aren’t being
            checked — what you see is the last saved state.
          </span>
        </div>
      )}

      {!review &&
        !error &&
        (!reposLoaded ? (
          <div className="empty">
            <span className="spinner" aria-hidden="true" />
            Loading…
          </div>
        ) : repos.length === 0 ? (
          <EmptyState
            icon={<IconFolder />}
            title="No git repositories found"
            hint="local-review serves every git repository directly under the folder it was started with. Restart it with -root pointing at a folder that contains some."
          />
        ) : branchesLoaded && branches.length === 0 ? (
          <EmptyState
            icon={<IconGitCommit />}
            title={`${repo} has no commits yet`}
            hint="There is nothing to review until the repository has at least one commit."
          />
        ) : (
          <EmptyState
            icon={<IconGitBranch />}
            title="Select a branch to start a review"
            hint="Pick the head branch you want to review in the toolbar above. The base defaults to the repository's main branch."
          />
        ))}

      {review && (
        <div className="main" ref={mainRef} style={{ gridTemplateColumns }}>
          <aside className={`explorer-column${leftOpen ? "" : " pane-collapsed"}`}>
            {!leftOpen && (
              <PaneRail label="Files" count={allFiles.length} side="left" onExpand={toggleLeft} />
            )}
            {leftOpen && (
              <FileExplorer
                files={allFiles}
                comments={comments}
                reviewed={reviewedFiles}
                selected={selectedFile}
                onSelect={jumpToFile}
                onToggleReviewed={toggleReviewed}
                onToggleFolder={setReviewedPaths}
                onAddFile={() => setShowAddFile(true)}
                onCollapse={toggleLeft}
                searchRef={explorerSearchRef}
              />
            )}
          </aside>
          {/* Inert while shut: a drag would clamp the stored width back up to the minimum. */}
          <div
            className={`resizer${leftOpen ? "" : " resizer-inert"}`}
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize files panel"
            aria-valuemin={160}
            aria-valuemax={560}
            aria-valuenow={leftW}
            tabIndex={leftOpen ? 0 : -1}
            onMouseDown={leftOpen ? (e) => startResize(e, "left") : undefined}
            onKeyDown={leftOpen ? (e) => onResizeKey(e, "left") : undefined}
          />
          <div className="diff-pane">
            <div className="diff-column" ref={diffColRef}>
              {allFiles.length === 0 && loading && (
                <div className="empty">
                  <span className="spinner" aria-hidden="true" />
                  Loading diff…
                </div>
              )}
              {allFiles.length === 0 && !loading && (
                <EmptyState
                  icon={<IconFileDiff />}
                  title="No changes to review"
                  hint="Nothing differs between the two ends of this comparison. Widen it from the toolbar — a different base, an earlier commit to start from, or the staged / working-tree side."
                />
              )}
              {orderedDiffFiles.map((f) => {
                const path = f.newPath || f.oldPath;
                return (
                  <LazyFile
                    key={path}
                    anchorId={`file-${path}`}
                    label={path}
                    estHeight={estFileHeight(f)}
                    rootRef={diffColRef}
                  >
                    <DiffView
                      file={f}
                      repo={repo}
                      headRef={review.headRef}
                      baseRef={baseSha}
                      side={side}
                      comments={commentsFor(commentsByPath, path)}
                      onAddComment={handleAddComment}
                      actions={commentActions}
                      reviewed={reviewedFiles.has(path)}
                      onToggleReviewed={toggleReviewed}
                      expandTarget={expandTarget}
                      expandComment={expandComment}
                      showFullSignal={showFullSignal}
                      activeComment={activeComment}
                      commentIds={commentIds}
                    />
                  </LazyFile>
                );
              })}
            </div>
            {highlight.term && (
              <FindBar
                term={highlight.term}
                count={highlight.count}
                index={highlight.index}
                changedOnly={highlight.viewMode === "changed"}
                onNext={highlight.next}
                onPrev={highlight.prev}
                onShowFullFile={showFullFile}
                onClear={highlight.clear}
              />
            )}
          </div>
          <div
            className={`resizer${rightOpen ? "" : " resizer-inert"}`}
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize comments panel"
            aria-valuemin={220}
            aria-valuemax={640}
            aria-valuenow={rightW}
            tabIndex={rightOpen ? 0 : -1}
            onMouseDown={rightOpen ? (e) => startResize(e, "right") : undefined}
            onKeyDown={rightOpen ? (e) => onResizeKey(e, "right") : undefined}
          />
          <aside className={`side-column${rightOpen ? "" : " pane-collapsed"}`}>
            {!rightOpen && (
              <PaneRail
                label="Comments"
                count={comments.length}
                side="right"
                onExpand={toggleRight}
              />
            )}
            {rightOpen && (
              <>
                <ReviewSummary summary={review.summary} onSave={setSummary} />
                <CommentsPanel
                  comments={sortedComments}
                  total={comments.length}
                  awaitingYou={awaitingYou}
                  sort={commentSort}
                  onSortChange={(v) => {
                    setCommentSort(v);
                    setString(LS.commentSort, v);
                  }}
                  filter={commentFilter}
                  onFilterChange={setCommentFilter}
                  authors={commentAuthors}
                  onJump={jumpTo}
                  onDelete={handleDelete}
                  onCollapse={toggleRight}
                />
              </>
            )}
          </aside>
        </div>
      )}

      {showAddFile && review && (
        <AddFileModal
          repo={repo}
          headRef={review.headRef}
          present={new Set(orderedFilePaths)}
          onSelect={openFile}
          onClose={() => setShowAddFile(false)}
        />
      )}

      {showExport && review && (
        <ExportModal reviewId={review.id} onClose={() => setShowExport(false)} />
      )}

      {showPrompts && review && (
        // Keyed on repo so a switch remounts the editor instead of carrying drafts across.
        <AgentPromptsModal
          key={repo}
          repo={repo}
          vars={{
            origin: window.location.origin,
            reviewId: review.id,
            headRef: review.headRef,
            baseRef: review.baseRef,
          }}
          onClose={() => setShowPrompts(false)}
        />
      )}

      {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}

      {confirmingReset && (
        <ResetConfirmModal
          commentCount={comments.length}
          reviewedCount={reviewedFiles.size}
          hasSummary={!!review?.summary}
          onCancel={() => setConfirmingReset(false)}
          onConfirm={performReset}
        />
      )}

      <CommentRefPopover hovered={refHover} comments={comments} />
    </div>
  );
}
