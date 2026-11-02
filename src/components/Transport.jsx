import { useEffect, useRef, useState } from "react";
import { measureAt, beatUnit } from "../engine/timeline.js";
import { keyLabel } from "../engine/keys.js";
import { Stepper } from "./Controls.jsx";
import { ToStart, Prev, Next, Play, Pause, Minus, Plus, Metronome } from "./Icons.jsx";

/** Bar/beat text, tempo and progress for a position in beats. */
function describe(view, b, tempoF){
  const m = measureAt(view, b), u = beatUnit(m);
  let inBar = b - m.start; if(m.partial && m.idx === 0) inBar += m.nominal - m.len;
  const last = view.measures[view.measures.length-1].num;
  return {
    main: `Bar ${m.num} of ${last}`,
    beat: Math.floor(inBar / u + 1e-6) + 1,
    bpm: Math.round(m.tempo * tempoF), barTempo: m.tempo,
    pct: view.total ? Math.round(Math.min(100, b / view.total * 100) * 10) / 10 : 0,
  };
}
const same = (a, b) => a.main === b.main && a.beat === b.beat && a.bpm === b.bpm && a.pct === b.pct;

export default function Transport({view, playing, cursor, clock, tempoF, transpose, metronome, countIn,
  onPlayPause, onStart, onPrevBar, onNextBar, onSeek, onTempo, onTranspose, onMetronome, onCountIn}){
  const [pos, setPos] = useState(() => describe(view, cursor, tempoF));
  useEffect(() => { if(!playing) setPos(describe(view, cursor, tempoF)); }, [view, cursor, playing, tempoF]);
  useEffect(() => clock.subscribe(b => setPos(p => { const n = describe(view, b, tempoF); return same(p, n) ? p : n; })), [clock, view, tempoF]);

  // Scrubber: drag while stopped moves the start point; while playing, jump on release.
  const scrub = useRef(null), dragging = useRef(false);
  const at = e => { const r = scrub.current.getBoundingClientRect(); return Math.max(0, Math.min(1, (e.clientX - r.left)/r.width)) * view.total; };

  const pct = Math.round(tempoF * 100);
  const firstKey = view.measures[0] ? view.measures[0].key : view.key;
  return (
    <footer className="transport" aria-label="Playback">
      <div className="scrub" ref={scrub} role="slider" aria-label="Position in song" tabIndex={0}
        aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pos.pct)}
        onPointerDown={e => { dragging.current = true; scrub.current.setPointerCapture(e.pointerId); if(!playing) onSeek(at(e)); }}
        onPointerMove={e => { if(dragging.current && !playing) onSeek(at(e)); }}
        onPointerUp={e => { if(dragging.current){ dragging.current = false; if(playing) onSeek(at(e)); } }}
        onKeyDown={e => { if(e.key === "ArrowLeft"){ e.preventDefault(); onPrevBar(); } if(e.key === "ArrowRight"){ e.preventDefault(); onNextBar(); } }}>
        <div className="scrub-track" />
        <div className="scrub-fill" style={{width: pos.pct + "%"}} />
        <div className="scrub-knob" style={{left: pos.pct + "%"}} />
      </div>
      <div className="tgroup">
        <button className="round" onClick={onStart} aria-label="Back to start" title="Back to start (Home)"><ToStart /></button>
        <button className="round" onClick={onPrevBar} aria-label="Previous bar" title="Previous bar (←)"><Prev /></button>
        <button className="play" onClick={onPlayPause} aria-label={playing ? "Pause" : "Play"} title="Play / Pause (Space)">{playing ? <Pause /> : <Play />}</button>
        <button className="round" onClick={onNextBar} aria-label="Next bar" title="Next bar (→)"><Next /></button>
      </div>
      <div className="pos"><b>{pos.main}</b><small>Beat {pos.beat} · {pos.bpm} BPM</small></div>
      <div className="spacer" />
      <Stepper label="Tempo" id="tempo" main={`${Math.round(pos.barTempo * tempoF)} BPM`} sub={pct === 100 ? "Score tempo" : `${pct}% of score`} changed={pct !== 100}
        onDown={() => onTempo(tempoF - .05)} onUp={() => onTempo(tempoF + .05)} onReset={() => onTempo(1)}
        downLabel="Slower ( [ )" upLabel="Faster ( ] )" resetTitle="Reset to the score's tempo"><Minus /><Plus /></Stepper>
      <Stepper label="Key" id="key" main={keyLabel(firstKey, view.mode)}
        sub={transpose === 0 ? "Original key" : `${transpose > 0 ? "+" : "−"}${Math.abs(transpose)} semitone${Math.abs(transpose) === 1 ? "" : "s"} · tap to reset`}
        changed={transpose !== 0} onDown={() => onTranspose(transpose - 1)} onUp={() => onTranspose(transpose + 1)} onReset={() => onTranspose(0)}
        downLabel="Lower key by a semitone ( − )" upLabel="Raise key by a semitone ( + )" resetTitle="Reset to the original key"><Minus /><Plus /></Stepper>
      <div className="ttoggles">
        <button className="tog" aria-pressed={metronome} onClick={() => onMetronome(!metronome)} title="Metronome (M)"><Metronome />Click</button>
        <button className="tog" aria-pressed={countIn} onClick={() => onCountIn(!countIn)} title="Count-in: one bar of clicks before playing">1-2-3</button>
      </div>
    </footer>
  );
}
