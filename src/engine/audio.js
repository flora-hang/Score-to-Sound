/* Audio: a four-layer Salamander Grand Piano (Yamaha C5, CC BY 3.0, Alexander Holm) in a
   concert-hall reverb, plus the scheduler that turns the timeline into sound.
   React keeps one Player in a ref and calls play/pause/seek; the Player tells React
   about state changes through the onChange callback. */
import * as Tone from "tone";
import { secAt, beatAt, measureAt, beatUnit, rnd } from "./timeline.js";

const SAMPLE_NOTES = ["A0","C1","Ds1","Fs1","A1","C2","Ds2","Fs2","A2","C3","Ds3","Fs3","A3","C4","Ds4","Fs4","A4","C5","Ds5","Fs5","A5","C6","Ds6","Fs6","A6","C7","Ds7","Fs7","A7","C8"];
const LAYERS = [{v:8, ref:.55}, {v:4, ref:.33}, {v:12, ref:.76}, {v:15, ref:.95}];   // load order: medium first
const midiName = m => Tone.Frequency(m, "midi").toNote();

export class Player {
  constructor({baseUrl = "piano/", onLoadState = () => {}, onEnd = () => {}} = {}){
    this.onLoadState = onLoadState; this.onEnd = onEnd;
    this.ready = false; this.playing = false; this.sched = null;
    this.layers = LAYERS.map(L => ({...L}));
    const out = new Tone.Volume(-3).toDestination();
    const comp = new Tone.Compressor({threshold:-18, ratio:2.5, attack:.02, release:.25}).connect(out);
    const hall = new Tone.Reverb({decay: 3.1, preDelay: .028, wet: .24}).connect(comp);
    const bus = new Tone.Gain(1).connect(hall);
    const loadLayer = k => {
      if(k >= this.layers.length) return;
      const L = this.layers[k], urls = {};
      SAMPLE_NOTES.forEach(n => urls[n.replace("s","#")] = `${n}v${L.v}.mp3`);
      L.smp = new Tone.Sampler({urls, baseUrl, release: 1.25, attack: 0,
        onload: () => { L.ready = true; if(k === 0){ this.ready = true; this.onLoadState("ready"); } loadLayer(k+1); },
        onerror: () => { if(k === 0) this.onLoadState("error"); loadLayer(k+1); }}).connect(bus);
    };
    loadLayer(0);
    this.lead = new Tone.PolySynth(Tone.Synth, {oscillator:{type:"fattriangle", count:2, spread:12}, envelope:{attack:.05, decay:.2, sustain:.75, release:.35}, volume:-9}).connect(new Tone.Vibrato(5.2, .07).connect(hall));
    this.click = new Tone.Synth({oscillator:{type:"sine"}, envelope:{attack:.001, decay:.05, sustain:0, release:.02}, volume:-6}).connect(out);
    this.onLoadState("loading");
  }
  pianoNote(note, dur, t, vel){
    const ready = this.layers.filter(L => L.ready);
    if(!ready.length) return;
    let best = ready[0]; for(const L of ready) if(Math.abs(L.ref - vel) < Math.abs(best.ref - vel)) best = L;
    best.smp.triggerAttackRelease(note, dur, t, Math.max(.35, Math.min(1.15, vel / best.ref)) * .85);
  }
  /** Play one note briefly (while editing), so you hear the pitch you chose. */
  async preview(midi){
    try{ await Tone.start(); this.pianoNote(midiName(midi), .6, Tone.now() + .01, .55); }catch(_){}
  }
  /** Current position in beats while playing. */
  currentBeat(){
    const s = this.sched; if(!this.playing || !s) return null;
    const t = Tone.now();
    if(t < s.t0) return s.from;
    return beatAt(s.view, s.s0 + (t - s.t0) * s.f);
  }
  /** Start playing `view` from beat `from`. o: {tempoF, mix, countIn, metronome, expressive} */
  async play(view, from, o){
    if(!view || !view.measures.length) return;
    await Tone.start();
    if(from >= view.total - 1e-6) from = 0;
    this.stopSound();
    const f = o.tempoF, sc = view;
    const s0 = secAt(sc, from);
    let t0 = Tone.now() + .12;
    const m0 = measureAt(sc, from), unit = beatUnit(m0);
    const queue = [];
    if(o.countIn){
      const n = Math.max(1, Math.round(m0.nominal / unit));
      const step = unit * 60 / m0.tempo / f;
      for(let i=0;i<n;i++) queue.push({t: t0 + i*step, kind:"click", strong: i===0});
      t0 += n*step;
    }
    if(o.metronome){
      for(const m of sc.measures){
        if(m.start + m.len < from - 1e-6) continue;
        const u = beatUnit(m); const off0 = m.partial && m.idx===0 ? (m.nominal - m.len) % u : 0;
        for(let b = m.partial && m.idx===0 ? (u - off0) % u : 0; b < m.len - 1e-6; b += u){
          const at = m.start + b; if(at < from - 1e-6) continue;
          queue.push({t: t0 + (secAt(sc, at) - s0)/f, kind:"click", strong: b < 1e-6 && !(m.partial && m.idx===0)});
        }
      }
    }
    const roleOf = {}; sc.parts.forEach(p => roleOf[p.id] = p.role);
    for(const n of sc.notes){
      if(n.onset < from - 1e-6) continue;
      const mx = o.mix[n.part]; if(!mx || !mx.on) continue;
      const start = t0 + (secAt(sc, n.onset) - s0)/f;
      const end = t0 + (secAt(sc, n.endBeat) - s0)/f;
      let off = 0, vel = n.vel;
      if(o.expressive){
        off += rnd(n.onset * 97.13 + n.midi * 7.7) * .006;                 // human timing, a few ms
        if(roleOf[n.part] === "vocal") off -= .008;                        // melody leads slightly
        if(n.cn >= 3 && (n.span >= 12 || n.cn >= 4)) off += n.ci * .013 / Math.sqrt(f);   // roll wide chords
        vel *= 1 + rnd(n.onset * 13.7 + n.midi) * .04;
      }
      queue.push({t: start + off, kind:"note", midi: n.midi, dur: Math.max(.05, end - start - Math.min(0, off)), vel: vel * mx.vol, inst: mx.inst});
    }
    queue.sort((a,b) => a.t - b.t);
    const s = this.sched = {queue, i:0, t0, s0, from, f, view, timer:null, last: queue.length ? queue[queue.length-1].t : t0};
    this.playing = true;
    const tick = () => {
      const horizon = Tone.now() + .3, q = s.queue;
      while(s.i < q.length && q[s.i].t < horizon){
        const it = q[s.i++], t = Math.max(it.t, Tone.now() + .005);
        try{
          if(it.kind === "click") this.click.triggerAttackRelease(it.strong ? 1760 : 1175, .04, t, it.strong ? .9 : .55);
          else if(it.inst === "lead" || !this.ready) this.lead.triggerAttackRelease(midiName(it.midi), it.dur, t, Math.min(1, it.vel*.95));
          else this.pianoNote(midiName(it.midi), it.dur, t, Math.min(1, it.vel));
        }catch(err){ console.warn(err); }
      }
      if(s.i >= q.length && Tone.now() > s.last + .3 && this.currentBeat() >= view.total - 1e-4){ this.stop(); this.onEnd(); }
    };
    tick();
    s.timer = setInterval(tick, 40);
  }
  stopSound(){
    if(this.sched && this.sched.timer) clearInterval(this.sched.timer);
    this.layers.forEach(L => { try{ L.smp && L.smp.releaseAll(); }catch(_){} });
    try{ this.lead.releaseAll(); }catch(_){}
  }
  /** Stop and return the beat we stopped at. */
  stop(){
    const b = this.currentBeat();
    this.stopSound(); this.sched = null; this.playing = false;
    return b;
  }
  dispose(){ this.stop(); }
}
