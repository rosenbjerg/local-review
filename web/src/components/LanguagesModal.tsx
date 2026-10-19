import { useState } from "react";
import {
  EXT_EXTRA,
  LANGUAGES,
  NAME_EXTRA,
  languageName,
  resolveLang,
  type LangMap,
} from "../highlight";
import { removeLangMapping, setLangMapping, useLangMap, type LangScope } from "../langMap";
import { MAX_LANG_MAPPINGS, normalizeLangKey } from "../storage";
import { Combobox, type ComboOption } from "./Combobox";
import { Modal } from "./Modal";

const OPTIONS: ComboOption[] = LANGUAGES.map(({ id, name }) => ({
  value: id,
  label: name,
  hint: id === name.toLowerCase() ? undefined : id,
}));

const BUILT_IN = Object.entries({
  ...Object.fromEntries(Object.entries(EXT_EXTRA).map(([ext, lang]) => [`.${ext}`, lang])),
  ...NAME_EXTRA,
}).sort(([a], [b]) => a.localeCompare(b));

function pattern(key: string): string {
  return key.startsWith(".") ? `*${key}` : key;
}

function samplePath(key: string): string {
  return key.startsWith(".") ? `file${key}` : key;
}

function MappingSection({
  scope,
  title,
  map,
  under,
  underLabel,
}: {
  scope: LangScope;
  title: string;
  map: LangMap;
  under: LangMap;
  underLabel: string;
}) {
  const [key, setKey] = useState("");
  const [lang, setLang] = useState("");
  const normalized = normalizeLangKey(key);
  const invalid = key.trim() !== "" && normalized === "";
  const full = map[normalized] === undefined && Object.keys(map).length >= MAX_LANG_MAPPINGS;
  const canAdd = normalized !== "" && lang !== "" && !full;
  const entries = Object.entries(map).sort(([a], [b]) => a.localeCompare(b));

  function add() {
    if (!canAdd || !setLangMapping(scope, key, lang)) return;
    setKey("");
    setLang("");
  }

  function overridden(k: string): string | null {
    return resolveLang(samplePath(k), { repo: {}, global: under });
  }

  return (
    <section className="lang-section" aria-label={title}>
      <h3 className="settings-subhead">{title}</h3>
      {entries.length === 0 ? (
        <p className="settings-note">No mappings.</p>
      ) : (
        <table className="lang-table">
          <tbody>
            {entries.map(([k, v]) => {
              const over = overridden(k);
              return (
                <tr key={k}>
                  <td className="lang-key">
                    <code>{pattern(k)}</code>
                    {over !== null && (
                      <span className="lang-over">
                        over {underLabel}: {languageName(over)}
                      </span>
                    )}
                  </td>
                  <td className="lang-pick">
                    <Combobox
                      ariaLabel={`Language for ${pattern(k)}`}
                      value={v}
                      options={OPTIONS}
                      onChange={(next) => setLangMapping(scope, k, next)}
                      floating
                    />
                  </td>
                  <td>
                    <button className="btn" onClick={() => removeLangMapping(scope, k)}>
                      Remove
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      <div className="lang-add">
        <input
          className="combobox-input lang-key-input"
          aria-label={`New ${title.toLowerCase()} pattern`}
          placeholder=".feature or Jenkinsfile"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") add();
          }}
          aria-invalid={invalid}
        />
        <div className="lang-pick">
          <Combobox
            ariaLabel={`New ${title.toLowerCase()} language`}
            value={lang}
            options={OPTIONS}
            onChange={setLang}
            floating
          />
        </div>
        <button className="btn" onClick={add} disabled={!canAdd}>
          {map[normalized] ? "Replace" : "Add"}
        </button>
      </div>
      {invalid && (
        <p className="settings-note lang-invalid">
          An extension like .feature, or a file name — no spaces, slashes or wildcards past the
          leading *.
        </p>
      )}
      {full && (
        <p className="settings-note lang-invalid">
          {title} holds the most mappings there is room for ({MAX_LANG_MAPPINGS}); remove one first.
        </p>
      )}
    </section>
  );
}

export function LanguagesModal({ onClose, onBack }: { onClose: () => void; onBack: () => void }) {
  const { repo, own, inherited } = useLangMap();
  return (
    <Modal
      onClose={onClose}
      title="Languages"
      className="modal-settings"
      actions={
        <button className="btn" onClick={onBack}>
          Back to settings
        </button>
      }
    >
      <div className="settings-body lang-body">
        <p className="settings-note">
          Pick the grammar a file is highlighted with, by extension (<code>.feature</code>,{" "}
          <code>.d.ts</code>) or whole file name (<code>Jenkinsfile</code>). A file name beats an
          extension, and a longer extension beats a shorter one.
        </p>
        {repo !== "" && (
          <MappingSection
            scope="repo"
            title={`This repo (${repo})`}
            map={own}
            under={inherited}
            underLabel="default"
          />
        )}
        <MappingSection
          scope="global"
          title="Every repo"
          map={inherited}
          under={{}}
          underLabel="built-in"
        />
        <p className="settings-note">
          A repo&apos;s <code>.gitattributes</code> can name a language too, as GitHub reads it:{" "}
          <code>*.feature linguist-language=Gherkin</code>. That beats the mappings for every repo
          and the built-in ones, but not this repo&apos;s own.
        </p>
        <details className="lang-builtins">
          <summary>Built-in mappings ({BUILT_IN.length})</summary>
          <table className="lang-table">
            <tbody>
              {BUILT_IN.map(([k, v]) => (
                <tr key={k}>
                  <td className="lang-key">
                    <code>{pattern(k)}</code>
                  </td>
                  <td>{languageName(v)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      </div>
    </Modal>
  );
}
