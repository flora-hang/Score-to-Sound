import { useState } from "react";
import Modal from "./Modal.jsx";
import { parseScore } from "../engine/notation.js";

/** Check and correct the notes in the app's text notation. */
export default function EditNotesDialog({src, warns, onApply, onClose, toast}){
  const [text, setText] = useState(src);
  const [issues, setIssues] = useState(warns);
  function apply(){
    try{
      const {warns: w} = parseScore(text);
      onApply(text);
      if(w.length){ setIssues(w); toast(`Applied. ${w.length} line${w.length === 1 ? "" : "s"} still need a look.`); }
      else { onClose(); toast("Notes updated"); }
    }catch(err){ setIssues([err.message]); }
  }
  return (
    <Modal title="Edit notes" width={860} onClose={onClose} footer={<>
      <button className="btn" onClick={onClose}>Cancel</button>
      <button className="btn primary" onClick={apply}>Apply</button>
    </>}>
      <p style={{margin: "0 0 10px", color: "var(--muted)", fontSize: 13}}>Each bar starts with <b>M</b>, then one line per staff. Fix a wrong note here and press Apply.</p>
      <textarea className="src" spellCheck={false} aria-label="Score notation" value={text} onChange={e => setText(e.target.value)} />
      {issues.length > 0 && <ul className="warnlist">{issues.slice(0, 60).map((w, i) => <li key={i}>{w}</li>)}</ul>}
      <details className="guide"><summary>Notation guide</summary>
        <p>Note: <code>C4:q</code> (middle C, quarter). Sharps and flats: <code>F#4</code>, <code>Bb3</code>. Chord: <code>C4+E4+G4:h</code>. Durations <code>w h q 8 16 32</code>, dotted <code>q.</code>, triplet <code>8t3</code>. Rest <code>r:q</code>, whole-bar rest <code>R</code>.</p>
        <p>Marks after the duration: <code>~</code> tie, <code>(</code> <code>)</code> slur, <code>!st</code> staccato, <code>!ac</code> accent, <code>!te</code> tenuto, <code>!ma</code> marcato, <code>!fe</code> fermata, <code>@mf</code> dynamic, <code>!cr</code> / <code>!dim</code> hairpin start, <code>!he</code> hairpin end, <code>"syl-"</code> lyric. Several lyric lines (verses or languages) stack in order: <code>G4:q"Love""爱"</code>; use <code>""</code> to skip a line on a note.</p>
        <p>Bar line: <code>M 12 | time=6/8 | key=-2 | tempo=72 "Andante" | rit | text="dolce"</code>. Two voices on one staff: separate with <code>//</code>. Piano right hand <code>P2.1</code>, left hand <code>P2.2</code>.</p>
      </details>
    </Modal>
  );
}
