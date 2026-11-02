import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { engrave } from "../engine/engrave.js";
import { keyLabel } from "../engine/keys.js";
import { PlayheadController } from "../engine/playhead.js";
import { Pointer } from "./Icons.jsx";
import { stepMove, pitchName } from "../engine/edit.js";

/**
 * The sheet music. React owns the page frame and title; VexFlow draws the systems into
 * `host`, which React leaves empty. The playhead is moved directly by the clock subscription.
 */
export default function ScoreView({view, transpose, zoom, lyricsAbove, hiddenLines, clock, playing, cursor, follow, mix, tempoF,
  onSeek, isDemo, warnCount, onReview, soundState, editing, selection, onSelect, onMovePitch, onPreview, toolbar}){
  const scroller = useRef(null), host = useRef(null), ctrl = useRef(null), lastBeat = useRef(cursor);
  const systemsRef = useRef([]), ring = useRef(null), tag = useRef(null), drag = useRef(null);
  const editRef = useRef(editing); editRef.current = editing;
  const selRef = useRef(selection); selRef.current = selection;
  const [width, setWidth] = useState(0);
  const live = useRef(); live.current = {playing, follow, mix, tempoF};
  const seekRef = useRef(onSeek); seekRef.current = onSeek;

  useEffect(() => {
    ctrl.current = new PlayheadController(scroller.current);
    return () => ctrl.current.destroy();
  }, []);

  // Re-engrave when the available width changes (debounced).
  useEffect(() => {
    let t;
    const ro = new ResizeObserver(([e]) => { clearTimeout(t); t = setTimeout(() => setWidth(Math.round(e.contentRect.width)), 120); });
    ro.observe(host.current);
    setWidth(host.current.clientWidth);
    return () => { ro.disconnect(); clearTimeout(t); };
  }, []);

  // Engrave whenever the music or how it is shown changes.
  useLayoutEffect(() => {
    if(!width) return;
    const systems = engrave(host.current, view, {zoom, lyricsAbove, hiddenLines, onSeek: b => { if(!editRef.current) seekRef.current(b); }});
    systemsRef.current = systems;
    ctrl.current.setSystems(systems, view);
    paintSelection();
    ctrl.current.update(live.current.playing ? lastBeat.current : cursor, live.current, true);
  }, [view, zoom, lyricsAbove, hiddenLines, width]);   // cursor is read only on re-engrave

  // Every animation frame while playing.
  useEffect(() => clock.subscribe(b => { lastBeat.current = b; ctrl.current.update(b, live.current); }), [clock]);

  // When stopped, show the start marker at the cursor.
  useEffect(() => {
    if(playing){ ctrl.current.resetTurns(); return; }
    lastBeat.current = cursor;
    ctrl.current.update(cursor, live.current, true);
  }, [cursor, playing]);

  // ---------------- editing: selection highlight, click to select, drag to change pitch
  function findEv(addr){
    for(const sys of systemsRef.current) for(const ev of sys.evs) if(!ev.synthetic && ev.e.addr === addr) return {sys, ev};
    return null;
  }
  function paintSelection(){
    host.current.querySelectorAll(".sel").forEach(x => x.classList.remove("sel"));
    if(ring.current){ ring.current.remove(); ring.current = null; }
    const s = selRef.current; if(!editRef.current || !s) return;
    const hit = findEv(s.addr); if(!hit) return;
    const {sys, ev} = hit, z = sys.zoom;
    if(ev.el) ev.el.classList.add("sel");
    const y = ev.ys[ev.rest ? 0 : Math.min(s.pi, ev.ys.length - 1)];
    if(y === undefined) return;
    const r = document.createElement("div"); r.className = "selring" + (ev.rest ? " rest" : "");
    r.style.left = ev.x * z + "px"; r.style.top = y * z + "px"; r.style.setProperty("--z", z);
    sys.el.appendChild(r); ring.current = r;
  }
  useEffect(paintSelection, [selection, editing]);

  function hitTest(e){
    const wrap = e.target.closest && e.target.closest(".sys"); if(!wrap) return null;
    const sys = systemsRef.current.find(s => s.el === wrap); if(!sys) return null;
    const rect = wrap.getBoundingClientRect(), z = sys.zoom, x = (e.clientX - rect.left)/z, y = (e.clientY - rect.top)/z;
    let best = null;
    for(const ev of sys.evs){
      if(ev.synthetic || !ev.ys.length) continue;
      (ev.rest ? [ev.ys[0]] : ev.ys).forEach((yy, i) => {
        const d = Math.hypot(x - ev.x, (y - yy) * 1.3);
        if(d < 22 && (!best || d < best.d)) best = {d, ev, pi: ev.rest ? 0 : i, sys};
      });
    }
    return best;
  }
  const onPointerDown = e => {
    if(!editing || e.button > 0) return;
    const hit = hitTest(e);
    if(!hit){ if(e.target.closest(".sys")) onSelect(null); return; }
    e.preventDefault();
    onSelect({addr: hit.ev.e.addr, pi: hit.pi});
    if(!hit.ev.rest){
      onPreview(hit.ev.e.pitches[hit.pi].midi);
      drag.current = {ev: hit.ev, pi: hit.pi, sys: hit.sys, y0: e.clientY, steps: 0};
      host.current.setPointerCapture(e.pointerId);
    }
  };
  const onPointerMove = e => {
    const d = drag.current; if(!d) return;
    const steps = Math.round((d.y0 - e.clientY) / (5 * d.sys.zoom));
    if(steps === d.steps) return;
    d.steps = steps;
    const vp = d.ev.e.pitches[d.pi], key = view.measures[+d.ev.e.addr.split("|")[0]].key;
    const mv = stepMove(vp, steps, key);
    if(d.ev.el) d.ev.el.setAttribute("transform", `translate(0 ${-steps * 5})`);
    if(ring.current) ring.current.style.transform = `translateY(${-steps * 5 * d.sys.zoom}px)`;
    if(!tag.current){ tag.current = document.createElement("div"); tag.current.className = "dragtag"; }
    d.sys.el.appendChild(tag.current);
    tag.current.textContent = steps ? pitchName(mv.to) : pitchName(vp);
    tag.current.style.left = d.ev.x * d.sys.zoom + 16 + "px";
    tag.current.style.top = (d.ev.ys[d.pi] - steps * 5) * d.sys.zoom - 12 + "px";
    onPreview(mv.to.midi);
  };
  const onPointerUp = () => {
    const d = drag.current; if(!d) return;
    drag.current = null;
    if(d.ev.el) d.ev.el.removeAttribute("transform");
    if(ring.current) ring.current.style.transform = "";
    if(tag.current){ tag.current.remove(); tag.current = null; }
    if(d.steps) onMovePitch({addr: d.ev.e.addr, pi: d.pi}, d.steps);
  };

  const firstKey = view.measures[0] ? view.measures[0].key : view.key;
  return (
    <section className={`desk${editing ? " editing" : ""}`} aria-label="Score">
      {editing ? toolbar : <div className="desk-tools">
        <div className="hint"><Pointer /><span>Click any note to start from there, before or during playback.</span></div>
        {isDemo && <span className="pill">Example score</span>}
        {warnCount > 0 && <button className="pill warn" onClick={onReview} title="Open the note editor to review">{warnCount} thing{warnCount === 1 ? "" : "s"} to check</button>}
        {soundState !== "ready" && (
          <span className="loading-sounds">
            {soundState === "error" ? "Piano sounds couldn't load. Using a simple tone." : <><span className="spin" />{soundState === "slow" ? "Still loading piano…" : "Loading piano…"}</>}
          </span>
        )}
      </div>}
      <div className="scroller" ref={scroller}>
        <div className="page">
          <div className="score-head">
            <h1>{view.title}</h1>
            <div className="meta">
              <span>{transpose ? `Transposed to ${keyLabel(firstKey, view.mode)}` : ""}</span>
              <span>{view.composer || ""}</span>
            </div>
          </div>
          <div id="systems" ref={host} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp} />
        </div>
      </div>
    </section>
  );
}
