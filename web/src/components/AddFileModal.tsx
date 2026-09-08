import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api";
import { useListNavigation } from "../useListNavigation";
import { Modal } from "./Modal";
import { SearchInput } from "./SearchInput";

interface Props {
  repo: string;
  headRef: string;
  // Paths already shown in the review, marked so selecting one reads as a jump to the existing card.
  present: Set<string>;
  onSelect: (path: string) => void;
  onClose: () => void;
}

const MAX_RESULTS = 200;

// A typeahead over the repo's tracked files, for commenting on a file the branch didn't change.
export function AddFileModal({ repo, headRef, present, onSelect, onClose }: Props) {
  const [files, setFiles] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
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

  const { active, setActive, onKeyDown } = useListNavigation({
    length: matches.length,
    onPick: (i) => onSelect(matches[i]),
    listRef,
  });

  return (
    <Modal onClose={onClose} title="Add a file to comment on" className="modal-sm">
      <div className="addfile-body">
        {/* An empty field's Escape bubbles: in here it means close the dialog. */}
        <SearchInput
          autoFocus
          emptyEscape="bubble"
          value={query}
          onChange={setQuery}
          ariaLabel="Filter files"
          placeholder="Filter files…"
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
            <li key={path} data-idx={i}>
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
