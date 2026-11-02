import { Fragment } from "react";
import Modal from "./Modal.jsx";

const KEYS = [["Space", "Play or pause"], ["Click a note", "Start from there"], ["Home", "Back to the start"], ["← →", "Previous or next bar"],
  ["[ ]", "Slower or faster"], ["− +", "Lower or raise the key"], ["M", "Metronome on or off"], ["O", "Open a score"], ["L", "Library"], ["E", "Edit mode on or off"],
  ["In edit mode", ""], ["Click / drag", "Select a note / drag it up or down"], ["↑ ↓", "Move the note a step (Shift: an octave)"], ["← →", "Previous or next note"],
  ["# B N", "Sharp, flat, natural"], ["3 4 5 6 7", "16th, 8th, quarter, half, whole"], [".", "Dotted"], ["R", "Note ↔ rest"], ["T", "Tie"], ["I", "Add a note after"],
  ["Delete", "Delete"], ["Ctrl+Z / Ctrl+Y", "Undo / redo"], ["Space", "Play from the selected note"]];

export default function ShortcutsDialog({onClose}){
  return (
    <Modal title="Shortcuts" width={440} onClose={onClose}>
      <div className="kbd-list">{KEYS.map(([k, v]) => <Fragment key={k}>{v ? <><kbd>{k}</kbd><span>{v}</span></> : <b style={{gridColumn: "1 / -1", marginTop: 8}}>{k}</b>}</Fragment>)}</div>
    </Modal>
  );
}
