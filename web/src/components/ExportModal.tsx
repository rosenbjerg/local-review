import { useEffect, useMemo, useState } from "react";
import MarkdownIt from "markdown-it";
import { api } from "../api";

interface Props {
  reviewId: number;
  onClose: () => void;
}

// html:false escapes any raw HTML in comment bodies — safe to render.
const md = new MarkdownIt({ html: false, linkify: true, breaks: false });

const LS_INSTRUCTIONS = "lr.exportInstructions";

export function ExportModal({ reviewId, onClose }: Props) {
  const [markdown, setMarkdown] = useState("");
  const [filename, setFilename] = useState("review.md");
  const [error, setError] = useState<string | null>(null);
  const [copyState, setCopyState] = useState<"idle" | "ok" | "fail">("idle");
  const [view, setView] = useState<"preview" | "raw">("preview");
  const [instructions, setInstructions] = useState(
    () => localStorage.getItem(LS_INSTRUCTIONS) === "true"
  );

  useEffect(() => {
    api
      .export(reviewId, instructions)
      .then((r) => {
        setMarkdown(r.markdown);
        setFilename(r.filename);
      })
      .catch((e) => setError((e as Error).message));
  }, [reviewId, instructions]);

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
          <label
            className="checkbox"
            title="Append instructions telling a coding agent how to reply to these comments over HTTP"
          >
            <input
              type="checkbox"
              checked={instructions}
              onChange={(e) => {
                setInstructions(e.target.checked);
                localStorage.setItem(LS_INSTRUCTIONS, String(e.target.checked));
              }}
            />
            agent reply instructions
          </label>
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
