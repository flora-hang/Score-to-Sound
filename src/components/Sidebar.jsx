import { useEffect, useState } from "react";
import { Switch, Segmented } from "./Controls.jsx";
import { Minus, Plus } from "./Icons.jsx";

const ROLE_TEXT = {vocal: "Singer's line", accompaniment: "Accompaniment", instrument: "Instrument"};
const roleColor = (role, i) => role === "vocal" ? "var(--voice)" : role === "accompaniment" ? "var(--keys)" : ["#1D7A4C", "#9A5B00", "#B42318", "#5A6272"][i % 4];

/** One part (Voice, Piano...): on/off, volume, sound. */
function PartCard({part, index, mix, onChange, mine}){
  const [vol, setVol] = useState(mix.vol);          // local while dragging; committed on release
  useEffect(() => setVol(mix.vol), [mix.vol]);
  const commit = () => { if(vol !== mix.vol) onChange({...mix, vol}); };
  return (
    <div className={`prt${mix.on ? "" : " off"}${mine ? " mine" : ""}`}>
      <div className="prt-top">
        <span className="swatch" style={{background: roleColor(part.role, index)}} />
        <div style={{minWidth: 0}}>
          <div className="prt-name">{part.name}</div>
          <div className="role">{mine ? "Your part" : ROLE_TEXT[part.role]} · {part.clefs.length > 1 ? "2 staves" : "1 staff"}</div>
        </div>
        <Switch checked={mix.on} label={`Play ${part.name}`} onChange={on => onChange({...mix, on})} />
      </div>
      <div className="prt-ctl">
        <label htmlFor={`vol-${part.id}`}>Volume</label>
        <input type="range" id={`vol-${part.id}`} min="0" max="1" step="0.05" value={vol}
          onChange={e => setVol(+e.target.value)} onPointerUp={commit} onKeyUp={commit} onBlur={commit} />
        <label htmlFor={`ins-${part.id}`}>Sound</label>
        <select id={`ins-${part.id}`} value={mix.inst} onChange={e => onChange({...mix, inst: e.target.value})}>
          <option value="piano">Piano</option>
          <option value="lead">Soft lead (sustained)</option>
        </select>
      </div>
    </div>
  );
}

export default function Sidebar({parts, mix, onMix, myPart, onMyPart, expressive, onExpressive, countIn, onCountIn, metronome, onMetronome,
  follow, onFollow, lyricsAbove, onLyricsAbove, lyricLines, hiddenLines, onToggleLine, zoom, onZoom, hidden, railRef}){
  const vocal = parts.filter(p => p.role === "vocal");
  const choir = vocal.length > 1;                       // several singers: practise "my part"
  const mine = choir ? vocal.filter(p => p.id === myPart) : vocal;
  const isMine = p => mine.includes(p);
  const others = parts.filter(p => !isMine(p));
  const on = id => mix[id] && mix[id].on;
  const preset = parts.every(p => on(p.id)) ? "all"
    : mine.length && mine.every(p => on(p.id)) && others.every(p => !on(p.id)) ? "vocal"
    : others.length && others.every(p => on(p.id)) && mine.every(p => !on(p.id)) ? "acc" : null;
  const choose = v => { const next = {}; parts.forEach(p => next[p.id] = {...mix[p.id], on: v === "all" || (v === "vocal") === isMine(p)}); onMix(next); };
  const pickMine = id => {
    onMyPart(id);
    if(preset === "vocal" || preset === "acc"){   // keep the same choice for the newly chosen voice
      const next = {}; parts.forEach(p => next[p.id] = {...mix[p.id], on: (p.id === id) === (preset === "vocal")}); onMix(next);
    }
  };

  return (
    <aside className="rail" aria-label="Parts and practice" hidden={hidden} ref={railRef}>
      <div>
        <h2>What plays</h2>
        {choir && (
          <div className="mypart">
            <label htmlFor="myPart">Your part</label>
            <select id="myPart" value={myPart || ""} onChange={e => pickMine(e.target.value)}>
              {vocal.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
        )}
        <Segmented label="Quick choice" value={preset} onChange={choose} options={choir ? [
          {value: "vocal", label: "My part", title: "Only your voice part"},
          {value: "acc", label: "Without me", title: "Everyone except you, so you sing your part with them"},
          {value: "all", label: "Everything", title: "All voices and the accompaniment"},
        ] : [
          {value: "vocal", label: "Singer only", title: "Only the singer's line", disabled: !vocal.length},
          {value: "acc", label: "Backing only", title: "Only the accompaniment", disabled: !others.length},
          {value: "all", label: "Both", title: "Everything together"},
        ]} />
        <div className="parts">
          {parts.map((p, i) => <PartCard key={p.id} part={p} index={i} mine={choir && p.id === myPart} mix={mix[p.id]} onChange={m => onMix({...mix, [p.id]: m})} />)}
        </div>
      </div>
      <div>
        <h2>Practice</h2>
        <div className="opts">
          <div className="opt"><div>Expressive playing<small>Pedal, phrasing and natural timing, like a pianist. Turn off for strict, exact rhythm.</small></div><Switch checked={expressive} onChange={onExpressive} label="Expressive playing" /></div>
          <div className="opt"><div>Count-in<small>One bar of clicks before playing</small></div><Switch checked={countIn} onChange={onCountIn} label="Count-in" /></div>
          <div className="opt"><div>Metronome<small>Click on every beat (M)</small></div><Switch checked={metronome} onChange={onMetronome} label="Metronome" /></div>
          <div className="opt"><div>Follow the music<small>Scroll to keep the playhead in view</small></div><Switch checked={follow} onChange={onFollow} label="Follow the music" /></div>
          <div className="opt"><div>Lyrics</div>
            <Segmented label="Lyrics position" style={{width: 150}} value={lyricsAbove ? "above" : "below"} onChange={v => onLyricsAbove(v === "above")}
              options={[{value: "below", label: "Below"}, {value: "above", label: "Above"}]} />
          </div>
          {lyricLines > 1 && (
            <div className="opt"><div>Lyric lines<small>Choose which verses or languages to show</small></div>
              <div className="lychips">
                {Array.from({length: lyricLines}, (_, i) => (
                  <button key={i} aria-pressed={!hiddenLines.has(i)} title={`Show lyric line ${i+1}`} onClick={() => onToggleLine(i)}>Line {i+1}</button>
                ))}
              </div>
            </div>
          )}
          <div className="opt"><div>Size</div>
            <div className="zoomer">
              <button className="round" style={{width: 32, height: 32}} aria-label="Smaller music" title="Smaller" onClick={() => onZoom(zoom - .1)}><Minus /></button>
              <output>{Math.round(zoom * 100)}%</output>
              <button className="round" style={{width: 32, height: 32}} aria-label="Larger music" title="Larger" onClick={() => onZoom(zoom + .1)}><Plus /></button>
            </div>
          </div>
        </div>
      </div>
      <div className="note-box">Grand piano: Salamander Grand (Yamaha C5) by Alexander Holm, CC BY 3.0, in a concert-hall reverb. Playback follows tempo, meter, dynamics, hairpins, slurs, ties, articulation and fermatas. Repeats are played once, as printed.<div className="legal-links"><a href="./privacy" target="_blank" rel="noopener">Privacy</a><a href="./terms" target="_blank" rel="noopener">Terms</a></div></div>
    </aside>
  );
}
