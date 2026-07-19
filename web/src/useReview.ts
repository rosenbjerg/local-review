import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "./api";
import { type ComboOption } from "./components/Combobox";
import type { Branch, Comment, Commit, DiffOpts, FileDiff, Review } from "./types";
import { LS, getString, readBasePref } from "./storage";

// The review data layer: repo/branch selection, the diff-scope view toggle, and
// the review lifecycle (create, SSE refetch, diff refetch, reviewed-file marks).
// Owns the reqSeq stale-response guard and the coordinated repo-change reset of
// its own state. Pure view state (selectedFile/openedFiles) and jump state live
// in App, which resets them on repo change alongside this.
export function useReview() {
  const [repos, setRepos] = useState<string[]>([]);
  const [reposLoaded, setReposLoaded] = useState(false);
  const [repo, setRepo] = useState("");
  const [branches, setBranches] = useState<Branch[]>([]);
  const [head, setHead] = useState("");
  const [base, setBase] = useState("");
  const [review, setReview] = useState<Review | null>(null);
  const [files, setFiles] = useState<FileDiff[]>([]);
  const [baseSha, setBaseSha] = useState("");
  const [comments, setComments] = useState<Comment[]>([]);
  const [reviewedFiles, setReviewedFiles] = useState<Set<string>>(new Set());
  // The diff view — two orthogonal transient axes. `from` is the before side:
  // "all" (the whole branch) or a picked commit sha. `uncommitted` moves the after
  // side to the working tree/index; `unstaged` (default) keeps unstaged edits in.
  const [from, setFrom] = useState("all");
  const [uncommitted, setUncommitted] = useState(false);
  const [unstaged, setUnstaged] = useState(true);
  const [commits, setCommits] = useState<Commit[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Bumped on each load; in-flight responses check it before applying state, so
  // a stale repo's review/diff can't repopulate the UI for the new selection.
  const reqSeq = useRef(0);

  // The working tree/index only make sense when head is the checked-out branch, so
  // the uncommitted axis is gated on that (and disabled in the UI otherwise).
  const currentBranch = branches.find((b) => b.isCurrent)?.name;
  const headIsCurrent = !!head && head === currentBranch;
  const effectiveUncommitted = uncommitted && headIsCurrent;
  // The new side comments/reviewed anchor to: the working tree (uncommitted incl.
  // unstaged) or the git index (uncommitted, staged only). Mutually exclusive;
  // neither ⇒ head_ref.
  const worktreeSide = effectiveUncommitted && unstaged;
  const indexedSide = effectiveUncommitted && !unstaged;

  function diffOpts(baseRef: string): DiffOpts {
    return {
      from,
      base: from === "all" ? baseRef || undefined : undefined,
      uncommitted: effectiveUncommitted,
      unstaged,
    };
  }

  useEffect(() => {
    api
      .repos()
      .then((r) => {
        setRepos(r.repos);
        const saved = getString(LS.repo);
        setRepo(saved && r.repos.includes(saved) ? saved : (r.repos[0] ?? ""));
      })
      .catch((e) => setError((e as Error).message))
      .finally(() => setReposLoaded(true));
  }, []);

  useEffect(() => {
    reqSeq.current++;
    const seq = reqSeq.current;
    setLoading(false);
    setBranches([]);
    setHead("");
    if (!repo) return;
    setReview(null);
    setFiles([]);
    setComments([]);
    setReviewedFiles(new Set());
    setBase("");
    setFrom("all");
    setUncommitted(false);
    setUnstaged(true);
    setCommits([]);
    api
      .branches(repo)
      .then((r) => {
        if (reqSeq.current !== seq) return; // superseded by another repo switch
        setBranches(r.branches);
        const current = r.branches.find((b) => b.isCurrent);
        const firstLocal = r.branches.find((b) => !b.isRemote);
        // Head is a local-only picker, so never default it to a remote.
        setHead(current?.name ?? firstLocal?.name ?? "");
        const savedBase = readBasePref(repo);
        if (savedBase === "" || r.branches.some((b) => b.name === savedBase)) {
          setBase(savedBase);
        }
      })
      .catch((e) => {
        if (reqSeq.current === seq) setError((e as Error).message);
      });
  }, [repo]);

  // The uncommitted axis is meaningless when head isn't the checked-out branch; if
  // head moves away while it's on, turn it off.
  useEffect(() => {
    if (!headIsCurrent && uncommitted) setUncommitted(false);
  }, [headIsCurrent, uncommitted]);

  // Re-enabling uncommitted should start from the default (both staged + unstaged),
  // so reset `unstaged` whenever the uncommitted axis is off.
  useEffect(() => {
    if (!uncommitted) setUnstaged(true);
  }, [uncommitted]);

  // Change head via `changeHead` (below), which resets `from` in the same update —
  // a picked sha belongs to the old head's history. This effect (re)loads the "from"
  // picker's commit list whenever repo/head/base changes; passing base scopes it to
  // base..head, so it offers only the branch's own commits (the base picker is
  // disabled while a commit is picked, so this can't strand a selection).
  useEffect(() => {
    if (!repo || !head) return;
    let cancelled = false;
    api
      .commits(repo, head, base)
      .then((r) => {
        if (!cancelled) setCommits(r.commits ?? []);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [repo, head, base]);

  // The SSE effect below is keyed only on review.id, so it can't close over the
  // live diff params — repo and the scope change without the id moving. Mirror
  // them into a ref the ping refetch reads, so a diff refresh uses the current
  // selection rather than a stale one.
  const diffParams = useRef<{ repo: string; headRef: string; opts: DiffOpts }>({
    repo,
    headRef: "",
    opts: { from: "all", uncommitted: false, unstaged: true },
  });
  useEffect(() => {
    diffParams.current = {
      repo,
      headRef: review?.headRef ?? "",
      opts: diffOpts(review?.baseRef ?? ""),
    };
  });

  // Refetch on an SSE ping: a `diff` ping (a commit or on-disk edit) refetches the
  // review and the diff, so an agent's changes surface without a manual reload; a
  // `meta` ping (comment/reply/reviewed-file) refetches only the review, since those
  // never move file content. The focus/visibility refetch is a fallback for a dead
  // stream, gated on the stream not being OPEN so a healthy one doesn't double-fetch.
  useEffect(() => {
    if (!review) return;
    const id = review.id;
    let cancelled = false;
    let inFlight = false;
    let pending = false;
    let pendingDiff = false;
    async function refresh(withDiff: boolean) {
      if (cancelled || document.visibilityState !== "visible") return;
      if (inFlight) {
        // Ping mid-fetch: the in-flight response may predate the change, so queue
        // exactly one trailing refetch — carrying the diff if any queued ping wanted it.
        pending = true;
        pendingDiff = pendingDiff || withDiff;
        return;
      }
      inFlight = true;
      try {
        const p = diffParams.current;
        const [rev, d] = await Promise.all([
          api.getReview(id),
          withDiff && p.repo && p.headRef
            ? api.diff(p.repo, p.headRef, p.opts)
            : Promise.resolve(null),
        ]);
        if (!cancelled) {
          setReview(rev);
          setComments(rev.comments ?? []);
          setReviewedFiles(new Set(rev.reviewedFiles ?? []));
          if (d) {
            setFiles(d.files ?? []);
            setBaseSha(d.base ?? "");
          }
        }
      } catch {
        // Transient refresh failure — keep the current state.
      } finally {
        inFlight = false;
        if (pending && !cancelled) {
          pending = false;
          const wantDiff = pendingDiff;
          pendingDiff = false;
          refresh(wantDiff);
        }
      }
    }
    const es = new EventSource(`/api/reviews/${id}/events`);
    es.onmessage = (e) => refresh(e.data === "diff");
    // No onerror — EventSource auto-reconnects; the focus fallback covers the gap.
    function onFocus() {
      if (es.readyState === EventSource.OPEN) return; // stream live — it'll push
      // A dead stream may have missed a content change, so refetch the diff to be safe.
      refresh(true);
    }
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      cancelled = true;
      es.close();
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [review?.id]);

  // Refetch the diff when a view axis changes — keyed on the axis inputs alone so it
  // fires only on a later change, not on load (the !review guard no-ops the initial
  // run; startReview does the first diff). Bail while the review is stale relative to
  // the head picker (a head change resets `from`, which fires this effect before
  // startReview has recreated the review): startReview owns that fetch, and running
  // here would diff the old head and bump reqSeq out from under it.
  useEffect(() => {
    if (!review || review.headRef !== head) return;
    const seq = ++reqSeq.current;
    setLoading(true);
    api
      .diff(repo, review.headRef, diffOpts(review.baseRef))
      .then((d) => {
        if (reqSeq.current !== seq) return;
        setFiles(d.files ?? []);
        setBaseSha(d.base ?? "");
      })
      .catch((e) => {
        if (reqSeq.current === seq) setError((e as Error).message);
      })
      .finally(() => {
        if (reqSeq.current === seq) setLoading(false);
      });
    // Intentionally keyed on the view axes only — repo/head/review changes go
    // through startReview, which fetches the first diff itself.
  }, [from, uncommitted, unstaged]);

  // Switch head, resetting `from` to "all" in the same update. Reset must be
  // synchronous with the head change so the startReview that auto-start fires reads
  // the fresh `from` (a state reset inside an effect wouldn't reach that closure).
  function changeHead(name: string) {
    setHead(name);
    setFrom("all");
  }

  // Switch repo, clearing `head` in the same update. The reset must be synchronous:
  // the repo-change effect that reloads branches resets `head` too, but only after
  // this render — leaving the auto-start effect to fire startReview() with the *old*
  // repo's head, which bumps the shared reqSeq and discards the in-flight branch
  // fetch (leaving the head picker empty until reload). Clearing head here makes
  // auto-start's `if (repo && head)` guard false during the switch.
  function changeRepo(name: string) {
    setRepo(name);
    setHead("");
  }

  async function startReview() {
    if (!repo || !head) return;
    const seq = ++reqSeq.current;
    setLoading(true);
    setError(null);
    try {
      const rev = await api.createReview(repo, head, base || undefined);
      if (reqSeq.current !== seq) return; // superseded by a repo switch / newer load
      setReview(rev);
      setComments(rev.comments ?? []);
      setReviewedFiles(new Set(rev.reviewedFiles ?? []));
      const diff = await api.diff(repo, rev.headRef, diffOpts(rev.baseRef));
      if (reqSeq.current !== seq) return;
      setFiles(diff.files ?? []);
      setBaseSha(diff.base ?? "");
    } catch (e) {
      if (reqSeq.current !== seq) return;
      // head may be stale (deleted/renamed/mid-rebase): refetch branches and, if
      // it's gone, fall back to current (auto-start re-fires); else surface the error.
      let recovered = false;
      try {
        const r = await api.branches(repo);
        if (reqSeq.current === seq && !r.branches.some((b) => b.name === head)) {
          setBranches(r.branches);
          const current = r.branches.find((b) => b.isCurrent);
          const firstLocal = r.branches.find((b) => !b.isRemote);
          changeHead(current?.name ?? firstLocal?.name ?? "");
          recovered = true;
        }
      } catch {
        // ignore — surface the original error below
      }
      if (!recovered && reqSeq.current === seq) setError((e as Error).message);
    } finally {
      if (reqSeq.current === seq) setLoading(false);
    }
  }

  // Auto-start on a complete repo/head/base selection; the view axes have their
  // own refetch effect, so they're not deps here.
  useEffect(() => {
    if (repo && head) startReview();
  }, [repo, head, base]);

  async function resetReview() {
    if (!review) return;
    setError(null);
    try {
      await api.resetReview(review.id);
      setComments([]);
      setReviewedFiles(new Set());
    } catch (e) {
      setError((e as Error).message);
    }
  }

  // Mark/unmark a set of files at once (one file, or every file under a folder).
  async function setReviewedPaths(paths: string[], reviewed: boolean) {
    if (!review || paths.length === 0) return;
    setError(null);
    const apply = (add: boolean) =>
      setReviewedFiles((s) => {
        const n = new Set(s);
        for (const p of paths) {
          if (add) n.add(p);
          else n.delete(p);
        }
        return n;
      });
    apply(reviewed); // optimistic
    try {
      // Fingerprint the side on screen (working tree / index), like addComment.
      await api.setReviewed(review.id, paths, reviewed, worktreeSide, indexedSide);
    } catch (e) {
      apply(!reviewed); // rollback the whole batch
      setError((e as Error).message);
    }
  }

  const toggleReviewed = (path: string, reviewed: boolean) => setReviewedPaths([path], reviewed);

  const mainBranch = branches.find((b) => b.isMain)?.name;
  const shortSha = review?.headSha.slice(0, 7);
  const repoOptions = useMemo<ComboOption[]>(() => repos.map((r) => ({ value: r, label: r })), [repos]);
  const localBranches = useMemo(() => branches.filter((b) => !b.isRemote), [branches]);
  const headOptions = useMemo<ComboOption[]>(
    () => localBranches.map((b) => ({ value: b.name, label: b.name, hint: b.isCurrent ? "current" : undefined })),
    [localBranches]
  );
  const baseOptions = useMemo<ComboOption[]>(() => {
    const opts: ComboOption[] = [{ value: "", label: `auto${mainBranch ? ` (${mainBranch})` : ""}` }];
    for (const b of localBranches) {
      opts.push({ value: b.name, label: b.name, hint: b.isMain ? "main" : undefined });
    }
    for (const b of branches.filter((b) => b.isRemote)) {
      opts.push({ value: b.name, label: b.name, hint: b.isMain ? "main" : undefined, group: "remote (last fetched)" });
    }
    return opts;
  }, [branches, localBranches, mainBranch]);
  // The "from" picker: "All" (whole branch) plus head's recent commits.
  const fromOptions = useMemo<ComboOption[]>(
    () => [
      { value: "all", label: "All (whole branch)" },
      ...commits.map((c) => ({ value: c.sha, label: `${c.shortSha}  ${c.subject}`, hint: c.relDate })),
    ],
    [commits]
  );

  return {
    repos,
    reposLoaded,
    repo,
    changeRepo,
    branches,
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
    loading,
    error,
    setError,
    headIsCurrent,
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
  };
}
