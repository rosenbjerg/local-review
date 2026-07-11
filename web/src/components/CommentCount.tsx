// Monochrome speech-bubble + number for thread/reply counts (inherits
// currentColor, unlike a 💬 emoji). `label` names the unit for screen readers.
export function CommentCount({ n, label = "comment" }: { n: number; label?: string }) {
  return (
    <span className="comment-count" aria-label={`${n} ${label}${n === 1 ? "" : "s"}`}>
      <svg viewBox="0 0 16 16" width="12" height="12" fill="currentColor" aria-hidden="true">
        <path d="M1 2.75C1 1.784 1.784 1 2.75 1h10.5c.966 0 1.75.784 1.75 1.75v7.5A1.75 1.75 0 0 1 13.25 12H9.06l-2.573 2.573A1.457 1.457 0 0 1 4 13.543V12H2.75A1.75 1.75 0 0 1 1 10.25Zm1.75-.25a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h2a.75.75 0 0 1 .75.75v2.19l2.72-2.72a.749.749 0 0 1 .53-.22h4.5a.25.25 0 0 0 .25-.25v-7.5a.25.25 0 0 0-.25-.25Z" />
      </svg>
      <span aria-hidden="true">{n}</span>
    </span>
  );
}
