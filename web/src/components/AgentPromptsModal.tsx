import { useState } from "react";
import { AGENT_PROMPTS, PROMPT_GROUPS, PROMPT_PLACEHOLDERS, renderPrompt } from "../prompts";
import type { PromptGroup, PromptKind, PromptVars, ReviewVars } from "../prompts";
import { clearPromptOverride, readPromptOverride, writePromptOverride } from "../storage";
import { CopyButton } from "./CopyButton";
import { Modal } from "./Modal";
import { ViewToggle } from "./ViewToggle";

type ByKind<T> = Record<PromptKind, T>;

// `saved` is what this repo has stored (null = still the built-in template); `drafts`
// is what the textarea edits. Both are held per kind rather than for the shown prompt
// alone, so switching prompts mid-edit doesn't discard another one's work — every
// prompt is edited, saved and reset independently.
interface EditorState {
  saved: ByKind<string | null>;
  drafts: ByKind<string>;
}

function loadEditorState(repo: string): EditorState {
  const saved = {} as ByKind<string | null>;
  const drafts = {} as ByKind<string>;
  for (const p of AGENT_PROMPTS) {
    saved[p.kind] = readPromptOverride(repo, p.kind);
    drafts[p.kind] = saved[p.kind] ?? p.template;
  }
  return { saved, drafts };
}

function firstKindOf(group: PromptGroup): PromptKind {
  return (AGENT_PROMPTS.find((p) => p.group === group) ?? AGENT_PROMPTS[0]).kind;
}

// Which kind each group is showing, remembered per group: leaving "Do a review" for
// the reply prompt and coming back should return to the focus you were reading, not
// to the group's first one.
function initialKinds(): Record<PromptGroup, PromptKind> {
  const out = {} as Record<PromptGroup, PromptKind>;
  for (const g of PROMPT_GROUPS) out[g.group] = firstKindOf(g.group);
  return out;
}

export function AgentPromptsModal({
  repo,
  vars,
  onClose,
}: {
  repo: string;
  vars: ReviewVars;
  onClose: () => void;
}) {
  const [group, setGroup] = useState<PromptGroup>(PROMPT_GROUPS[0].group);
  const [kinds, setKinds] = useState<Record<PromptGroup, PromptKind>>(initialKinds);
  // Read once at mount. App keys this modal on `repo`, so a repo switch remounts it
  // instead of leaving one repo's drafts on screen to be saved under another's key.
  const [state, setState] = useState<EditorState>(() => loadEditorState(repo));

  const active = kinds[group];
  const current = AGENT_PROMPTS.find((p) => p.kind === active) ?? AGENT_PROMPTS[0];
  // The prompt's own author completes the review's values (see prompts.ts): it's a
  // property of the kind on screen, so it's merged here rather than passed in.
  const promptVars: PromptVars = { ...vars, author: current.author };
  const focuses = AGENT_PROMPTS.filter((p) => p.group === group);
  const draft = state.drafts[current.kind];
  const saved = state.saved[current.kind];
  // Dirty against what Save would replace, not against the built-in one: a saved
  // prompt reopened unedited has nothing to save.
  const dirty = draft !== (saved ?? current.template);
  const customised = saved !== null || draft !== current.template;

  function edit(value: string) {
    setState((s) => ({ ...s, drafts: { ...s.drafts, [current.kind]: value } }));
  }

  function save() {
    writePromptOverride(repo, current.kind, draft);
    setState((s) => ({ ...s, saved: { ...s.saved, [current.kind]: draft } }));
  }

  function reset() {
    clearPromptOverride(repo, current.kind);
    setState((s) => ({
      saved: { ...s.saved, [current.kind]: null },
      drafts: { ...s.drafts, [current.kind]: current.template },
    }));
  }

  return (
    <Modal onClose={onClose} labelledBy="prompts-title" className="modal-md">
      <div className="modal-head">
        <h2 id="prompts-title">Agent prompts</h2>
        <ViewToggle
          ariaLabel="Prompt"
          value={group}
          onChange={setGroup}
          options={PROMPT_GROUPS.map((g) => ({ value: g.group, label: g.label }))}
        />
        <span className="spacer" />
        {/* Copies the draft on screen, placeholders filled in — including edits not
            saved yet, since the box is what you're looking at. */}
        <CopyButton
          className="btn copy-btn"
          text={() => renderPrompt(draft, promptVars)}
          idleLabel="Copy"
          title="Copy with the placeholders filled in for this review"
        />
        <button className="btn" onClick={onClose}>
          Close
        </button>
      </div>
      {/* Only for a group that has several prompts to choose between — one review
          focus per run, deliberately (see prompts.ts). The author is shown because
          it's how the pane and the export tell this pass's findings from another's. */}
      {focuses.length > 1 && (
        <div className="modal-subhead">
          <ViewToggle
            ariaLabel="Review focus"
            value={active}
            onChange={(kind) => setKinds((k) => ({ ...k, [group]: kind }))}
            options={focuses.map((p) => ({ value: p.kind, label: p.label }))}
          />
          <span className="spacer" />
          <span className="prompt-author">
            files findings as <code>{current.author}</code>
          </span>
        </div>
      )}
      <textarea
        className="prompt-editor"
        aria-label={`${current.label} prompt`}
        spellCheck={false}
        value={draft}
        onChange={(e) => edit(e.target.value)}
        data-autofocus
      />
      <div className="modal-foot">
        <p
          className="prompt-hint"
          title={PROMPT_PLACEHOLDERS.map(
            (name) => `{{${name}}} → ${renderPrompt(`{{${name}}}`, promptVars)}`
          ).join("\n")}
        >
          Filled in on copy: {PROMPT_PLACEHOLDERS.map((name) => `{{${name}}}`).join(" ")}
        </p>
        <span className="spacer" />
        {dirty && <span className="prompt-dirty">Unsaved changes</span>}
        <button
          className="btn"
          onClick={reset}
          disabled={!customised}
          title={`Discard this repo's saved "${current.label}" prompt and restore the built-in one`}
        >
          Reset
        </button>
        <button
          className="btn btn-primary"
          onClick={save}
          disabled={!dirty || draft.trim() === ""}
          title={`Save this "${current.label}" prompt for ${repo || "this repo"}`}
        >
          Save
        </button>
      </div>
    </Modal>
  );
}
