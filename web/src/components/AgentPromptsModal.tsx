import { useState } from "react";
import { AGENT_PROMPTS, PROMPT_GROUPS, PROMPT_PLACEHOLDERS, renderPrompt } from "../prompts";
import type { PromptGroup, PromptKind, PromptVars, ReviewVars } from "../prompts";
import { clearPromptOverride, readPromptOverride, writePromptOverride } from "../storage";
import { CopyButton } from "./CopyButton";
import { Modal } from "./Modal";
import { ViewToggle } from "./ViewToggle";

type ByKind<T> = Record<PromptKind, T>;

// Held per kind, not for the shown prompt alone, so switching prompts mid-edit keeps the other's work.
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

// Remembered per group, so coming back to "Do a review" returns to the focus you were reading.
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
  // Read once at mount; App keys this modal on `repo`, so a switch remounts it.
  const [state, setState] = useState<EditorState>(() => loadEditorState(repo));

  const active = kinds[group];
  const current = AGENT_PROMPTS.find((p) => p.kind === active) ?? AGENT_PROMPTS[0];
  // The author belongs to the kind on screen, so it's merged here rather than passed in.
  const promptVars: PromptVars = { ...vars, author: current.author };
  const focuses = AGENT_PROMPTS.filter((p) => p.group === group);
  const draft = state.drafts[current.kind];
  const saved = state.saved[current.kind];
  // Dirty against what Save would replace: a saved prompt reopened unedited has nothing to save.
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
    <Modal
      onClose={onClose}
      title="Agent prompts"
      className="modal-md"
      controls={
        <ViewToggle
          ariaLabel="Prompt"
          value={group}
          onChange={setGroup}
          options={PROMPT_GROUPS.map((g) => ({ value: g.group, label: g.label }))}
        />
      }
      actions={
        <CopyButton
          className="btn copy-btn"
          text={() => renderPrompt(draft, promptVars)}
          idleLabel="Copy"
          title="Copy with the placeholders filled in for this review"
        />
      }
    >
      {/* One review focus per run, deliberately (see prompts.ts). */}
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
