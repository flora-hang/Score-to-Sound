import { useEffect, useRef, useState } from "react";
import { pitchName } from "../engine/edit.js";

/* Note-length icons drawn as small SVGs so they look the same on every device. */
const Head = ({filled, x = 6, y = 15}) => <ellipse cx={x} cy={y} rx="3.6" ry="2.6" transform={`rotate(-22 ${x} ${y})`} fill={filled ? "currentColor" : "none"} stroke="currentColor" strokeWidth={filled ? 0 : 1.5} />;
const Stem = () => <path d="M9.3 14.2V3" stroke="currentColor" strokeWidth="1.3" />;
const Flag = ({y = 3}) => <path d={`M9.3 ${y}c.4 2.6 3.6 3.4 3.4 6.6`} fill="none" stroke="currentColor" strokeWidth="1.3" />;
const DUR_ICON = {
  w: <svg width="18" height="20" viewBox="0 0 18 20"><Head x={9} /></svg>,
  h: <svg width="18" height="20" viewBox="0 0 18 20"><Head /><Stem /></svg>,
  q: <svg width="18" height="20" viewBox="0 0 18 20"><Head filled /><Stem /></svg>,
  "8": <svg width="18" height="20" viewBox="0 0 18 20"><Head filled /><Stem /><Flag /></svg>,
  "16": <svg width="18" height="20" viewBox="0 0 18 20"><Head filled /><Stem /><Flag /><Flag y={6} /></svg>,
};
const DURS = [["w", "Whole note", "7"], ["h", "Half note", "6"], ["q", "Quarter note", "5"], ["8", "Eighth note", "4"], ["16", "Sixteenth note", "3"]];
const RestIcon = () => <svg width="16" height="20" viewBox="0 0 16 20"><path d="M6.5 2.5l4.5 5.2-2.6 3.1 3.4 4.3-1 .7c-1.7-1-4-.6-3.2 1.9.2.5.4.9.7 1.3-2.4-1.7-2.7-4.6.6-4.4L4.6 9.6l2.4-3.1-3.6-4.3z" fill="currentColor" /></svg>;
const TieIcon = () => <svg width="22" height="20" viewBox="0 0 22 20"><path d="M3 9c4 5 12 5 16 0" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>;
const ARTS = [["st", "Staccato (short)", <svg key="st" width="16" height="16" viewBox="0 0 16 16"><circle cx="8" cy="8" r="2.2" fill="currentColor" /></svg>],
  ["ac", "Accent", <svg key="ac" width="16" height="16" viewBox="0 0 16 16"><path d="M3 4l10 4-10 4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" /></svg>],
  ["te", "Tenuto (full length)", <svg key="te" width="16" height="16" viewBox="0 0 16 16"><path d="M3 8h10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>],
  ["fe", "Fermata (hold)", <svg key="fe" width="18" height="16" viewBox="0 0 18 16"><path d="M2.5 12a6.5 6.5 0 0 1 13 0" fill="none" stroke="currentColor" strokeWidth="1.5" /><circle cx="9" cy="11" r="1.5" fill="currentColor" /></svg>]];
const DYNS = ["", "pp", "p", "mp", "mf", "f", "ff"];

function Btn({label, pressed, disabled, onClick, children, wide}){
  return <button className={`ebtn${wide ? " wide" : ""}`} aria-label={label} title={label} aria-pressed={pressed === undefined ? undefined : !!pressed} disabled={disabled} onClick={onClick}>{children}</button>;
}

/** One text box per lyric line. Enter saves and moves to the next note, like typing lyrics in notation software. */
function LyricBoxes({sel, onLyric}){
  const [vals, setVals] = useState([]);
  const refs = useRef([]), pendingFocus = useRef(null);
  useEffect(() => {
    setVals(Array.from({length: sel.lyricLines}, (_, i) => sel.oe.lyrics[i] || ""));
    if(pendingFocus.current !== null){ const el = refs.current[pendingFocus.current]; pendingFocus.current = null; if(el){ el.focus(); el.select(); } }
  }, [sel.addr, sel.lyricLines, sel.oe]);
  const commit = (i, advance) => { onLyric(i, vals[i] ?? "", advance); if(advance) pendingFocus.current = i; };
  return (
    <div className="elyr">
      {Array.from({length: sel.lyricLines}, (_, i) => (
        <input key={i} ref={el => refs.current[i] = el} value={vals[i] ?? ""} placeholder={sel.lyricLines > 1 ? `Line ${i+1}` : "Lyric"}
          aria-label={`Lyric line ${i+1}`} title="Type the syllable. Enter saves and moves to the next note. End with - to join to the next syllable."
          onChange={e => setVals(v => { const n = [...v]; n[i] = e.target.value; return n; })}
          onBlur={() => { if((vals[i] ?? "") !== (sel.oe.lyrics[i] || "")) commit(i, false); }}
          onKeyDown={e => { if(e.key === "Enter"){ e.preventDefault(); commit(i, true); } if(e.key === "Escape") e.currentTarget.blur(); }} />
      ))}
    </div>
  );
}

/**
 * The editing strip shown above the score in Edit mode: works on the selected note,
 * and shows its current state (pressed buttons), like Bold/Italic in a word processor.
 */
export default function EditToolbar({sel, canUndo, canRedo, onUndo, onRedo, onDone, onText, ops}){
  const none = !sel, note = sel && !sel.ve.rest, vp = note ? sel.ve.pitches[sel.pi] : null;
  const keyAltOfSel = sel ? sel.keyAlt : 0;
  return (
    <div className="etool-wrap">
      <div className="etool" role="toolbar" aria-label="Note editing">
        <div className="egrp">
          <Btn label="Undo (Ctrl+Z)" disabled={!canUndo} onClick={onUndo}><svg width="16" height="16" viewBox="0 0 16 16"><path d="M5 3L2 6l3 3M2.5 6H10a3.5 3.5 0 0 1 0 7H6" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg></Btn>
          <Btn label="Redo (Ctrl+Y)" disabled={!canRedo} onClick={onRedo}><svg width="16" height="16" viewBox="0 0 16 16"><path d="M11 3l3 3-3 3M13.5 6H6a3.5 3.5 0 0 0 0 7h4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg></Btn>
        </div>
        <div className="egrp">
          <span className="elabel">Pitch</span>
          <Btn label="Up one step (↑)" disabled={!note} onClick={() => ops.step(1)}><svg width="14" height="14" viewBox="0 0 14 14"><path d="M3 9l4-4 4 4" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg></Btn>
          <Btn label="Down one step (↓)" disabled={!note} onClick={() => ops.step(-1)}><svg width="14" height="14" viewBox="0 0 14 14"><path d="M3 5l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg></Btn>
          <span className="epitch" aria-live="polite">{vp ? pitchName(vp) : "—"}</span>
          <Btn label="Sharp (#)" disabled={!note} pressed={vp && vp.alt === 1 && keyAltOfSel !== 1} onClick={() => ops.accidental(1)}><span className="glyph">♯</span></Btn>
          <Btn label="Flat (B)" disabled={!note} pressed={vp && vp.alt === -1 && keyAltOfSel !== -1} onClick={() => ops.accidental(-1)}><span className="glyph">♭</span></Btn>
          <Btn label="Natural (N)" disabled={!note} pressed={vp && vp.alt === 0 && keyAltOfSel !== 0} onClick={() => ops.accidental(0)}><span className="glyph">♮</span></Btn>
        </div>
        <div className="egrp">
          <span className="elabel">Length</span>
          {DURS.map(([d, label, k]) => <Btn key={d} label={`${label} (${k})`} disabled={none} pressed={sel && !sel.ve.mrest && sel.ve.dur === d} onClick={() => ops.duration(d)}>{DUR_ICON[d]}</Btn>)}
          <Btn label="Dotted: half as long again (.)" disabled={none || (sel && sel.ve.mrest)} pressed={sel && sel.ve.dots > 0} onClick={ops.dot}><svg width="12" height="16" viewBox="0 0 12 16"><circle cx="6" cy="9" r="2.4" fill="currentColor" /></svg></Btn>
        </div>
        <div className="egrp">
          <Btn label={sel && sel.ve.rest ? "Turn rest into a note (R)" : "Turn note into a rest (R)"} disabled={none} pressed={sel && sel.ve.rest} onClick={ops.rest}><RestIcon /></Btn>
          <Btn label="Tie to next note (T)" disabled={!note} pressed={note && sel.ve.tie} onClick={ops.tie}><TieIcon /></Btn>
          {ARTS.map(([a, label, icon]) => <Btn key={a} label={label} disabled={none || (a !== "fe" && !note)} pressed={sel && sel.ve.arts.includes(a)} onClick={() => ops.art(a)}>{icon}</Btn>)}
          <select className="edyn" aria-label="Dynamic" title="Dynamic (loudness) starting at this note" disabled={none} value={sel ? (sel.ve.dyn || "") : ""} onChange={e => ops.dynamic(e.target.value)}>
            {DYNS.map(d => <option key={d} value={d}>{d || "Dynamic"}</option>)}
          </select>
        </div>
        {sel && sel.vocal && !sel.ve.rest && <div className="egrp"><span className="elabel">Lyrics</span><LyricBoxes sel={sel} onLyric={ops.lyric} /></div>}
        <div className="egrp">
          <Btn label="Add a note after this one (I)" wide disabled={none} onClick={ops.insert}>+ Note</Btn>
          <Btn label="Delete (Delete key)" wide disabled={none} onClick={ops.remove}>Delete</Btn>
        </div>
        <div className="egrp last">
          <button className="btn ghost" onClick={onText} title="Edit the whole score as text">Edit as text</button>
          <button className="btn primary" onClick={onDone} title="Leave edit mode (E)">Done</button>
        </div>
      </div>
      <div className={`estatus${sel && sel.barState !== "ok" ? " warn" : ""}`} aria-live="polite">
        {!sel ? "Click a note to select it. Drag it up or down to change the pitch, or use the buttons above."
          : `${sel.ve.rest ? "Rest" : sel.ve.pitches.length > 1 ? `Chord, ${pitchName(vp)} selected` : pitchName(vp)} in bar ${sel.barNum} · ${sel.barText}`}
      </div>
    </div>
  );
}
