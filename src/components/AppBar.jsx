import { Logo, Open, Library, Pencil, Keyboard, Sliders } from "./Icons.jsx";

export default function AppBar({title, composer, onOpen, onLibrary, onEdit, onShortcuts, onToggleRail, editing}){
  return (
    <header className="bar">
      <div className="brand"><Logo /><b>Personal Accompanist</b></div>
      <div className="now" aria-live="polite"><span className="t">{title}</span><span className="c">{composer}</span></div>
      <div className="actions">
        <button className="btn primary" onClick={onOpen} title="Open a PDF, photos or MusicXML (O)"><Open /><span className="lbl">Open score</span></button>
        <button className="btn" onClick={onLibrary} title="Your saved scores (L)"><Library /><span className="lbl">Library</span></button>
        <button className="btn" onClick={onEdit} aria-pressed={editing} title={editing ? "Leave edit mode (E)" : "Edit the notes: drag, sharps and flats, lengths, lyrics (E)"}><Pencil /><span className="lbl">{editing ? "Editing" : "Edit notes"}</span></button>
        <button className="btn icon-btn ghost" id="keysBtn" onClick={onShortcuts} title="Keyboard shortcuts (?)" aria-label="Keyboard shortcuts"><Keyboard /></button>
        <button className="btn icon-btn rail-toggle" onClick={onToggleRail} aria-label="Parts and practice settings" title="Parts and practice"><Sliders /></button>
      </div>
    </header>
  );
}
