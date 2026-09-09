import { Fragment, useCallback, useId, useMemo, useRef, useState } from "react";
import { useAnchoredList } from "../useAnchoredList";
import { useListNavigation } from "../useListNavigation";
import { Chevron } from "./Chevron";

export interface ComboOption {
  value: string;
  label: string;
  hint?: string; // trailing muted annotation, e.g. "current" / "main"
  group?: string; // options sharing a group get a heading before the first of them
  rail?: boolean; // a point on the list's timeline, for `rangePreview` (the from picker's commits)
  // A theme id. The row carries it as `data-theme`, which paints the row in that theme's own tokens
  // rather than a palette copied into TypeScript — see the theme blocks in styles.css.
  swatch?: string;
}

interface Props {
  value: string;
  options: ComboOption[];
  onChange: (value: string) => void;
  ariaLabel: string;
  disabled?: boolean;
  emptyText?: string;
  // Draws the list as a timeline: the active row is the origin, every `rail` row above it is
  // included, and an off-rail row (All) includes them all.
  rangePreview?: boolean;
  // Position against the viewport instead of the input. Needed inside a scrolling container, which
  // would otherwise clip the list; the topbar's pickers have no scroller over them and don't set it.
  floating?: boolean;
}

// A searchable single-select; a native <select> can't filter, which gets unwieldy with many branches.
export function Combobox({
  value,
  options,
  onChange,
  ariaLabel,
  disabled,
  emptyText,
  rangePreview,
  floating,
}: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const listId = useId();

  const selectedLabel = options.find((o) => o.value === value)?.label ?? "";

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q === "") return options;
    return options.filter((o) => o.label.toLowerCase().includes(q));
  }, [options, query]);

  const close = useCallback(() => setOpen(false), []);
  const pos = useAnchoredList(floating === true && open, inputRef, listRef, close);

  const nav = useListNavigation({
    length: filtered.length,
    onPick: (i) => choose(filtered[i]),
    listRef,
    open,
  });
  const { active, setActive } = nav;

  // Rail rows are contiguous and the filter keeps their order, so the included run is an index
  // range — which also lets its end rows keep the rounded corners the inner rows give up.
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
      o.swatch && "theme-option",
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
    if (!open) {
      // Closed, the arrow is what opens it; every other key is the input's own.
      if (e.key === "ArrowDown") {
        e.preventDefault();
        openList();
      }
      return;
    }
    if (nav.onKeyDown(e)) return;
    if (e.key === "Escape") {
      // Swallow it so the app's global handlers / modals don't also react.
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
      setQuery("");
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
          className={`combobox-list${rangePreview ? " range-list" : ""}${floating ? " floating" : ""}`}
          role="listbox"
          id={listId}
          ref={listRef}
          // Hidden until measured, so the first frame can't flash at the top-left corner.
          style={floating ? { ...pos, visibility: pos ? "visible" : "hidden" } : undefined}
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
                  data-theme={o.swatch}
                  className={rowClass(o, i)}
                  // Mousedown, not click: preventDefault keeps focus, so this can't blur-close mid-pick.
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
