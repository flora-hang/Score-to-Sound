/* Text notation parser: one line per staff per bar, e.g. "P1.1: G4:h\"maz-\" B4:8(". */
export const DUR_BEATS = {w:4,h:2,q:1,"8":.5,"16":.25,"32":.125,"64":.0625};
export const TUP = {t3:[3,2],t5:[5,4],t6:[6,4],t7:[7,4],t2:[2,3]};
const STEP_PC = {C:0,D:2,E:4,F:5,G:7,A:9,B:11};
const ACC = {"":0,n:0,"#":1,b:-1,"##":2,x:2,bb:-2};
export const DYN_LEVEL = {ppp:.22,pp:.3,p:.4,mp:.5,mf:.62,f:.75,ff:.87,fff:.96};
const ARTS = {st:1,ss:1,ac:1,ma:1,te:1,fe:1,cr:1,dim:1,he:1};

function parsePitch(s){
  const m = s.match(/^([A-Ga-g])(##|bb|#|b|n|x)?(-?\d)$/);
  if(!m) return null;
  const step = m[1].toUpperCase(), alt = ACC[m[2]||""], oct = +m[3];
  return {step, alt, oct, midi: 12*(oct+1) + STEP_PC[step] + alt};
}

function parseEvent(tok, warns, where, last){
  const m = tok.match(/^(R|r|[A-Ga-g](?:##|bb|#|b|n|x)?-?\d(?:\+[A-Ga-g](?:##|bb|#|b|n|x)?-?\d)*)(?::(w|h|q|8|16|32|64)(\.{0,2})(t\d)?)?(.*)$/);
  if(!m){ warns.push(`${where}: couldn't read "${tok}"`); return null; }
  const e = {rest:false, mrest:false, pitches:[], dur:m[2]||(last&&last.dur)||"q", dots:m[3]?m[3].length:(m[2]?0:(last?last.dots:0)), tup:m[4]||null, tie:false, slurS:false, slurE:false, arts:[], dyn:null, hp:null, lyrics:[]};
  if(m[1]==="R"){ e.rest = e.mrest = true; e.dur="w"; e.dots=0; e.tup=null; }
  else if(m[1]==="r"){ e.rest = true; }
  else {
    for(const ps of m[1].split("+")){ const p = parsePitch(ps); if(p) e.pitches.push(p); else warns.push(`${where}: bad pitch "${ps}"`); }
    if(!e.pitches.length) return null;
    e.pitches.sort((a,b)=>a.midi-b.midi);
  }
  if(e.tup && !TUP[e.tup]){ warns.push(`${where}: unknown tuplet "${e.tup}"`); e.tup=null; }
  let b = DUR_BEATS[e.dur]; if(e.dots===1) b*=1.5; else if(e.dots===2) b*=1.75;
  if(e.tup){ const [n,o]=TUP[e.tup]; b = b*o/n; }
  e.beats = b;
  const rest = m[5]||"";
  const re = /~|\(|\)|!(\w+)|@(\w+)|"([^"]*)"/g; let mm, consumed = 0;
  while((mm = re.exec(rest))){
    consumed += mm[0].length;
    if(mm[0]==="~") e.tie = true;
    else if(mm[0]==="(") e.slurS = true;
    else if(mm[0]===")") e.slurE = true;
    else if(mm[1]){ const a = mm[1].toLowerCase(); if(a==="cr"||a==="dim") e.hp=a; else if(a==="he") e.hpEnd=true; else if(ARTS[a]) e.arts.push(a); else warns.push(`${where}: unknown mark "!${a}"`); }
    else if(mm[2]){ e.dyn = mm[2].toLowerCase(); }
    else if(mm[3]!==undefined){ e.lyrics.push(mm[3]); }
  }
  if(consumed < rest.replace(/\s/g,"").length) warns.push(`${where}: ignored part of "${tok}"`);
  return e;
}

export function parseScore(text){
  const warns = [];
  const sc = {title:"", composer:"", tempo:100, tempoText:"", key:0, mode:"major", time:[4,4], parts:[], measures:[]};
  const partById = {};
  let cur = null, lineNo = 0;
  const newPart = (id, name, role, clefs) => {
    if(partById[id]) return partById[id];
    const p = {id, name: name||id, role: role||"instrument", clefs: clefs&&clefs.length?clefs:["treble"]};
    partById[id] = p; sc.parts.push(p); return p;
  };
  for(let raw of text.split(/\r?\n/)){
    lineNo++;
    const line = raw.trim();
    if(!line || line.startsWith("#") || line.startsWith("%") || line.startsWith("```")) continue;
    let m;
    if((m = line.match(/^TITLE:\s*(.*)$/i))){ if(!sc.title) sc.title = m[1]; continue; }
    if((m = line.match(/^COMPOSER:\s*(.*)$/i))){ if(!sc.composer) sc.composer = m[1]; continue; }
    if((m = line.match(/^TEMPO:\s*(\d+(?:\.\d+)?)\s*(.*)$/i))){ if(!sc._tempoSet){ sc.tempo = +m[1]; sc.tempoText = m[2].replace(/^"|"$/g,""); sc._tempoSet=1; } continue; }
    if((m = line.match(/^KEY:\s*(-?\d+)\s*(major|minor)?/i))){ if(!sc._keySet){ sc.key = Math.max(-7,Math.min(7,+m[1])); sc.mode = (m[2]||"major").toLowerCase(); sc._keySet=1; } continue; }
    if((m = line.match(/^TIME:\s*(\d+)\s*\/\s*(\d+)/i))){ if(!sc._timeSet){ sc.time = [+m[1], +m[2]]; sc._timeSet=1; } continue; }
    if((m = line.match(/^PART\s+([\w-]+)\s*\|(.*)$/i))){
      const f = m[2].split("|").map(s=>s.trim());
      const clefs = (f[2]||"treble").split(/[\s,]+/).filter(Boolean).map(c=>c.toLowerCase()).map(c=>({g:"treble",f:"bass","treble8vb":"treble8"}[c]||c)).filter(c=>["treble","bass","alto","tenor","treble8"].includes(c));
      newPart(m[1], f[0], (f[1]||"").toLowerCase().startsWith("voc")?"vocal":(f[1]||"").toLowerCase().startsWith("acc")?"accompaniment":"instrument", clefs);
      continue;
    }
    if(/^NO MUSIC/i.test(line)) continue;
    if((m = line.match(/^M\s*(-?\d+)?\s*(\|.*)?$/))){
      const prev = sc.measures[sc.measures.length-1];
      cur = {num: m[1]!==undefined? +m[1] : null, time: prev?prev.time:sc.time, key: prev?prev.key:sc.key, mode: prev?prev.mode:sc.mode,
             tempo: prev?prev.tempo:sc.tempo, tempoText:"", partial:false, rit:false, text:"", staves:{}, line:lineNo,
             timeChange: !prev, keyChange: false, tempoChange: !prev, showTempo: !prev};
      if(!prev) cur.tempoText = sc.tempoText;
      for(const seg of (m[2]||"").split("|").map(s=>s.trim()).filter(Boolean)){
        let o;
        if((o = seg.match(/^time\s*=\s*(\d+)\s*\/\s*(\d+)/i))){ const t=[+o[1],+o[2]]; if(!prev || t[0]!==prev.time[0] || t[1]!==prev.time[1]) cur.timeChange = true; cur.time = t; }
        else if((o = seg.match(/^key\s*=\s*(-?\d+)\s*(major|minor)?/i))){ const k = Math.max(-7,Math.min(7,+o[1])); if(prev && k!==prev.key) cur.keyChange = true; cur.key = k; if(o[2]) cur.mode=o[2].toLowerCase(); }
        else if((o = seg.match(/^tempo\s*=\s*(\d+(?:\.\d+)?)\s*(?:"([^"]*)")?/i))){ cur.tempo = +o[1]; cur.tempoText = o[2]||""; cur.tempoChange = true; cur.showTempo = true; }
        else if(/^(pickup|partial|anacrusis)$/i.test(seg)) cur.partial = true;
        else if(/^rit/i.test(seg)) cur.rit = true;
        else if((o = seg.match(/^text\s*=\s*"([^"]*)"/i))) cur.text = o[1];
        else warns.push(`Line ${lineNo}: unknown bar setting "${seg}"`);
      }
      if(cur.rit && !cur.text) cur.text = "rit.";
      sc.measures.push(cur);
      continue;
    }
    if((m = line.match(/^([A-Za-z][\w-]*?)(?:\.(\d))?\s*:\s*(.*)$/))){
      if(!cur){ warns.push(`Line ${lineNo}: notes before the first bar line (M)`); continue; }
      const pid = m[1], si = m[2]?+m[2]:1;
      const part = partById[pid] || newPart(pid, pid, "instrument", ["treble"]);
      while(part.clefs.length < si) part.clefs.push(part.clefs.length? "bass":"treble");
      const key = `${pid}.${si}`;
      const voices = m[3].split("//").map(vs=>{
        const toks = vs.match(/(?:[^\s"]|"[^"]*")+/g) || [];
        const evs = []; let last = null;
        for(const t of toks){
          if(t.startsWith('"')){ if(last) (t.match(/"([^"]*)"/g)||[]).forEach(q => last.lyrics.push(q.slice(1,-1))); continue; }
          const e = parseEvent(t, warns, `Line ${lineNo}`, last);
          if(e){ evs.push(e); last = e; }
        }
        return evs;
      }).filter(v=>v.length);
      if(voices.length) cur.staves[key] = (cur.staves[key]||[]).concat(voices);
      continue;
    }
    warns.push(`Line ${lineNo}: couldn't understand "${line.slice(0,40)}"`);
  }
  // numbering
  let n = null;
  sc.measures.forEach((m,i)=>{
    if(m.num===null || (n!==null && m.num<=n)) m.num = n===null ? (m.partial&&i===0?0:1) : n+1;
    n = m.num;
  });
  // single-staff parts referenced as "P1" map to P1.1 — already. Assign roles if none vocal but lyrics present
  if(!sc.parts.some(p=>p.role==="vocal")){
    for(const p of sc.parts){ if(sc.measures.some(m=>Object.entries(m.staves).some(([k,vs])=>k.startsWith(p.id+".")&&vs.some(v=>v.some(e=>e.lyrics.some(Boolean)))))) { p.role="vocal"; break; } }
  }
  sc.parts.forEach(p => { let n = 0; sc.measures.forEach(m => Object.entries(m.staves).forEach(([k,vs]) => { if(k.startsWith(p.id+".")) vs.forEach(v => v.forEach(e => { let L = e.lyrics.length; while(L && !e.lyrics[L-1]) L--; n = Math.max(n, L); })); })); p.lyricLines = n; });
  if(!sc.title) sc.title = "Untitled score";
  // every event gets an address (bar | staff | voice | position) so visual edits can find it again
  sc.measures.forEach((m, mi) => Object.entries(m.staves).forEach(([k, vs]) => vs.forEach((v, vi) => v.forEach((e, ei) => { e.addr = `${mi}|${k}|${vi}|${ei}`; }))));
  return {score: sc, warns};
}

/* ---------------------------------------------------------------- writing notation back out */
const ACC_OUT = {"-2": "bb", "-1": "b", "0": "", "1": "#", "2": "##"};
const q = t => `"${String(t).replace(/"/g, "'")}"`;
export function eventToText(e){
  let lyr = [...(e.lyrics || [])]; while(lyr.length && !lyr[lyr.length-1]) lyr.pop();
  const marks = (e.tie ? "~" : "") + (e.slurS ? "(" : "") + (e.slurE ? ")" : "")
    + (e.arts || []).map(a => "!" + a).join("") + (e.hp ? "!" + e.hp : "") + (e.hpEnd ? "!he" : "") + (e.dyn ? "@" + e.dyn : "");
  if(e.mrest) return "R" + marks + lyr.map(q).join("");
  const head = e.rest ? "r" : e.pitches.map(p => `${p.step}${ACC_OUT[p.alt] ?? ""}${p.oct}`).join("+");
  return `${head}:${e.dur}${".".repeat(e.dots || 0)}${e.tup || ""}${marks}${lyr.map(q).join("")}`;
}
/** The inverse of parseScore: turns a (possibly edited) score back into text notation. */
export function serializeScore(sc){
  const out = [`TITLE: ${sc.title}`];
  if(sc.composer) out.push(`COMPOSER: ${sc.composer}`);
  out.push(`TEMPO: ${sc.tempo}${sc.tempoText ? " " + sc.tempoText : ""}`, `KEY: ${sc.key} ${sc.mode}`, `TIME: ${sc.time[0]}/${sc.time[1]}`);
  sc.parts.forEach(p => out.push(`PART ${p.id} | ${p.name} | ${p.role} | ${p.clefs.join(" ")}`));
  sc.measures.forEach((m, i) => {
    const prev = i ? sc.measures[i-1] : {time: sc.time, key: sc.key, mode: sc.mode, tempo: sc.tempo, tempoText: sc.tempoText};
    const o = [];
    if(m.time[0] !== prev.time[0] || m.time[1] !== prev.time[1]) o.push(`time=${m.time[0]}/${m.time[1]}`);
    if(m.key !== prev.key || m.mode !== prev.mode) o.push(`key=${m.key} ${m.mode}`);
    if(i ? m.tempoChange : (m.tempo !== sc.tempo)) o.push(`tempo=${m.tempo}${m.tempoText ? " " + q(m.tempoText) : ""}`);
    if(m.partial) o.push("pickup");
    if(m.rit) o.push("rit");
    if(m.text && !(m.rit && m.text === "rit.")) o.push(`text=${q(m.text)}`);
    out.push(`M ${m.num}${o.length ? " | " + o.join(" | ") : ""}`);
    for(const k in m.staves) out.push(`${k}: ${m.staves[k].map(v => v.map(eventToText).join(" ")).join(" // ")}`);
  });
  return out.join("\n") + "\n";
}
