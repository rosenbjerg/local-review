import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "./api";
import { type ComboOption } from "./components/Combobox";
import type {
  Branch,
  Comment,
  Commit,
  DiffOpts,
  DiffResponse,
  FileDiff,
  Repo,
  Review,
  Side,
} from "./types";
import { LS, getString, readBasePref, readDiffViewPref, writeDiffViewPref } from "./storage";
import { relativeDay, relativeTime } from "./time";

// A ping returns a fresh object graph even when nothing changed; keep the old identity so downstream memos hold.
function keepIfSame<T>(prev: T, next: T): T {
  return JSON.stringify(prev) === JSON.stringify(next) ? prev : next;
}

// Each option shows the date the server ordered it on; a role marker ("current" / "main") stays ahead of it.
function branchHint(b: Branch, role: string | false): string | undefined {
  const rel = relativeTime(b.lastCommit);
  return [role || "", rel].filter(Boolean).join(" · ") || undefined;
}

// How many of base..head's commits the "from" picker asks for; both callers pass it explicitly.
const COMMIT_LIMIT = 50;

// A picked `from` that was rebased away would 400 the next diff, so drop it — but the list holds only the newest
// COMMIT_LIMIT commits, so absence proves removal only when the list is shorter than the cap.
function fromWasRemoved(from: string, list: Commit[]): boolean {
  return from !== "all" && list.length < COMMIT_LIMIT && !list.some((c) => c.sha === from);
}

function keepIfSameSet(prev: Set<string>, next: string[]): Set<string> {
  if (prev.size === next.length && next.every((p) => prev.has(p))) return prev;
  return new Set(next);
}

