import { useEffect, useState } from "react";
import { api } from "../api";

interface Props {
  reviewId: number;
  onClose: () => void;
}

export function ExportModal({ reviewId, onClose }: Props) {
  const [markdown, setMarkdown] = useState("");
  const [filename, setFilename] = useState("review.md");
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    api
      .export(reviewId)
      .then((r) => {
        setMarkdown(r.markdown);
        setFilename(r.filename);
      })
      .catch((e) => setError((e as Error).message));
  }, [reviewId]);

  async function copy() {
    await navigator.clipboard.writeText(markdown);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
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
          <span className="spacer" />
          <button className="btn" onClick={copy}>
            {copied ? "Copied ✓" : "Copy markdown"}
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
        ) : (
          <pre className="markdown-preview">{markdown}</pre>
        )}
      </div>
    </div>
  );
}
