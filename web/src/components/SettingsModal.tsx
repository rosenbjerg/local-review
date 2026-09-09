import { FontPicker } from "./FontPicker";
import { Modal } from "./Modal";
import { ThemePicker } from "./ThemePicker";

// The toolbar's non-review controls — appearance, shortcut list, repo link — behind the gear, or `?`.
export function SettingsModal({ onClose }: { onClose: () => void }) {
  return (
    <Modal onClose={onClose} title="Settings" close="autofocus" className="modal-settings">
      <div className="settings-body">
        <h3 className="settings-subhead">Appearance for this repo</h3>
        {/* One grid, so every label meets its control on the same edge. The rows are
            `display: contents` — see the note in styles.css. */}
        <div className="settings-form">
          <div className="settings-row">
            <span className="settings-label">Theme</span>
            <ThemePicker />
          </div>
          <FontPicker />
        </div>

        <div className="settings-cols">
          <section className="settings-col">
            <h3 className="settings-subhead">Keyboard shortcuts</h3>
            <table className="shortcuts">
              <tbody>
                <tr>
                  <td>
                    <kbd>j</kbd> / <kbd>k</kbd>
                  </td>
                  <td>Next / previous file</td>
                </tr>
                <tr>
                  <td>
                    <kbd>n</kbd> / <kbd>p</kbd>
                  </td>
                  <td>Next / previous comment</td>
                </tr>
                <tr>
                  <td>
                    <kbd>v</kbd>
                  </td>
                  <td>Mark the current file reviewed and jump to the next unreviewed one</td>
                </tr>
                <tr>
                  <td>
                    <kbd>e</kbd>
                  </td>
                  <td>Export review</td>
                </tr>
                <tr>
                  <td>
                    <kbd>r</kbd>
                  </td>
                  <td>Reload review</td>
                </tr>
                <tr>
                  <td>
                    <kbd>/</kbd>
                  </td>
                  <td>Search files</td>
                </tr>
                <tr>
                  <td>
                    <kbd>[</kbd> / <kbd>]</kbd>
                  </td>
                  <td>Show or hide the files / comments panel</td>
                </tr>
                <tr>
                  <td>
                    <kbd>?</kbd>
                  </td>
                  <td>Toggle these settings</td>
                </tr>
                <tr>
                  <td>
                    <kbd>Esc</kbd>
                  </td>
                  <td>Close a dialog, cancel a comment, clear the highlight</td>
                </tr>
              </tbody>
            </table>
          </section>

          <section className="settings-col">
            <h3 className="settings-subhead">Reviewing</h3>
            <table className="shortcuts">
              <tbody>
                <tr>
                  <td>Click a line №</td>
                  <td>Start a comment on that line</td>
                </tr>
                <tr>
                  <td>Drag / Shift-click</td>
                  <td>Comment on a line range</td>
                </tr>
                <tr>
                  <td>
                    <kbd>⌘</kbd>/<kbd>Ctrl</kbd>+<kbd>Enter</kbd>
                  </td>
                  <td>Submit the comment</td>
                </tr>
                <tr>
                  <td>Select a word</td>
                  <td>Highlight its other occurrences in the file</td>
                </tr>
                <tr>
                  <td>
                    <kbd>Enter</kbd> / <kbd>Shift</kbd>+<kbd>Enter</kbd>
                  </td>
                  <td>Next / previous occurrence</td>
                </tr>
              </tbody>
            </table>
          </section>
        </div>

        <a
          className="settings-link"
          href="https://github.com/rosenbjerg/local-review"
          target="_blank"
          rel="noopener noreferrer"
        >
          <svg aria-hidden="true" viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
            <path d="M10.226 17.284c-2.965-.36-5.054-2.493-5.054-5.256 0-1.123.404-2.336 1.078-3.144-.292-.741-.247-2.314.09-2.965.898-.112 2.111.36 2.83 1.01.853-.269 1.752-.404 2.853-.404 1.1 0 1.999.135 2.807.382.696-.629 1.932-1.1 2.83-.988.315.606.36 2.179.067 2.942.72.854 1.101 2 1.101 3.167 0 2.763-2.089 4.852-5.098 5.234.763.494 1.28 1.572 1.28 2.807v2.336c0 .674.561 1.056 1.235.786 4.066-1.55 7.255-5.615 7.255-10.646C23.5 6.188 18.334 1 11.978 1 5.62 1 .5 6.188.5 12.545c0 4.986 3.167 9.12 7.435 10.669.606.225 1.19-.18 1.19-.786V20.63a2.9 2.9 0 0 1-1.078.224c-1.483 0-2.359-.808-2.987-2.313-.247-.607-.517-.966-1.034-1.033-.27-.023-.359-.135-.359-.27 0-.27.45-.471.898-.471.652 0 1.213.404 1.797 1.235.45.651.921.943 1.483.943.561 0 .92-.202 1.437-.719.382-.381.674-.718.944-.943"></path>
          </svg>
          local-review on GitHub
        </a>
      </div>
    </Modal>
  );
}
