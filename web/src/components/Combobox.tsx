import { Fragment, useEffect, useId, useMemo, useRef, useState } from "react";
import { Chevron } from "./Chevron";

export interface ComboOption {
  value: string;
  label: string;
  hint?: string; // trailing muted annotation, e.g. "current" / "main"
  group?: string; // options sharing a group get a heading before the first of them
}

interface Props {
  value: string;
  options: ComboOption[];
  onChange: (value: string) => void;
  ariaLabel: string;
  disabled?: boolean;
  emptyText?: string;
}

// A searchable single-select: shows the selected label until focused, then lets
// you type to filter and pick with the mouse or arrow keys/Enter. Native <select>
// can't filter, which gets unwieldy with many branches.
export function Combobox({ value, options, onChange, ariaLabel, disabled, emptyText }: Props) {
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
          // Option clicks preventDefault their mousedown, so focus stays and this
          // doesn't fire for them — it only closes on a click/tab away.
          setOpen(false);
          setQuery("");
        }}
        onKeyDown={onKeyDown}
      />
      <Chevron open={open} className="combobox-caret" />
      {open && (
        <ul className="combobox-list" role="listbox" id={listId} ref={listRef}>
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
                  className={`combobox-option${i === active ? " active" : ""}`}
                  onMouseDown={(e) => e.preventDefault()}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => choose(o)}
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
