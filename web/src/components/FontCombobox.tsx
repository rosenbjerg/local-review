import { Fragment, useId, useLayoutEffect, useMemo, useRef, useState } from "react";

import { normalizeName, quoteFamily } from "../fonts";
import { useListNavigation } from "../useListNavigation";
import { Chevron } from "./Chevron";

interface Props {
  label: string;
  // The repo's own pick, empty while it inherits. Free text: a face the probe missed, or a stack.
  value: string;
  // What an empty value falls back to, and what the clear row restores.
  fallback: string;
  fallbackLabel: string;
  // Shipped with the app, so offered whatever the machine has.
  bundled: readonly string[];
  // Candidates this machine turned out to have.
  installed: readonly string[];
  fallbackVar: string;
  sample?: string;
  onChange: (value: string) => void;
}

interface Row {
  face: string;
  value: string;
  hint: string;
  group: string;
}

interface Pos {
  top?: number;
  bottom?: number;
  left: number;
  minWidth: number;
  maxHeight: number;
}

const MARGIN = 12;
const FLIP_BELOW = 160;

export function FontCombobox({
  label,
  value,
  fallback,
  fallbackLabel,
  bundled,
  installed,
  fallbackVar,
  sample,
  onChange,
}: Props) {
  const [open, setOpen] = useState(false);
  // Filtering follows what has been typed since opening, not the value: the value is a face name, so
  // reopening after a pick would otherwise filter the list down to the face already chosen.
  const [typed, setTyped] = useState(false);
  const [pos, setPos] = useState<Pos | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const listId = useId();

  const faces = useMemo(
    () => [
      ...bundled.map((name) => ({ name, group: "Bundled" })),
      ...installed.map((name) => ({ name, group: "On this machine" })),
    ],
    [bundled, installed]
  );

  const rows: Row[] = useMemo(() => {
    // Matched on the normalized form, so the spacing someone would naturally type still finds the face.
    const q = typed ? normalizeName(value) : "";
    const matched = faces
      .filter((f) => q === "" || normalizeName(f.name).includes(q))
      .map((f) => ({ face: f.name, value: f.name, hint: "", group: f.group }));
    // The clear row is an action, not a face, so it only stands while nothing is being searched for.
    if (q !== "") return matched;
    return [{ face: fallback, value: "", hint: fallbackLabel, group: "" }, ...matched];
  }, [faces, value, typed, fallback, fallbackLabel]);

  const nav = useListNavigation({
    length: rows.length,
    onPick: (i) => choose(rows[i].value),
    listRef,
    open,
  });

  // Anchored to the viewport: the settings modal's scrolling body would clip an absolute list, and
  // the modal's entrance animation leaves no transform behind to make `fixed` mean something else.
  // Sized to the room actually there, so the list never needs scrolling to before it can be read.
  useLayoutEffect(() => {
    if (!open) return;
    const el = inputRef.current;
    if (el) {
      const r = el.getBoundingClientRect();
      const below = window.innerHeight - r.bottom - MARGIN;
      const above = r.top - MARGIN;
      // minWidth, not width: a face name plus its sample can outgrow the input, and the base rule's
      // max-width still keeps the list from running away.
      setPos(
        below < FLIP_BELOW && above > below
          ? { bottom: window.innerHeight - r.top + 2, left: r.left, minWidth: r.width, maxHeight: above }
          : { top: r.bottom + 2, left: r.left, minWidth: r.width, maxHeight: below }
      );
    }
    // Dismissed rather than followed: the anchor moves under any scroller between here and the page.
    // The list's own scrolling is exempt, or following the keyboard selection would close it.
    const close = (e: Event) => {
      if (e.target instanceof Node && listRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [open]);

  function openList() {
    setTyped(false);
    setOpen(true);
    // The clear row occupies index 0, so a face's row is one past its place in the list of faces.
    const i = faces.findIndex((f) => f.name === value.trim());
    nav.setActive(i < 0 ? 0 : i + 1);
  }

  function choose(next: string) {
    onChange(next);
    setOpen(false);
    inputRef.current?.blur();
  }

  function stackFor(face: string): string {
    return `${quoteFamily(face)}, var(${fallbackVar})`;
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (!open) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        openList();
      }
      return;
    }
    if (nav.onKeyDown(e)) return;
    if (e.key === "Escape") {
      // Swallowed, or the modal takes it as a request to close.
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
    }
  }

  return (
    <>
      <div className="font-input-wrap">
        <input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-label={label}
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open && rows[nav.active] ? `${listId}-${nav.active}` : undefined}
          className="font-input"
          value={value}
          placeholder={fallback}
          spellCheck={false}
          onChange={(e) => {
            onChange(e.target.value);
            setTyped(true);
            nav.setActive(0);
            setOpen(true);
          }}
          onFocus={openList}
          onClick={() => {
            if (!open) openList();
          }}
          onBlur={() => setOpen(false)}
          onKeyDown={onKeyDown}
        />
        <Chevron open={open} className="combobox-caret" />
      </div>
      {open && (
        <ul
          className="combobox-list floating"
          role="listbox"
          id={listId}
          ref={listRef}
          // Hidden until measured, so the first frame can't flash at the top-left corner.
          style={{ ...pos, visibility: pos ? "visible" : "hidden" }}
        >
          {rows.map((row, i) => {
            const heading = row.group && row.group !== rows[i - 1]?.group ? row.group : null;
            return (
              <Fragment key={row.value || " default"}>
                {heading && (
                  <li className="combobox-group" aria-hidden="true">
                    {heading}
                  </li>
                )}
                <li
                  role="option"
                  id={`${listId}-${i}`}
                  aria-selected={row.value === value}
                  data-idx={i}
                  className={`combobox-option${i === nav.active ? " active" : ""}`}
                  // Mousedown, not click: preventDefault keeps focus, so this can't blur-close mid-pick.
                  onMouseDown={(e) => {
                    e.preventDefault();
                    choose(row.value);
                  }}
                  onMouseEnter={() => nav.setActive(i)}
                >
                  <span className="combobox-label" style={{ fontFamily: stackFor(row.face) }}>
                    {row.value === "" ? row.hint : row.value}
                  </span>
                  {row.value === "" ? (
                    <span className="combobox-hint">{row.face}</span>
                  ) : (
                    sample && (
                      <span className="font-sample" style={{ fontFamily: stackFor(row.face) }}>
                        {sample}
                      </span>
                    )
                  )}
                </li>
              </Fragment>
            );
          })}
          {/* The list only holds what it thought to probe for, so it has to say it isn't the limit. */}
          <li className="combobox-foot" aria-hidden="true">
            Any other font installed here works — type its name
          </li>
        </ul>
      )}
    </>
  );
}
