import { useState } from "react";
import { CopyButton } from "./CopyButton";
import { Modal } from "./Modal";
import { ViewToggle } from "./ViewToggle";

export interface AgentPrompt {
  value: string; // stable key for the toggle
  label: string; // segmented-control label
  text: string; // the prompt body, copied verbatim
}

// Modal that shows a set of agent prompts, one at a time, with a segmented
// control to switch and a Copy button for the active one. Purely presentational:
// the caller builds the prompt strings (they depend on the current review).
export function AgentPromptsModal({
  prompts,
  onClose,
}: {
  prompts: AgentPrompt[];
  onClose: () => void;
}) {
  const [active, setActive] = useState(prompts[0].value);
  const current = prompts.find((p) => p.value === active) ?? prompts[0];

  return (
    <Modal onClose={onClose} labelledBy="prompts-title" className="modal-md">
      <div className="modal-head">
        <h2 id="prompts-title">Agent prompts</h2>
        <ViewToggle
          ariaLabel="Prompt"
          value={active}
          onChange={setActive}
          options={prompts.map((p) => ({ value: p.value, label: p.label }))}
        />
        <span className="spacer" />
        <CopyButton className="btn copy-btn" text={current.text} idleLabel="Copy" />
        <button className="btn" onClick={onClose}>
          Close
        </button>
      </div>
      <pre className="markdown-preview">{current.text}</pre>
    </Modal>
  );
}
