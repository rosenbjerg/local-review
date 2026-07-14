import { useEffect, useMemo, useState } from "react";
import MarkdownIt from "markdown-it";
import { api } from "../api";
import { highlightBlocks } from "../highlight";
import { LS, getBool, setBool } from "../storage";
import { CopyButton } from "./CopyButton";
import { Modal } from "./Modal";
import { ViewToggle } from "./ViewToggle";

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
  const [view, setView] = useState<"preview" | "raw">("preview");
  const [instructions, setInstructions] = useState(() => getBool(LS.exportInstructions));

  useEffect(() => {
    // `ignore` drops an out-of-order response: the instructions checkbox refires
    // this, and a slower earlier request must not overwrite a newer one.
    let ignore = false;
    api
      .export(reviewId, instructions)
      .then((r) => {
        if (ignore) return;
        setError(null);
        setMarkdown(r.markdown);
        setFilename(r.filename);
      })
      .catch((e) => {
        if (!ignore) setError((e as Error).message);
      });
    return () => {
      ignore = true;
    };
  }, [reviewId, instructions]);

  const base = useMemo(() => md.render(markdown), [markdown]);
  const [html, setHtml] = useState(base);

  useEffect(() => {
    setHtml(base);
    let cancelled = false;
    highlightBlocks(base).then((enhanced) => {
      if (!cancelled && enhanced) setHtml(enhanced);
    });
    return () => {
      cancelled = true;
    };
  }, [base]);

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
    <Modal onClose={onClose} labelledBy="export-title">
      <div className="modal-head">
        <h2 id="export-title">Export review</h2>
        <ViewToggle
          ariaLabel="Export view"
          value={view}
          onChange={setView}
          options={[
            { value: "preview", label: "Preview" },
            { value: "raw", label: "Raw" },
          ]}
        />
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
              setBool(LS.exportInstructions, e.target.checked);
            }}
          />
          agent reply instructions
        </label>
        <CopyButton className="btn copy-btn" text={markdown} idleLabel="Copy markdown" />
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
    </Modal>
  );
}
