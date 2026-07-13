import { Modal } from "./Modal";

// The keyboard-shortcuts overlay. Toggled by `?`; the global shortcut handler in
// App bails while it's open.
export function HelpModal({ onClose }: { onClose: () => void }) {
  return (
    <Modal onClose={onClose} labelledBy="help-title" className="modal-sm">
      <div className="modal-head">
        <h2 id="help-title">Keyboard shortcuts</h2>
        <span className="spacer" />
        <button className="btn" onClick={onClose}>
          Close
        </button>
      </div>
      <div className="help-body">
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
                <kbd>?</kbd>
              </td>
              <td>Toggle this help</td>
            </tr>
            <tr>
              <td>
                <kbd>Esc</kbd>
              </td>
              <td>Close a dialog / cancel a comment</td>
            </tr>
          </tbody>
        </table>
        <h3 className="help-subhead">Reviewing</h3>
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
          </tbody>
        </table>
      </div>
    </Modal>
  );
}
