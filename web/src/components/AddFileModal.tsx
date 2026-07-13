import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api";
import { Modal } from "./Modal";

interface Props {
  repo: string;
  headRef: string;
  // Paths already shown in the review (diff files + previously opened) — marked
  // so the reviewer sees selecting one just jumps to the existing card.
  present: Set<string>;
  onSelect: (path: string) => void;
  onClose: () => void;
}

const MAX_RESULTS = 200;

// A typeahead over the repo's tracked files (at head) for commenting on a file
// the branch didn't change.
export function AddFileModal({ repo, headRef, present, onSelect, onClose }: Props) {
  const [files, setFiles] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .files(repo, headRef)
      .then((r) => {
        if (!cancelled) setFiles(r.files ?? []);
      })
      .catch((e) => {
        if (!cancelled) setError((e as Error).message);
      });
    return () => {
      cancelled = true;
    };
  }, [repo, headRef]);

  const matches = useMemo(() => {
    if (!files) return [];
    const q = query.trim().toLowerCase();
    const hits = q === "" ? files : files.filter((f) => f.toLowerCase().includes(q));
    return hits.slice(0, MAX_RESULTS);
  }, [files, query]);

  // Keep the active index in range as the filtered list shrinks/grows.
  useEffect(() => {
    setActive((a) => (matches.length === 0 ? 0 : Math.min(a, matches.length - 1)));
  }, [matches]);

  // Follow the keyboard-selected row into view.
  useEffect(() => {
    listRef.current?.children[active]?.scrollIntoView({ block: "nearest" });
  }, [active]);

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, matches.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const path = matches[active];
      if (path) onSelect(path);
    }
  }

  return (
    <Modal onClose={onClose} labelledBy="addfile-title" className="modal-sm">
      <div className="modal-head">
        <h2 id="addfile-title">Add a file to comment on</h2>
        <span className="spacer" />
        <button className="btn" onClick={onClose}>
          Close
        </button>
      </div>
      <div className="addfile-body">
        <input
          type="text"
          className="addfile-search"
          placeholder="Filter files…"
          value={query}
          data-autofocus
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
        />
        {error && <div className="error file-error">{error}</div>}
        {!files && !error && (
          <div className="muted addfile-empty">
            <span className="spinner" aria-hidden="true" /> Loading files…
          </div>
        )}
        {files && matches.length === 0 && (
          <div className="muted addfile-empty">No matching files.</div>
        )}
        <ul className="addfile-list" ref={listRef}>
          {matches.map((path, i) => (
            <li key={path}>
              <button
                className={`addfile-item${i === active ? " active" : ""}`}
                onMouseEnter={() => setActive(i)}
                onClick={() => onSelect(path)}
                title={path}
              >
                <span className="fname">{path}</span>
                {present.has(path) && <span className="muted addfile-present">in review</span>}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </Modal>
  );
}
