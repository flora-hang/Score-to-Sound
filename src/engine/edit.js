/* Visual editing operations. Each one takes the ORIGINAL (untransposed) score, a note address,
   and changes it in place. Pitch changes are worked out in the key you're viewing and then
   applied as an interval, so editing works the same whether or not the song is transposed. */
import { LETTERS, LPC, spell } from "./keys.js";
import { DUR_BEATS } from "./notation.js";

export const clone = sc => JSON.parse(JSON.stringify(sc));

export function findEvent(sc, addr){
  const [mi, key, vi, ei] = addr.split("|");
  const m = sc.measures[+mi], v = m && m.staves[key] && m.staves[key][+vi];
  return v ? {m, voice: v, e: v[+ei], mi: +mi, key, vi: +vi, ei: +ei} : null;
}

/** Every event of one staff + voice, in score order (for ← → navigation and lyric entry). */
export function voiceOrder(sc, addr){
  const [, key, vi] = addr.split("|");
  const out = [];
  sc.measures.forEach((m, mi) => { const v = m.staves[key] && m.staves[key][+vi]; if(v) v.forEach((e, ei) => out.push(`${mi}|${key}|${vi}|${ei}`)); });
  return out;
}

const SHARPS = [3,0,4,1,5,2,6], FLATS = [6,2,5,1,4,0,3];      // letter indexes in key-signature order
export function keyAlt(fifths, L){
  if(fifths > 0 && SHARPS.slice(0, fifths).includes(L)) return 1;
  if(fifths < 0 && FLATS.slice(0, -fifths).includes(L)) return -1;
  return 0;
}
const natural = (L, oct) => 12*(oct+1) + LPC[L];
export const pitchName = p => `${p.step}${p.alt === 1 ? "♯" : p.alt === -1 ? "♭" : p.alt === 2 ? "𝄪" : p.alt === -2 ? "𝄫" : ""}${p.oct}`;

/** Move a (viewed) pitch by diatonic steps, landing on the key signature's note. Returns {steps, semis, to}. */
export function stepMove(vp, steps, viewFifths){
  let L = LETTERS.indexOf(vp.step) + steps;
  const oct = vp.oct + Math.floor(L / 7); L = ((L % 7) + 7) % 7;
  const alt = keyAlt(viewFifths, L), midi = natural(L, oct) + alt;
  return {steps, semis: midi - vp.midi, to: {step: LETTERS[L], alt, oct, midi}};
}
/** Sharp / flat / natural on a (viewed) pitch. Pressing the same one again returns to the key signature. */
export function accidentalMove(vp, alt, viewFifths){
  const L = LETTERS.indexOf(vp.step);
  const target = vp.alt === alt ? keyAlt(viewFifths, L) : alt;
  return {steps: 0, semis: natural(L, vp.oct) + target - vp.midi};
}

/** Apply an interval {steps, semis} to pitch `pi` of the event. Returns the pitch's new index in the chord. */
export function applyInterval(sc, addr, pi, {steps, semis}){
  const {e} = findEvent(sc, addr); const p = e.pitches[pi]; if(!p) return pi;
  let L = LETTERS.indexOf(p.step) + steps;
  const oct = p.oct + Math.floor(L / 7); L = ((L % 7) + 7) % 7;
  const midi = Math.max(21, Math.min(108, p.midi + semis));
  let np = {step: LETTERS[L], alt: midi - natural(L, oct), oct, midi};
  if(Math.abs(np.alt) > 2) np = spell(midi, L);
  e.pitches[pi] = np;
  e.pitches = e.pitches.filter((x, i) => i === pi || x.midi !== midi).sort((a, b) => a.midi - b.midi);   // merge duplicates
  return e.pitches.findIndex(x => x.midi === midi);
}

const beatsOf = (dur, dots) => DUR_BEATS[dur] * (dots === 1 ? 1.5 : dots === 2 ? 1.75 : 1);
function fitDuration(len){
  for(const [dur, dots] of [["w",0],["h",1],["h",0],["q",1],["q",0],["8",1],["8",0],["16",0]]) if(beatsOf(dur, dots) <= len + 1e-6) return {dur, dots};
  return {dur: "16", dots: 0};
}

export function setDuration(sc, addr, dur){
  const {e, m} = findEvent(sc, addr);
  if(e.mrest){ e.mrest = false; e.rest = true; }
  e.dur = dur; if(e.dots && dur === "16") e.dots = 0;
  e.tup = null;
  void m;
}
export function toggleDot(sc, addr){ const {e} = findEvent(sc, addr); if(e.mrest) return; e.dots = e.dots ? 0 : 1; }

/** Note -> rest of the same length, or rest -> note on the staff's middle line (in the bar's key). */
export function toggleRest(sc, addr, clef){
  const {e, m} = findEvent(sc, addr);
  if(e.rest){
    const base = {treble: ["B", 4], treble8: ["B", 3], bass: ["D", 3], alto: ["C", 4], tenor: ["A", 3]}[clef] || ["B", 4];
    const L = LETTERS.indexOf(base[0]), alt = keyAlt(m.key, L);
    e.pitches = [{step: base[0], alt, oct: base[1], midi: natural(L, base[1]) + alt}];
    if(e.mrest){ const len = m.time[0] * 4 / m.time[1]; Object.assign(e, fitDuration(len)); e.mrest = false; }
    e.rest = false;
  } else {
    e.rest = true; e.pitches = []; e.tie = false; e.slurS = e.slurE = false; e.lyrics = [];
  }
}
export function toggleTie(sc, addr){ const {e} = findEvent(sc, addr); if(!e.rest) e.tie = !e.tie; }
export function toggleArt(sc, addr, a){ const {e} = findEvent(sc, addr); e.arts = e.arts.includes(a) ? e.arts.filter(x => x !== a) : [...e.arts, a]; }
export function setDynamic(sc, addr, dyn){ const {e} = findEvent(sc, addr); e.dyn = dyn || null; }
export function setLyric(sc, addr, line, text){
  const {e} = findEvent(sc, addr);
  const ly = [...(e.lyrics || [])]; while(ly.length <= line) ly.push("");
  ly[line] = text.replace(/"/g, "'").trim();
  e.lyrics = ly;
}
/** Copy the note and put the copy right after it. Returns the new note's address. */
export function insertAfter(sc, addr){
  const {voice, e, mi, key, vi, ei} = findEvent(sc, addr);
  const copy = {...clone(e), mrest: false, tie: false, slurS: false, slurE: false, hp: null, hpEnd: false, dyn: null, lyrics: [], arts: []};
  if(e.mrest){ copy.rest = true; copy.dur = "q"; copy.dots = 0; }
  voice.splice(ei + 1, 0, copy);
  return `${mi}|${key}|${vi}|${ei+1}`;
}
/** Delete: a note becomes a rest; a rest is removed (unless it's the only thing in the bar). */
export function deleteEvent(sc, addr){
  const {voice, e, ei, m} = findEvent(sc, addr);
  if(!e.rest){ toggleRest(sc, addr); return addr; }
  if(voice.length > 1){ voice.splice(ei, 1); const [mi, key, vi] = addr.split("|"); return `${mi}|${key}|${vi}|${Math.min(ei, voice.length - 1)}`; }
  Object.assign(e, {mrest: true, rest: true, dur: "w", dots: 0, tup: null}); void m;
  return addr;
}
