import { useEffect, useMemo, useRef, useState } from "react";
import { AddFileModal } from "./components/AddFileModal";
import { AgentPromptsModal } from "./components/AgentPromptsModal";
import { CommentsPanel } from "./components/CommentsPanel";
import { DiffView, LARGE_FILE_LINES } from "./components/DiffView";
import { ExportModal } from "./components/ExportModal";
import { FileExplorer, orderedFiles } from "./components/FileExplorer";
import { HelpModal } from "./components/HelpModal";
import { LazyFile } from "./components/LazyFile";
import { ResetConfirmModal } from "./components/ResetConfirmModal";
import { TopBar } from "./components/TopBar";
import { buildReplyPrompt, buildReviewPrompt } from "./prompts";
import { useActiveFile } from "./useActiveFile";
import { useCommentActions } from "./useCommentActions";
import { useJump } from "./useJump";
import { useKeyboardShortcuts } from "./useKeyboardShortcuts";
import { usePanelResize } from "./usePanelResize";
import { useReview } from "./useReview";
import type { FileDiff } from "./types";
import { effectiveLines, effectivePath } from "./types";
import { LS, setString, writeBasePref } from "./storage";
import { clamp } from "./util";

export default function App() {
  const {
    repos,
    reposLoaded,
    repo,
    changeRepo,
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
    uncommitted,
    setUncommitted,
    unstaged,
    setUnstaged,
    headIsCurrent,
    loading,
    error,
    setError,
    worktreeSide,
    indexedSide,
    shortSha,
    repoOptions,
    headOptions,
    baseOptions,
    fromOptions,
    startReview,
    resetReview,
    setReviewedPaths,
    toggleReviewed,
  } = useReview();

  // Files the branch didn't change, opened so they can be commented on. Session
  // state (not persisted): comment-bearing ones re-derive from `comments` on
  // reload; uncommented ones are transient.
  const [openedFiles, setOpenedFiles] = useState<string[]>([]);
  const [showAddFile, setShowAddFile] = useState(false);
  const [showExport, setShowExport] = useState(false);
  const [showPrompts, setShowPrompts] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [confirmingReset, setConfirmingReset] = useState(false);
  const diffColRef = useRef<HTMLDivElement>(null);
  const explorerSearchRef = useRef<HTMLInputElement>(null);
  // Which file the tree highlights: the scroll-spy sets it as you scroll, clicks/nav
  // set it too. Plain state — the React Compiler keeps unchanged DiffViews from
  // re-rendering when this changes, so it needn't live outside React.
  const [selectedFile, setSelectedFile] = useState<string | null>(null);

  const { leftW, rightW, mainRef, startResize, onResizeKey } = usePanelResize();
  // Highlight the file scrolled to the top of the diff, not just the last-clicked
  // one; suppress it during programmatic scrolls so it doesn't flicker en route.
  const { suppress: suppressActiveFile } = useActiveFile(diffColRef, setSelectedFile, review?.id);
  const { activeComment, expandTarget, expandComment, jumpTo, jumpToFile, resetJump } = useJump({
    comments,
    setSelectedFile,
    onProgrammaticScroll: suppressActiveFile,
  });
  const { commentActions, handleAddComment, handleDelete } = useCommentActions({
    review,
    comments,
    setComments,
    setError,
    worktree: worktreeSide,
    indexed: indexedSide,
  });


  useEffect(() => {
    document.title = review
      ? `${repo} · ${review.headRef} → ${review.baseRef} — local-review`
      : "local-review";
  }, [review, repo]);

  // Clear pure view/nav state on a repo switch; useReview resets its own data.
  useEffect(() => {
    if (!repo) return;
    setSelectedFile(null);
    setOpenedFiles([]);
    resetJump();
  }, [repo]);

  function requestReset() {
    if (!review) return;
    if (comments.length === 0 && reviewedFiles.size === 0) return;
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

  // Fold in synthetic cards for paths the diff didn't touch but that were opened
  // to comment on — explicitly (openedFiles) or because a comment (browser- or
  // agent-authored) already anchors there. Deriving from comments both surfaces
  // agent comments on non-changed files and restores opened files after a reload.
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

  const orderedDiffFiles = useMemo(() => orderedFiles(allFiles), [allFiles]);
  const orderedFilePaths = useMemo(
    () => orderedDiffFiles.map((f) => f.newPath || f.oldPath),
    [orderedDiffFiles]
  );

  const orderedCommentIds = useMemo(() => {
    const ids: number[] = [];
    const seen = new Set<number>();
    for (const f of orderedDiffFiles) {
      const p = f.newPath || f.oldPath;
      const inFile = comments
        .filter((c) => effectivePath(c) === p)
        .sort((a, b) => effectiveLines(a).start - effectiveLines(b).start);
      for (const c of inFile) {
        ids.push(c.id);
        seen.add(c.id);
      }
    }
    for (const c of comments) if (!seen.has(c.id)) ids.push(c.id);
    return ids;
  }, [orderedDiffFiles, comments]);

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

  useKeyboardShortcuts({
    enabled: !!review,
    modalOpen: showHelp || confirmingReset || showExport || showPrompts || showAddFile,
    helpOpen: showHelp,
    loading,
    onNextFile: () => moveFile(1),
    onPrevFile: () => moveFile(-1),
    onNextComment: () => moveComment(1),
    onPrevComment: () => moveComment(-1),
    onExport: () => setShowExport(true),
    onReload: startReview,
    onOpenHelp: () => setShowHelp(true),
    onCloseHelp: () => setShowHelp(false),
    onFocusSearch: () => explorerSearchRef.current?.focus(),
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
          headIsCurrent,
          uncommitted,
          onUncommittedChange: setUncommitted,
          unstaged,
          onUnstagedChange: setUnstaged,
          loading,
          onReload: startReview,
        }}
        actions={{
          onShowPrompts: () => setShowPrompts(true),
          onShowExport: () => setShowExport(true),
          onReset: requestReset,
          onShowHelp: () => setShowHelp(true),
        }}
        status={{
          review,
          shortSha,
          openCommentCount: comments.filter((c) => !c.resolved).length,
          canReset: comments.length > 0 || reviewedFiles.size > 0,
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
            ×
          </button>
        </div>
      )}

      {!review && !error && (
        <div className="empty">
          {!reposLoaded ? (
            <>
              <span className="spinner" aria-hidden="true" />
              Loading…
            </>
          ) : repos.length === 0 ? (
            "No git repositories found under the served folder."
          ) : (
            "Select a branch to start a review."
          )}
        </div>
      )}

      {review && (
        <div
          className="main"
          ref={mainRef}
          style={{ gridTemplateColumns: `${leftW}px 6px 1fr 6px ${rightW}px` }}
        >
          <aside className="explorer-column">
            <FileExplorer
              files={allFiles}
              comments={comments}
              reviewed={reviewedFiles}
              selected={selectedFile}
              onSelect={jumpToFile}
              onToggleReviewed={toggleReviewed}
              onToggleFolder={setReviewedPaths}
              onAddFile={() => setShowAddFile(true)}
              searchRef={explorerSearchRef}
            />
          </aside>
          <div
            className="resizer"
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize files panel"
            aria-valuemin={160}
            aria-valuemax={560}
            aria-valuenow={leftW}
            tabIndex={0}
            onMouseDown={(e) => startResize(e, "left")}
            onKeyDown={(e) => onResizeKey(e, "left")}
          />
          <div className="diff-column" ref={diffColRef}>
            {allFiles.length === 0 && loading && (
              <div className="empty">
                <span className="spinner" aria-hidden="true" />
                Loading diff…
              </div>
            )}
            {allFiles.length === 0 && !loading && (
              <div className="empty">No changes between base and head.</div>
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
                    worktree={worktreeSide}
                    indexed={indexedSide}
                    comments={comments.filter((c) => effectivePath(c) === path)}
                    onAddComment={handleAddComment}
                    actions={commentActions}
                    reviewed={reviewedFiles.has(path)}
                    onToggleReviewed={(r) => toggleReviewed(path, r)}
                    expandTarget={expandTarget}
                    expandComment={expandComment}
                    activeComment={activeComment}
                  />
                </LazyFile>
              );
            })}
          </div>
          <div
            className="resizer"
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize comments panel"
            aria-valuemin={220}
            aria-valuemax={640}
            aria-valuenow={rightW}
            tabIndex={0}
            onMouseDown={(e) => startResize(e, "right")}
            onKeyDown={(e) => onResizeKey(e, "right")}
          />
          <aside className="side-column">
            <CommentsPanel
              comments={comments}
              fileOrder={orderedFilePaths}
              onJump={jumpTo}
              onDelete={handleDelete}
            />
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
        <AgentPromptsModal
          onClose={() => setShowPrompts(false)}
          prompts={[
            {
              value: "reply",
              label: "Address the review",
              text: buildReplyPrompt(review, window.location.origin),
            },
            {
              value: "review",
              label: "Do a review",
              text: buildReviewPrompt(review, window.location.origin),
            },
          ]}
        />
      )}

      {showHelp && <HelpModal onClose={() => setShowHelp(false)} />}

      {confirmingReset && (
        <ResetConfirmModal
          commentCount={comments.length}
          reviewedCount={reviewedFiles.size}
          onCancel={() => setConfirmingReset(false)}
          onConfirm={performReset}
        />
      )}
    </div>
  );
}
