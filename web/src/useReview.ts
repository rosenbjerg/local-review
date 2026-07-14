import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "./api";
import { type ComboOption } from "./components/Combobox";
import type { Branch, Comment, FileDiff, Review } from "./types";
import { LS, getString, readBasePref } from "./storage";

// The review data layer: repo/branch selection and the review lifecycle (create,
// SSE refetch, diff refetch, reviewed-file marks). Owns the reqSeq stale-response
// guard and the coordinated repo-change reset of its own state. Pure view state
// (selectedFile/openedFiles) and jump state live in App, which resets them on
// repo change alongside this.
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
  const [uncommitted, setUncommitted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Bumped on each load; in-flight responses check it before applying state, so
  // a stale repo's review/diff can't repopulate the UI for the new selection.
  const reqSeq = useRef(0);

  // The working tree reflects the checked-out branch, so the uncommitted toggle
  // only makes sense when head is current. Kept separate from the raw checkbox so
  // a head change doesn't mutate `uncommitted` and refire the diff-refetch effect.
  const currentBranch = branches.find((b) => b.isCurrent)?.name;
  const headIsCurrent = !!head && head === currentBranch;
  const effectiveUncommitted = uncommitted && headIsCurrent;

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
    setUncommitted(false);
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

  // The SSE effect below is keyed only on review.id, so it can't close over the
  // live diff params — repo and the uncommitted toggle change without the id moving.
  // Mirror them into a ref the ping refetch reads, so a diff refresh uses the
  // current selection rather than a stale one.
  const diffParams = useRef({ repo, headRef: "", baseRef: "", uncommitted: effectiveUncommitted });
  useEffect(() => {
    diffParams.current = {
      repo,
      headRef: review?.headRef ?? "",
      baseRef: review?.baseRef ?? "",
      uncommitted: effectiveUncommitted,
    };
  });

  // Refetch the review and the diff on an SSE "changed" ping, so an agent's edits
  // (or a fresh commit) surface without a manual reload. The focus/visibility
  // refetch is a fallback for a dead stream, gated on the stream not being OPEN so a
  // healthy one doesn't double-fetch.
  useEffect(() => {
    if (!review) return;
    const id = review.id;
    let cancelled = false;
    let inFlight = false;
    let pending = false;
    async function refresh() {
      if (cancelled || document.visibilityState !== "visible") return;
      if (inFlight) {
        // Ping mid-fetch: the in-flight response may predate the change, so
        // queue exactly one trailing refetch rather than drop it.
        pending = true;
        return;
      }
      inFlight = true;
      try {
        const p = diffParams.current;
        const [rev, d] = await Promise.all([
          api.getReview(id),
          p.repo && p.headRef
            ? api.diff(p.repo, p.headRef, p.baseRef, p.uncommitted)
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
          refresh();
        }
      }
    }
    const es = new EventSource(`/api/reviews/${id}/events`);
    es.onmessage = () => refresh();
    // No onerror — EventSource auto-reconnects; the focus fallback covers the gap.
    function onFocus() {
      if (es.readyState === EventSource.OPEN) return; // stream live — it'll push
      refresh();
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

  // Refetch the diff when the uncommitted toggle flips — keyed on `uncommitted`
  // alone so it fires only on a later toggle, not on load.
  useEffect(() => {
    if (!review) return;
    const seq = ++reqSeq.current;
    setLoading(true);
    api
      .diff(repo, review.headRef, review.baseRef, effectiveUncommitted)
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
  }, [uncommitted]);

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
      const diff = await api.diff(repo, rev.headRef, rev.baseRef, effectiveUncommitted);
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
          setHead(current?.name ?? firstLocal?.name ?? "");
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

  // Auto-start on a complete repo/head/base selection; the uncommitted toggle has
  // its own effect, so it's not a dep here.
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
      // Fingerprint the side on screen (uncommitted ⇒ working tree), like addComment.
      await api.setReviewed(review.id, paths, reviewed, effectiveUncommitted);
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

  return {
    repos,
    reposLoaded,
    repo,
    setRepo,
    branches,
    head,
    setHead,
    base,
    setBase,
    review,
    files,
    baseSha,
    comments,
    setComments,
    reviewedFiles,
    uncommitted,
    setUncommitted,
    loading,
    error,
    setError,
    headIsCurrent,
    effectiveUncommitted,
    shortSha,
    repoOptions,
    headOptions,
    baseOptions,
    startReview,
    resetReview,
    setReviewedPaths,
    toggleReviewed,
  };
}
