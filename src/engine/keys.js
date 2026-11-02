/* Key signatures and transposition with correct enharmonic spelling. */
export const LETTERS = "CDEFGAB", LPC = [0,2,4,5,7,9,11];
export const MAJ = ["Cb","Gb","Db","Ab","Eb","Bb","F","C","G","D","A","E","B","F#","C#"];
export const MIN = ["Ab","Eb","Bb","F","C","G","D","A","E","B","F#","C#","G#","D#","A#"];
const pretty = s => s.replace("#","♯").replace(/([A-G])b/,"$1♭");
export function tonicOf(f, mode){ const n = (mode==="minor"?MIN:MAJ)[f+7]; const L = LETTERS.indexOf(n[0]); return {L, pc:(LPC[L] + (n[1]==="#"?1:n[1]==="b"?-1:0) + 12) % 12, name:n}; }
export function keyLabel(f, mode){ return pretty(tonicOf(f,mode).name) + (mode==="minor"?" minor":" major"); }
function transKey(f, mode, T){
  const pc = ((tonicOf(f,mode).pc + T) % 12 + 12) % 12;
  let best = null;
  for(let k=-7;k<=7;k++){
    if(tonicOf(k,mode).pc !== pc) continue;
    let s = Math.abs(k); if(Math.abs(k)===6 && Math.sign(k) !== Math.sign(f || -1)) s += .5;
    if(!best || s < best.s) best = {k, s};
  }
  return best ? best.k : f;
}
export function spell(midi, L){
  const base = Math.floor(midi/12) - 1;
  for(const o of [base, base-1, base+1]){ const alt = midi - (12*(o+1) + LPC[L]); if(alt>=-2 && alt<=2) return {step:LETTERS[L], alt, oct:o, midi}; }
  const names = [[0,0],[0,1],[1,0],[2,-1],[2,0],[3,0],[3,1],[4,0],[5,-1],[5,0],[6,-1],[6,0]][((midi%12)+12)%12];
  return {step:LETTERS[names[0]], alt:names[1], oct:Math.floor(midi/12)-1, midi};
}
export function transposeScore(sc, T){
  const out = JSON.parse(JSON.stringify(sc));
  if(!T) return out;
  for(const m of out.measures){
    const nk = transKey(m.key, m.mode, T);
    const shift = (tonicOf(nk, m.mode).L - tonicOf(m.key, m.mode).L + 7) % 7;
    m.key = nk;
    for(const k in m.staves) for(const v of m.staves[k]) for(const e of v)
      e.pitches = e.pitches.map(p => spell(p.midi + T, (LETTERS.indexOf(p.step) + shift) % 7));
  }
  for(let i=1;i<out.measures.length;i++) out.measures[i].keyChange = out.measures[i].key !== out.measures[i-1].key;
  out.key = out.measures[0] ? out.measures[0].key : transKey(out.key, out.mode, T);
  return out;
}
