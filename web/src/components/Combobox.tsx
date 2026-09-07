import { Fragment, useEffect, useId, useMemo, useRef, useState } from "react";
import { Chevron } from "./Chevron";

export interface ComboOption {
  value: string;
  label: string;
  hint?: string; // trailing muted annotation, e.g. "current" / "main"
  group?: string; // options sharing a group get a heading before the first of them
  rail?: boolean; // a point on the list's timeline, for `rangePreview` (the from picker's commits)
}

interface Props {
  value: string;
  options: ComboOption[];
  onChange: (value: string) => void;
  ariaLabel: string;
  disabled?: boolean;
  emptyText?: string;
  // The list is a timeline, newest first, and a pick means "from here onward": the
  // row under the pointer (or the arrow keys) is the origin, every `rail` row above
  // it is included, and a row that isn't on the rail ("All") includes them all.
  rangePreview?: boolean;
}

// A searchable single-select: shows the selected label until focused, then lets
// you type to filter and pick with the mouse or arrow keys/Enter. Native <select>
// can't filter, which gets unwieldy with many branches.
export function Combobox({
  value,
  options,
  onChange,
  ariaLabel,
  disabled,
  emptyText,
  rangePreview,
}: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const listId = useId();

  const selectedLabel = options.find((o) => o.value === value)?.label ?? "";

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q === "") return options;
    return options.filter((o) => o.label.toLowerCase().includes(q));
  }, [options, query]);

  // The range preview's shape over the filtered rows: where the rail starts and
  // ends, and where the included run ends — at the active row when that row is on
  // the rail, else (All is active) at the rail's last row. Rail rows are contiguous
  // and the filter keeps their order, so the run is an index range, which is also
  // what lets its first and last row keep the rounded corners the inner rows give
  // up (adjacent rounded rows notch at every seam).
  const rail = useMemo(() => {
    if (!rangePreview) return null;
    let first = -1;
    let last = -1;
    filtered.forEach((o, i) => {
      if (!o.rail) return;
      if (first < 0) first = i;
      last = i;
    });
    if (first < 0) return null;
    return { first, last, end: filtered[active]?.rail ? active : last };
  }, [rangePreview, filtered, active]);

  function rowClass(o: ComboOption, i: number): string {
    const included = rail !== null && o.rail === true && i >= rail.first && i <= rail.end;
    return [
      "combobox-option",
      i === active && "active",
      rail !== null && o.rail && "rail",
      rail !== null && i === rail.first && "rail-first",
      rail !== null && i === rail.last && "rail-last",
      included && "included",
      included && i === rail.first && "included-first",
      included && i === rail.end && "included-last",
      included && i === active && "origin",
    ]
      .filter(Boolean)
      .join(" ");
  }

  // Keep the highlighted row in range as filtering shrinks the list.
  useEffect(() => {
    setActive((a) => (filtered.length === 0 ? 0 : Math.min(a, filtered.length - 1)));
  }, [filtered]);

  // Follow the keyboard selection into view.
  useEffect(() => {
    if (open) listRef.current?.querySelector(`[data-idx="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active, open]);

  function openList() {
    if (disabled) return;
    setQuery("");
    setActive(Math.max(0, options.findIndex((o) => o.value === value)));
    setOpen(true);
  }

  function choose(opt: ComboOption) {
    onChange(opt.value);
    setOpen(false);
    setQuery("");
    inputRef.current?.blur();
  }

  function onKeyDown(e: React.KeyboardEvent) {
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        if (!open) openList();
        else setActive((a) => Math.min(a + 1, filtered.length - 1));
        break;
      case "ArrowUp":
        if (open) {
          e.preventDefault();
          setActive((a) => Math.max(a - 1, 0));
        }
        break;
      case "Enter":
        if (open && filtered[active]) {
          e.preventDefault();
          choose(filtered[active]);
        }
        break;
      case "Escape":
        if (open) {
          // Swallow it so the app's global handlers / modals don't also react.
          e.preventDefault();
          e.stopPropagation();
          setOpen(false);
          setQuery("");
        }
        break;
    }
  }

  return (
    <div className="combobox">
      <input
        ref={inputRef}
        type="text"
        role="combobox"
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && filtered[active] ? `${listId}-${active}` : undefined}
        className="combobox-input"
        disabled={disabled}
        title={!open ? selectedLabel : undefined}
        value={open ? query : selectedLabel}
        placeholder={open ? selectedLabel : undefined}
        onChange={(e) => {
          setQuery(e.target.value);
          setActive(0);
          if (!open) setOpen(true);
        }}
        onFocus={openList}
        onClick={() => {
          if (!open) openList();
        }}
        onBlur={() => {
          setOpen(false);
          setQuery("");
        }}
        onKeyDown={onKeyDown}
      />
      <Chevron open={open} className="combobox-caret" />
      {open && (
        <ul
          className={`combobox-list${rangePreview ? " range-list" : ""}`}
          role="listbox"
          id={listId}
          ref={listRef}
        >
          {filtered.length === 0 && (
            <li className="combobox-empty">{emptyText ?? "No matches"}</li>
          )}
          {filtered.map((o, i) => {
            const heading = o.group && o.group !== filtered[i - 1]?.group ? o.group : null;
            return (
              <Fragment key={o.value}>
                {heading && (
                  <li className="combobox-group" aria-hidden="true">
                    {heading}
                  </li>
                )}
                <li
                  role="option"
                  id={`${listId}-${i}`}
                  aria-selected={o.value === value}
                  data-idx={i}
                  className={rowClass(o, i)}
                  // Select on mousedown (not click): preventDefault keeps focus so
                  // this doesn't blur-close mid-pick, and it fires even when a
                  // following click event wouldn't reach us.
                  onMouseDown={(e) => {
                    e.preventDefault();
                    choose(o);
                  }}
                  onMouseEnter={() => setActive(i)}
                  title={o.label}
                >
                  <span className="combobox-label">{o.label}</span>
                  {o.hint && <span className="combobox-hint">{o.hint}</span>}
                </li>
              </Fragment>
            );
          })}
        </ul>
      )}
    </div>
  );
}
