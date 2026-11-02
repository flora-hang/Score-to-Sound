/* The moving playhead, note highlighting and page turns. Runs every animation frame,
   so it updates the DOM directly instead of going through React state. */
import { xAtBeat, sysForBeat } from "./engrave.js";
import { secAt } from "./timeline.js";

export class PlayheadController {
  constructor(scroller){
    this.scroller = scroller; this.systems = []; this.view = null;
    this.el = document.createElement("div"); this.el.className = "playhead"; this.el.innerHTML = '<span class="flag"></span>';
    this.sys = null; this.lit = new Set(); this.turnAnim = null; this.turnedEarly = -1; this.lastUserScroll = 0;
    this.onUser = ev => { if(ev.type !== "keydown" || ["PageUp","PageDown","ArrowUp","ArrowDown"].includes(ev.key)) this.lastUserScroll = performance.now(); };
    ["wheel","touchstart","keydown"].forEach(t => document.addEventListener(t, this.onUser, {passive:true}));
  }
  destroy(){ ["wheel","touchstart","keydown"].forEach(t => document.removeEventListener(t, this.onUser)); if(this.turnAnim) cancelAnimationFrame(this.turnAnim); }
  setSystems(systems, view){ this.systems = systems; this.view = view; this.sys = null; this.lit = new Set(); this.turnedEarly = -1; }
  resetTurns(){ this.turnedEarly = -1; }
  /** b: position in beats. s: {playing, follow, mix, tempoF}. */
  update(b, s, scrollIfNeeded){
    const sys = sysForBeat(this.systems, Math.min(b, (this.view ? this.view.total : 0) - 1e-6));
    if(!sys){ this.el.remove(); return; }
    if(this.sys !== sys){ sys.el.appendChild(this.el); const prev = this.sys; this.sys = sys; if(s.follow && !s.playing && scrollIfNeeded && prev !== sys) this.scrollToSys(sys); }
    if(s.playing) this.follow(b, sys, s);
    const z = sys.zoom, el = this.el;
    el.style.left = xAtBeat(sys, b)*z + "px";
    el.style.top = (sys.top - 6)*z + "px";
    el.style.height = (sys.bottom - sys.top + 12)*z + "px";
    el.classList.toggle("idle", !s.playing);
    const flag = el.querySelector(".flag"); flag.textContent = s.playing ? "" : "Start"; flag.hidden = s.playing;
    const now = new Set();
    if(s.playing){
      for(const ev of sys.evs){
        if(ev.rest || !s.mix[ev.part] || !s.mix[ev.part].on) continue;
        if(b >= ev.onset - 1e-6 && b < ev.end - 1e-6){ if(ev.el) now.add(ev.el); if(ev.ly) ev.ly.forEach(x => now.add(x)); }
      }
    }
    for(const x of this.lit) if(!now.has(x)) x.classList.remove("on");
    for(const x of now) if(!this.lit.has(x)) x.classList.add("on");
    this.lit = now;
  }
  scrollToSys(sys){
    const sc = this.scroller, r = sys.el.getBoundingClientRect(), rs = sc.getBoundingClientRect();
    if(r.top >= rs.top + 10 && r.bottom <= rs.bottom - 10) return;
    sc.scrollTo({top: sc.scrollTop + (r.top - rs.top) - 40, behavior: "auto"});
  }
  /* Keep the current line AND the next one in view; turn early if both don't fit. */
  follow(b, sys, s){
    if(!s.follow || this.turnAnim || performance.now() - this.lastUserScroll < 2500) return;
    const sc = this.scroller, rs = sc.getBoundingClientRect();
    const i = this.systems.indexOf(sys), next = this.systems[i+1];
    const top = el => sc.scrollTop + (el.getBoundingClientRect().top - rs.top) - 12;
    const r = sys.el.getBoundingClientRect();
    const readEnd = (S, rect) => rect.top + S.readBottom * S.zoom;
    let target = null;
    if(this.turnedEarly === i) return;
    if(r.top < rs.top - 2 || readEnd(sys, r) > rs.bottom + 2) target = top(sys.el);
    else if(next){
      const rn = next.el.getBoundingClientRect();
      if(readEnd(next, rn) > rs.bottom + 2){
        if(readEnd(next, rn) - r.top <= rs.height - 16) target = top(sys.el);
        else {
          const secsLeft = (secAt(this.view, sys.end) - secAt(this.view, b)) / s.tempoF;
          if(secsLeft < 2.5){ target = top(next.el); this.turnedEarly = i; }
        }
      }
    }
    if(target !== null) this.turnTo(Math.max(0, Math.min(target, sc.scrollHeight - sc.clientHeight)));
  }
  turnTo(target){
    const sc = this.scroller, from = sc.scrollTop, d = target - from;
    if(Math.abs(d) < 4) return;
    if(matchMedia("(prefers-reduced-motion: reduce)").matches){ sc.scrollTop = target; return; }
    const t0 = performance.now(), dur = 280;
    const step = now => { const k = Math.min(1, (now - t0)/dur); sc.scrollTop = from + d*(1 - Math.pow(1-k, 3)); this.turnAnim = k < 1 ? requestAnimationFrame(step) : null; };
    this.turnAnim = requestAnimationFrame(step);
  }
}
