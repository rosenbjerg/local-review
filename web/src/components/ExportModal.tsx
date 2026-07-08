import { useEffect, useMemo, useState } from "react";
import MarkdownIt from "markdown-it";
import { api } from "../api";

interface Props {
  reviewId: number;
  onClose: () => void;
}

// html:false escapes any raw HTML in comment bodies — safe to render.
const md = new MarkdownIt({ html: false, linkify: true, breaks: false });

export function ExportModal({ reviewId, onClose }: Props) {
  const [markdown, setMarkdown] = useState("");
  const [filename, setFilename] = useState("review.md");
  const [error, setError] = useState<string | null>(null);
  const [copyState, setCopyState] = useState<"idle" | "ok" | "fail">("idle");
  const [view, setView] = useState<"preview" | "raw">("preview");

  useEffect(() => {
    api
      .export(reviewId)
      .then((r) => {
        setMarkdown(r.markdown);
        setFilename(r.filename);
      })
      .catch((e) => setError((e as Error).message));
  }, [reviewId]);

  const html = useMemo(() => md.render(markdown), [markdown]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(markdown); // always the raw markdown
      setCopyState("ok");
    } catch {
      setCopyState("fail");
    }
    setTimeout(() => setCopyState("idle"), 1500);
  }

  function download() {
    const blob = new Blob([markdown], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>Export review</h2>
          <div className="view-toggle">
            <button
              className={view === "preview" ? "active" : ""}
              onClick={() => setView("preview")}
            >
              Preview
            </button>
            <button className={view === "raw" ? "active" : ""} onClick={() => setView("raw")}>
              Raw
            </button>
          </div>
          <span className="spacer" />
          <button className="btn" onClick={copy}>
            {copyState === "ok" ? "Copied ✓" : copyState === "fail" ? "Copy failed" : "Copy markdown"}
          </button>
          <button className="btn btn-primary" onClick={download}>
            Download .md
          </button>
          <button className="btn" onClick={onClose}>
            Close
          </button>
        </div>
        {error ? (
          <p className="error">{error}</p>
        ) : view === "preview" ? (
          <div className="markdown-body" dangerouslySetInnerHTML={{ __html: html }} />
        ) : (
          <pre className="markdown-preview">{markdown}</pre>
        )}
      </div>
    </div>
  );
}