// The review data layer: repo/branch/diff-scope selection, create + resume, the diff and SSE refetches, reviewed marks.
export function useReview() {
  const [repos, setRepos] = useState<Repo[]>([]);
  const [reposLoaded, setReposLoaded] = useState(false);
  const [repo, setRepo] = useState("");
  const [branches, setBranches] = useState<Branch[]>([]);
  // Tells "still loading" from "a repo with no commits" — both leave `branches` empty.
  const [branchesLoaded, setBranchesLoaded] = useState(false);
  const [head, setHead] = useState("");
  const [base, setBase] = useState("");
  const [review, setReview] = useState<Review | null>(null);
  const [files, setFiles] = useState<FileDiff[]>([]);
  const [baseSha, setBaseSha] = useState("");
  const [comments, setComments] = useState<Comment[]>([]);
  const [reviewedFiles, setReviewedFiles] = useState<Set<string>>(new Set());
  // uncommitted/unstaged are remembered per repo; `from` isn't, since a picked sha belongs to one head's history.
  const [from, setFrom] = useState("all");
  const [uncommitted, setUncommitted] = useState(false);
  const [unstaged, setUnstaged] = useState(true);
  const [commits, setCommits] = useState<Commit[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Bumped on each load; in-flight responses check it so a stale selection's response can't land.
  const reqSeq = useRef(0);

  // The uncommitted axis only makes sense when head is the checked-out branch.
  const currentBranch = branches.find((b) => b.isCurrent)?.name;
  const mainBranch = branches.find((b) => b.isMain)?.name;
  const headIsCurrent = !!head && head === currentBranch;
  // A base resolving to head empties only the committed side (merge-base(head, head) is head); the uncommitted
  // sides still mean "just my uncommitted work", so force that axis on rather than refuse the base.
  const baseIsHead = from === "all" && !!head && (base || mainBranch || "") === head;
  const effectiveUncommitted = (uncommitted || baseIsHead) && headIsCurrent;
  // The side new comments and reviewed marks anchor to.
  const side: Side = !effectiveUncommitted ? "head" : unstaged ? "worktree" : "index";

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
        const list = r.repos ?? []; // a null list must not reach state from any source
        setRepos(list);
        const saved = getString(LS.repo);
        setRepo(saved && list.some((x) => x.name === saved) ? saved : (list[0]?.name ?? ""));
      })
      .catch((e) => setError((e as Error).message))
      .finally(() => setReposLoaded(true));
  }, []);

  useEffect(() => {
    reqSeq.current++;
    const seq = reqSeq.current;
    setLoading(false);
    setBranches([]);
    setBranchesLoaded(false);
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
        // A null here throws on the next render; normalize before anything reads it.
        const list = r.branches ?? [];
        setBranches(list);
        const current = list.find((b) => b.isCurrent);
        const firstLocal = list.find((b) => !b.isRemote);
        // Head is a local-only picker, so never default it to a remote.
        const headName = current?.name ?? firstLocal?.name ?? "";
        setHead(headName);
        // Restored here, in the same update as `head`: the guard effect below clears `uncommitted` whenever head
        // isn't the checked-out branch, which it never is while branches are loading.
        const view = readDiffViewPref(repo);
        if (view.uncommitted && current) {
          setUncommitted(true);
          setUnstaged(view.unstaged);
        }
        const savedBase = readBasePref(repo);
        if (savedBase === "" || (savedBase !== headName && list.some((b) => b.name === savedBase))) {
          setBase(savedBase);
        }
      })
      .catch((e) => {
        if (reqSeq.current === seq) setError((e as Error).message);
      })
      .finally(() => {
        if (reqSeq.current === seq) setBranchesLoaded(true);
      });
  }, [repo]);

  // The uncommitted axis is meaningless once head isn't the checked-out branch.
  useEffect(() => {
    if (!headIsCurrent && uncommitted) setUncommitted(false);
  }, [headIsCurrent, uncommitted]);

  // Re-enabling should start from the default; only the forced-off path above can leave `unstaged` behind.
  useEffect(() => {
    if (!uncommitted) setUnstaged(true);
  }, [uncommitted]);

  // The one place a Side becomes the two API axes: both move in one update and one pref write. Only the reviewer's
  // own pick persists — writing from an effect would let the guard above overwrite the stored choice.
  function changeSide(next: Side) {
    const nextUncommitted = next !== "head";
    const nextUnstaged = next !== "index";
    setUncommitted(nextUncommitted);
    setUnstaged(nextUnstaged);
    writeDiffViewPref(repo, { uncommitted: nextUncommitted, unstaged: nextUnstaged });
  }

  // Passing base scopes the list to base..head, so the picker offers only the branch's own commits.
  useEffect(() => {
    if (!repo || !head) return;
    let cancelled = false;
    api
      .commits(repo, head, base, COMMIT_LIMIT)
      .then((r) => {
        if (!cancelled) setCommits(r.commits ?? []);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [repo, head, base]);

  // The SSE effect is keyed on review.id alone, so it reads the live selection through this ref.
  const diffParams = useRef<{
    repo: string;
    headRef: string;
    head: string;
    base: string;
    from: string;
    opts: DiffOpts;
  }>({
    repo,
    headRef: "",
    head: "",
    base: "",
    from: "all",
    opts: { from: "all", uncommitted: false, unstaged: true },
  });
  useEffect(() => {
    diffParams.current = {
      repo,
      headRef: review?.headRef ?? "",
      head,
      base,
      from,
      opts: diffOpts(review?.baseRef ?? ""),
    };
  });

  // SSE refetch: a `diff` ping refetches review + diff (+ branches and commits); a `meta` ping only the review.
  useEffect(() => {
    if (!review) return;
    const id = review.id;
    let cancelled = false;
    let inFlight = false;
    let pending = false;
    let pendingDiff = false;
    // A `diff` ping deferred while hidden; the focus fallback stands down while the stream is OPEN, so nothing else would fetch it.
    let missedDiff = false;
    async function refresh(withDiff: boolean) {
      if (cancelled) return;
      // A hidden tab still takes the review (it feeds the unseen-activity badge) but defers the diff, which nothing renders.
      const hidden = document.visibilityState !== "visible";
      if (hidden && withDiff) missedDiff = true;
      withDiff = withDiff && !hidden;
      if (inFlight) {
        // Ping mid-fetch: queue exactly one trailing refetch, carrying the diff if any queued ping wanted it.
        pending = true;
        pendingDiff = pendingDiff || withDiff;
        return;
      }
      inFlight = true;
      // Snapshot the selection this read belongs to: an axis toggle keeps review.id, so `cancelled` never fires
      // and an older ping would otherwise land hunks from the side just left.
      const seq = reqSeq.current;
      const p = diffParams.current;
      // A `diff` ping also refreshes branches (out-of-band checkout) and the commit picker. Their failures are
      // swallowed: a `from` rebased away 400s the diff, and the check below then resets it instead of stranding the review.
      // Started before the try, which holds the await and nothing else — the compiler bails on a
      // conditional inside a try, and a bailed-out useReview hands unmemoized callbacks to DiffView.
      const revP = api.getReview(id);
      const diffP =
        withDiff && p.repo && p.headRef
          ? api.diff(p.repo, p.headRef, p.opts).catch(() => null)
          : Promise.resolve(null);
      const branchesP = withDiff && p.repo ? api.branches(p.repo).catch(() => null) : Promise.resolve(null);
      const commitsP =
        withDiff && p.repo && p.head
          ? api.commits(p.repo, p.head, p.base, COMMIT_LIMIT).catch(() => null)
          : Promise.resolve(null);
      let rev: Review | null = null;
      let d: DiffResponse | null = null;
      let br: { branches: Branch[] } | null = null;
      let cm: { commits: Commit[] } | null = null;
      try {
        [rev, d, br, cm] = await Promise.all([revP, diffP, branchesP, commitsP]);
      } catch {
        // Transient refresh failure — keep the current state.
      }
      if (rev && !cancelled) {
        const landed = rev;
        // Fetched by id, so not gated on seq — that would drop the comment/reviewed updates the ping came for.
        setReview((prev) => keepIfSame(prev, landed));
        setComments((prev) => keepIfSame(prev, landed.comments ?? []));
        setReviewedFiles((prev) => keepIfSameSet(prev, landed.reviewedFiles ?? []));
        if (reqSeq.current === seq) {
          if (d) {
            setFiles(d.files ?? []);
            setBaseSha(d.base ?? "");
          }
          if (br) setBranches((prev) => keepIfSame(prev, br.branches ?? []));
          if (cm) {
            const list = cm.commits ?? [];
            setCommits((prev) => keepIfSame(prev, list));
            // A rebased-away `from` would 400 the next diff; reset only when the list proves it (see fromWasRemoved).
            setFrom((cur) => (fromWasRemoved(cur, list) ? "all" : cur));
          }
        }
      }
      // Was a `finally`: the compiler can't lower one, so the drain runs on the straight-line
      // path instead. Nothing above throws — the only await is inside the try.
      inFlight = false;
      if (pending && !cancelled) {
        pending = false;
        const wantDiff = pendingDiff;
        pendingDiff = false;
        refresh(wantDiff);
      }
    }
    const es = new EventSource(`/api/reviews/${id}/events`);
    es.onmessage = (e) => refresh(e.data === "diff");
    // No onerror — EventSource auto-reconnects; the focus fallback covers the gap.
    function onFocus() {
      if (document.visibilityState !== "visible") return; // also fires on hide
      if (missedDiff) {
        missedDiff = false;
        refresh(true); // a ping deferred its diff while the tab was hidden
        return;
      }
      if (es.readyState === EventSource.OPEN) return; // stream live — it'll push
      // A dead stream may have missed a content change.
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

  // Refetch the diff on an axis change. Bail while the review is stale relative to the head picker (a head change
  // resets `from` first): startReview owns that fetch, and running here would bump reqSeq out from under it.
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
    // Deliberately keyed on the view axes only — repo/head/review changes go through startReview.
  }, [from, uncommitted, unstaged]);

  // `from` resets in the same update as head, so the auto-started startReview reads the fresh value.
  function changeHead(name: string) {
    setHead(name);
    setFrom("all");
    // Head as its own base would compare a branch with itself; the stored pref stays — it's still the base for other heads.
    if (base === name) setBase("");
  }

  // Clearing head synchronously keeps auto-start from firing startReview with the old repo's head, which would bump
  // reqSeq and discard the in-flight branch fetch.
  function changeRepo(name: string) {
    setRepo(name);
    setHead("");
  }

  // recoverHead handles a failed start: head may be gone (deleted/renamed/mid-rebase), in which case
  // fall back to the checked-out branch and let auto-start re-fire. Reports whether it recovered;
  // a false means the caller should surface the original error. Split out of startReview's catch
  // because the `??` chain below cannot live inside a try block without bailing the compiler out.
  async function recoverHead(seq: number): Promise<boolean> {
    let branchList = null;
    try {
      branchList = await api.branches(repo);
    } catch {
      // ignore — the caller surfaces the original error
    }
    if (!branchList) return false;
    const list = branchList.branches ?? [];
    if (reqSeq.current !== seq || list.some((b) => b.name === head)) return false;
    setBranches(list);
    const current = list.find((b) => b.isCurrent);
    const firstLocal = list.find((b) => !b.isRemote);
    changeHead(current?.name ?? firstLocal?.name ?? "");
    return true;
  }

  async function startReview() {
    if (!repo || !head) return;
    const seq = ++reqSeq.current;
    setLoading(true);
    setError(null);
    // Built before the await, for the same reason as in refresh above.
    const baseArg = base || undefined;
    let rev: Review | null = null;
    let failure: Error | null = null;
    try {
      rev = await api.createReview(repo, head, baseArg);
    } catch (e) {
      failure = e as Error;
    }
    // Each `reqSeq` check is what the old early returns did: superseded by a repo switch / newer load.
    if (rev && reqSeq.current === seq) {
      setReview(rev);
      setComments(rev.comments ?? []);
      setReviewedFiles(new Set(rev.reviewedFiles ?? []));
      const opts = diffOpts(rev.baseRef);
      const headRef = rev.headRef;
      let diff: DiffResponse | null = null;
      try {
        diff = await api.diff(repo, headRef, opts);
      } catch (e) {
        failure = e as Error;
      }
      if (diff && reqSeq.current === seq) {
        setFiles(diff.files ?? []);
        setBaseSha(diff.base ?? "");
      }
    }
    if (failure && reqSeq.current === seq) {
      const recovered = await recoverHead(seq);
      if (!recovered && reqSeq.current === seq) setError(failure.message);
    }
    // Was a `finally`; the seq gate is unchanged, so a superseded load still leaves loading alone.
    if (reqSeq.current === seq) setLoading(false);
  }

  // Auto-start on a complete selection; the view axes have their own refetch effect, so they're not deps.
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
      setReview((r) => (r ? { ...r, summary: "" } : r));
    } catch (e) {
      setError((e as Error).message);
    }
  }

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
      await api.setReviewed(review.id, paths, reviewed, side);
    } catch (e) {
      apply(!reviewed); // rollback the whole batch
      setError((e as Error).message);
    }
  }

  const toggleReviewed = (path: string, reviewed: boolean) => setReviewedPaths([path], reviewed);

  // Trimmed here as well as server-side, so the optimistic value matches what a refetch returns.
  async function setSummary(text: string) {
    if (!review) return;
    const summary = text.trim();
    const previous = review.summary;
    setError(null);
    setReview((r) => (r ? { ...r, summary } : r));
    try {
      await api.setSummary(review.id, summary);
    } catch (e) {
      setReview((r) => (r ? { ...r, summary: previous } : r));
      setError((e as Error).message);
    }
  }

  const shortSha = review?.headSha.slice(0, 7);
  const repoOptions = useMemo<ComboOption[]>(
    () => repos.map((r) => ({ value: r.name, label: r.name, hint: relativeDay(r.lastActivity) })),
    [repos]
  );
  const localBranches = useMemo(() => branches.filter((b) => !b.isRemote), [branches]);
  const headOptions = useMemo<ComboOption[]>(
    () => localBranches.map((b) => ({ value: b.name, label: b.name, hint: branchHint(b, b.isCurrent && "current") })),
    [localBranches]
  );
  // Head is a valid base only while an uncommitted side shows (the committed range would be empty). The
  // `base === head` clause keeps an already-set value labelled: Combobox blanks a value missing from its options.
  const baseOptions = useMemo<ComboOption[]>(() => {
    const offerHead = effectiveUncommitted || base === head;
    const opts: ComboOption[] = [{ value: "", label: `auto${mainBranch ? ` (${mainBranch})` : ""}` }];
    for (const b of localBranches) {
      if (b.name === head && !offerHead) continue;
      opts.push({ value: b.name, label: b.name, hint: branchHint(b, b.isMain && "main") });
    }
    for (const b of branches.filter((b) => b.isRemote)) {
      opts.push({
        value: b.name,
        label: b.name,
        hint: branchHint(b, b.isMain && "main"),
        group: "remote (last fetched)",
      });
    }
    return opts;
  }, [branches, localBranches, mainBranch, head, base, effectiveUncommitted]);
  // The commits are `rail` options (the range preview's timeline); All is not, which tells the preview a pick of it includes them all.
  const fromOptions = useMemo<ComboOption[]>(() => {
    const opts: ComboOption[] = [
      { value: "all", label: "All (whole branch)" },
      ...commits.map((c) => ({
        value: c.sha,
        label: `${c.shortSha}  ${c.subject}`,
        hint: c.relDate,
        rail: true,
      })),
    ];
    // A pick that slid out of the COMMIT_LIMIT window keeps its view (see fromWasRemoved), and Combobox blanks a
    // value missing from its options — so append it, last, since it's older than every commit listed.
    if (from !== "all" && !commits.some((c) => c.sha === from)) {
      opts.push({ value: from, label: from.slice(0, 7), hint: "picked earlier", rail: true });
    }
    return opts;
  }, [commits, from]);

  return {
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
    // What decides whether the from picker has a choice to offer (TopBar disables it under two).
    commitCount: commits.length,
    loading,
    error,
    setError,
    headIsCurrent,
    baseIsHead,
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
  };
}
