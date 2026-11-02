/* Timeline: when every note sounds, the tempo map (rit., fermatas), and expression. */
import { DYN_LEVEL } from "./notation.js";

const EPS = 1e-6;
export function rnd(x){ const v = Math.sin(x * 12.9898) * 43758.5453; return (v - Math.floor(v)) * 2 - 1; }
export function beatUnit(m){ if(m.time[1] === 8 && m.time[0] % 3 === 0 && m.time[0] >= 6) return 1.5; return 4 / m.time[1]; }

export function staffKeys(sc){ const r=[]; sc.parts.forEach(p=>p.clefs.forEach((c,i)=>r.push({part:p, key:`${p.id}.${i+1}`, clef:c, idx:i}))); return r; }

export function buildTimeline(sc, {expressive = true} = {}){
  let beat = 0;
  sc.measures.forEach((m, i) => {
    const nominal = m.time[0]*4/m.time[1];
    let maxv = 0;
    for(const k in m.staves) for(const v of m.staves[k]){ let s=0; for(const e of v) s += e.mrest?0:e.beats; maxv = Math.max(maxv, s); }
    const allMrest = Object.values(m.staves).every(vs=>vs.every(v=>v.every(e=>e.mrest)));
    m.len = m.partial ? (maxv || nominal) : (allMrest ? nominal : Math.max(nominal, maxv));
    m.nominal = nominal; m.start = beat; m.idx = i; beat += m.len;
  });
  sc.total = beat;
  const keys = staffKeys(sc);
  const partOf = {}; keys.forEach(k=>partOf[k.key]=k.part.id);
  const notes = [], pend = {}, fermatas = [], marks = {};
  const slurDepth = {};
  for(const m of sc.measures){
    for(const k in m.staves){
      m.staves[k].forEach((v, vi) => {
        let off = 0; const vk = `${k}#${vi}`;
        for(const e of v){
          if(e.mrest) e.beats = m.len;
          e.onset = m.start + off; off += e.beats;
          e.part = partOf[k] || k.split(".")[0];
          if(e.slurS) slurDepth[vk] = (slurDepth[vk]||0) + 1;
          e.inSlur = (slurDepth[vk]||0) > 0;
          e.slurLast = e.slurE;
          if(e.slurE) slurDepth[vk] = Math.max(0,(slurDepth[vk]||0) - 1);
          (marks[e.part] ||= []).push(e);
          if(e.arts.includes("fe")) fermatas.push([e.onset, e.onset + e.beats]);
          if(e.rest) continue;
          for(const p of e.pitches){
            const tk = `${vk}|${p.midi}`;
            const pn = pend[tk];
            if(pn && Math.abs(pn.onset + pn.dur - e.onset) < 1e-3){ pn.dur += e.beats; pn.lastEv = e; if(!e.tie) delete pend[tk]; continue; }
            const n = {part:e.part, midi:p.midi, onset:e.onset, dur:e.beats, ev:e, lastEv:e, m};
            notes.push(n);
            if(e.tie) pend[tk] = n; else delete pend[tk];
          }
        }
      });
    }
  }
  // tempo map (piecewise linear beat -> seconds at 1x)
  const bp = new Set([0, sc.total]);
  sc.measures.forEach(m => { bp.add(m.start); if(m.rit) for(let j=1;j<4;j++) bp.add(m.start + m.len*j/4); });
  const ms = sc.measures, nM = ms.length;
  const ritFrom = expressive && nM > 3 ? ms[Math.max(0, nM-2)].start : Infinity;
  if(ritFrom < sc.total) for(let j=1;j<12;j++) bp.add(ritFrom + (sc.total - ritFrom)*j/12);
  fermatas.forEach(([a,b]) => { bp.add(a); bp.add(b); });
  const B = [...bp].filter(x=>x>=0 && x<=sc.total+EPS).sort((a,b)=>a-b);
  const S = [0];
  const mAt = b => { let lo=0, hi=sc.measures.length-1; while(lo<hi){ const mid=(lo+hi+1)>>1; if(sc.measures[mid].start <= b+EPS) lo=mid; else hi=mid-1; } return sc.measures[lo]; };
  for(let i=1;i<B.length;i++){
    const a = B[i-1], b = B[i], m = mAt(a);
    let stretch = 1;
    if(fermatas.some(([s,e]) => a >= s-EPS && b <= e+EPS)) stretch = 1.9;
    if(m && m.rit){ const t = ((a+b)/2 - m.start)/m.len; stretch *= 1 + .38*t; }
    if((a+b)/2 > ritFrom){ const t = ((a+b)/2 - ritFrom)/(sc.total - ritFrom); stretch *= 1 + .32*t*t; }
    S.push(S[i-1] + (b-a) * 60 / (m?m.tempo:100) * stretch);
  }
  sc.B = B; sc.S = S;
  // expression: dynamics & hairpins per part
  const levels = {};
  for(const pid in marks){
    const evs = marks[pid].slice().sort((a,b)=>a.onset-b.onset);
    const pts = [], hps = []; let open = null;
    for(const e of evs){
      if(e.dyn){ if(DYN_LEVEL[e.dyn]!==undefined) pts.push([e.onset, DYN_LEVEL[e.dyn]]); else if(e.dyn==="fp") pts.push([e.onset+.01, DYN_LEVEL.p]); }
      if(e.hpEnd && open){ open.e = e.onset + (e.onset===open.s? e.beats:0); hps.push(open); open = null; }
      if(e.hp){ if(open){ open.e = e.onset; hps.push(open); } open = {s:e.onset, dir:e.hp==="cr"?1:-1, e:null}; }
    }
    if(open){ open.e = open.s + 4; hps.push(open); }
    levels[pid] = {pts, hps};
  }
  const levelAt = (pid, b) => {
    const L = levels[pid]; if(!L) return .6;
    let lv = .6; for(const [x,v] of L.pts){ if(x <= b+EPS) lv = v; else break; }
    for(const h of L.hps){
      if(b >= h.s-EPS && b <= h.e+EPS){
        let from = .6; for(const [x,v] of L.pts){ if(x <= h.s+EPS) from = v; else break; }
        let to = from + .16*h.dir;
        for(const [x,v] of L.pts){ if(x >= h.e-EPS && x <= h.e+1.01){ to = v; break; } }
        const t = h.e>h.s ? (b-h.s)/(h.e-h.s) : 1;
        return from + (to-from)*Math.max(0,Math.min(1,t));
      }
    }
    return lv;
  };
  for(const n of notes){
    const e = n.ev, le = n.lastEv;
    let v = levelAt(n.part, n.onset);
    if(["sfz","sf","fz","sffz"].includes(e.dyn)) v = Math.max(v, .9);
    if(e.arts.includes("ac")) v *= 1.22;
    if(e.arts.includes("ma")) v *= 1.32;
    if(Math.abs(n.onset - n.m.start) < 1e-3 && !n.m.partial) v *= 1.05;
    n.vel = Math.max(.06, Math.min(1, v));
    let gate = .9;
    if(le.arts.includes("st")) gate = .45;
    else if(le.arts.includes("ss")) gate = .25;
    else if(le.arts.includes("te")) gate = 1;
    else if(le.inSlur && !le.slurLast) gate = 1.04;
    else if(le.slurLast) gate = .86;
    // gate applies to the final segment of a tied chain
    const lastBeats = le.beats;
    n.endBeat = n.onset + n.dur - lastBeats + lastBeats*gate;
  }
  notes.sort((a,b)=>a.onset-b.onset);
  // chord position of every note (for voicing and rolled chords)
  for(const n of notes){ const ps = n.ev.pitches; n.cn = ps.length; n.ci = ps.findIndex(p => p.midi === n.midi); n.span = ps.length ? ps[ps.length-1].midi - ps[0].midi : 0; }
  if(expressive) shapePerformance(sc, notes);
  sc.notes = notes;
}
/* A pianist's touch: voicing, phrasing, metric weight, and sustain pedal. */
function shapePerformance(sc, notes){
  const roleOf = {}; sc.parts.forEach(p => roleOf[p.id] = p.role);
  const unitAt = m => beatUnit(m);
  // 1. voicing: melody on top sings, inner voices recede, bass supports
  for(const n of notes){
    if(n.cn >= 2){ if(n.ci === n.cn - 1) n.vel *= 1.10; else if(n.ci === 0) n.vel *= 1.03; else n.vel *= .86; }
    if(roleOf[n.part] !== "vocal") n.vel *= .9;               // let the singer's line project
  }
  // 2. metric weight inside the bar
  for(const n of notes){
    const pos = n.onset - n.m.start, u = unitAt(n.m);
    const onBeat = Math.abs(pos/u - Math.round(pos/u)) < 1e-3;
    if(!onBeat) n.vel *= .94;
    else if(Math.round(pos/u) % 2 === 1 && n.m.nominal/u >= 4) n.vel *= .97;
  }
  // 3. phrase contour: rising lines grow, falling lines relax (per part, top notes only)
  const byPart = {};
  notes.forEach(n => { if(n.ci === n.cn - 1) (byPart[n.part] ||= []).push(n); });
  for(const pid in byPart){
    const L = byPart[pid];
    for(let i=0;i<L.length;i++){
      let sum = 0, cnt = 0;
      for(let j=i-1; j>=0 && L[i].onset - L[j].onset <= 4; j--){ sum += L[j].midi; cnt++; }
      for(let j=i+1; j<L.length && L[j].onset - L[i].onset <= 4; j++){ sum += L[j].midi; cnt++; }
      if(cnt) L[i].vel *= 1 + Math.max(-.1, Math.min(.12, (L[i].midi - sum/cnt) * .011));
    }
  }
  // 4. sustain pedal for accompaniment: change with the harmony (bass on a main beat), lift at the bar line
  for(const p of sc.parts){
    if(roleOf[p.id] === "vocal") continue;
    const own = notes.filter(n => n.part === p.id);
    if(!own.length) continue;
    const changes = new Set(sc.measures.map(m => m.start));
    let prevPc = null;
    own.filter(n => n.ci === 0 && n.midi < 60).forEach(n => {
      const pos = n.onset - n.m.start, u = unitAt(n.m);
      if(Math.abs(pos/u - Math.round(pos/u)) > 1e-3) return;
      const pc = n.midi % 12; if(pc !== prevPc) changes.add(n.onset); prevPc = pc;
    });
    const C = [...changes].sort((a,b) => a-b);
    for(const n of own){
      if(n.lastEv.arts.includes("st") || n.lastEv.arts.includes("ss") || n.lastEv.arts.includes("fe")) continue;
      const nxt = C.find(c => c > n.onset + 1e-4);
      const pedalEnd = Math.min(nxt === undefined ? sc.total : nxt, n.onset + 8) - .03;
      if(pedalEnd > n.endBeat) n.endBeat = pedalEnd;
    }
  }
  for(const n of notes) n.vel = Math.max(.05, Math.min(1, n.vel));
}
export function secAt(sc, b){
  const B = sc.B, S = sc.S;
  if(b <= 0) return b*60/(sc.measures[0]?sc.measures[0].tempo:100);
  if(b >= B[B.length-1]){ const last = sc.measures[sc.measures.length-1]; return S[S.length-1] + (b - B[B.length-1])*60/(last?last.tempo:100); }
  let lo=0, hi=B.length-1; while(hi-lo>1){ const mid=(lo+hi)>>1; if(B[mid] <= b) lo=mid; else hi=mid; }
  return S[lo] + (S[hi]-S[lo]) * (b-B[lo])/(B[hi]-B[lo] || 1);
}
export function beatAt(sc, s){
  const B = sc.B, S = sc.S;
  if(s <= 0) return 0;
  if(s >= S[S.length-1]) return B[B.length-1];
  let lo=0, hi=S.length-1; while(hi-lo>1){ const mid=(lo+hi)>>1; if(S[mid] <= s) lo=mid; else hi=mid; }
  return B[lo] + (B[hi]-B[lo]) * (s-S[lo])/(S[hi]-S[lo] || 1);
}
export function measureAt(sc, b){ const ms = sc.measures; let lo=0, hi=ms.length-1; while(lo<hi){ const mid=(lo+hi+1)>>1; if(ms[mid].start <= b+EPS) lo=mid; else hi=mid-1; } return ms[lo]; }
