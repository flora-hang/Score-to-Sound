/* MusicXML (partwise) -> the app's text notation, keeping every lyric line. */
export function musicXmlToText(xml){
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  if(doc.querySelector("parsererror")) throw new Error("This file isn't valid MusicXML.");
  if(doc.querySelector("score-timewise")) throw new Error("Timewise MusicXML isn't supported. Export as standard (partwise) MusicXML.");
  const root = doc.querySelector("score-partwise"); if(!root) throw new Error("No MusicXML score found in this file.");
  const kid = (el, tag) => el ? [...el.children].find(c => c.tagName === tag) : null;
  const kids = (el, tag) => el ? [...el.children].filter(c => c.tagName === tag) : [];
  const txt = (el, tag) => { const k = kid(el, tag); return k ? k.textContent.trim() : null; };
  const title = (doc.querySelector("work > work-title") || doc.querySelector("movement-title") || {}).textContent || ((doc.querySelector("credit-words")||{}).textContent) || "Untitled score";
  const composer = (doc.querySelector('identification > creator[type="composer"]') || {}).textContent || "";
  const names = {}; doc.querySelectorAll("part-list > score-part").forEach(sp => names[sp.getAttribute("id")] = (txt(sp, "part-name") || sp.getAttribute("id")).replace(/\|/g, "/"));
  const parts = kids(root, "part");
  const measures = []; const partDefs = []; const lyricNums = {};
  let firstKey = 0, firstMode = "major", firstTime = "4/4", firstTempo = null;
  const typeMap = {breve:"w", whole:"w", half:"h", quarter:"q", eighth:"8", "16th":"16", "32nd":"32", "64th":"64", "128th":"64"};
  const beatsToTokens = (beats) => { const out = []; const opts = [[4,"w"],[3,"h."],[2,"h"],[1.5,"q."],[1,"q"],[.75,"8."],[.5,"8"],[.25,"16"],[.125,"32"],[.0625,"64"]]; let r = beats; for(const [b,d] of opts){ while(r >= b - 1e-4){ out.push(d); r -= b; } } return out; };
  const altStr = a => ({"-2":"bb","-1":"b","0":"","1":"#","2":"##"})[String(Math.round(+a||0))] || "";
  parts.forEach((pel, pi) => {
    const pid = `P${pi+1}`;
    let div = 1, nst = 1, clefs = ["treble"], lyrics = false, octShift = {};
    const order = () => [...(lyricNums[pi]||[])].sort((a,b) => (parseFloat(a)||0) - (parseFloat(b)||0) || String(a).localeCompare(String(b)));
    const mEls = kids(pel, "measure");
    mEls.forEach((mEl, mi) => {
      const M = measures[mi] ||= {num: mEl.getAttribute("number"), implicit: mEl.getAttribute("implicit") === "yes", opts: [], lines: {}};
      let pos = 0; const voices = {}; const pendMark = {};
      const addMark = (staff, mark) => { (pendMark[staff] ||= []).push(mark); };
      for(const c of mEl.children){
        const tag = c.tagName;
        if(tag === "attributes"){
          const d = txt(c, "divisions"); if(d) div = +d;
          const st = txt(c, "staves"); if(st) nst = +st;
          const key = kid(c, "key");
          if(key && pi === 0){ const f = +(txt(key, "fifths")||0), md = (txt(key, "mode")||"major").toLowerCase()==="minor"?"minor":"major"; if(mi === 0){ firstKey = f; firstMode = md; } else M.opts.push(`key=${f} ${md}`); }
          const tm = kid(c, "time");
          if(tm && pi === 0){ const t = `${txt(tm,"beats")}/${txt(tm,"beat-type")}`; if(mi === 0) firstTime = t; else M.opts.push(`time=${t}`); }
          kids(c, "clef").forEach(cl => {
            const n = +(cl.getAttribute("number")||1), sign = txt(cl, "sign"), line = txt(cl, "line"), oc = +(txt(cl, "clef-octave-change")||0);
            let name = sign === "F" ? "bass" : sign === "C" ? (line === "4" ? "tenor" : "alto") : (oc === -1 ? "treble8" : "treble");
            octShift[n] = oc; if(mi === 0) clefs[n-1] = name;
          });
        } else if(tag === "direction"){
          const staff = txt(c, "staff") || "1";
          c.querySelectorAll("direction-type > dynamics > *").forEach(d => addMark(staff, "@" + d.tagName));
          const w = c.querySelector("direction-type > wedge");
          if(w){ const t = w.getAttribute("type"); addMark(staff, t === "crescendo" ? "!cr" : t === "diminuendo" ? "!dim" : "!he"); }
          const snd = kid(c, "sound");
          if(snd && snd.getAttribute("tempo") && pi === 0){ const tp = Math.round(+snd.getAttribute("tempo")); const words = (c.querySelector("direction-type > words")||{}).textContent || ""; if(mi === 0 && firstTempo === null) firstTempo = `${tp} ${words}`.trim(); else M.opts.push(`tempo=${tp}${words ? ` "${words.replace(/"/g,"'")}"` : ""}`); }
          else if(pi === 0){ const words = (c.querySelector("direction-type > words")||{}).textContent; if(words && /rit|rall/i.test(words)) M.opts.push("rit"); }
        } else if(tag === "sound" && c.getAttribute("tempo") && pi === 0){ const tp = Math.round(+c.getAttribute("tempo")); if(mi === 0 && firstTempo === null) firstTempo = String(tp); else M.opts.push(`tempo=${tp}`); }
        else if(tag === "backup"){ pos -= +(txt(c, "duration")||0); }
        else if(tag === "forward"){ pos += +(txt(c, "duration")||0); }
        else if(tag === "note"){
          if(kid(c, "grace") || kid(c, "cue")) continue;
          const dur = +(txt(c, "duration")||0);
          const voice = txt(c, "voice") || "1", staff = txt(c, "staff") || "1";
          const vkey = `${staff}|${voice}`;
          const V = voices[vkey] ||= {staff, voice, toks: [], end: 0};
          const pitchEl = kid(c, "pitch");
          let pitch = null;
          if(pitchEl){ let oct = +txt(pitchEl, "octave") + (octShift[+staff]||0); pitch = `${txt(pitchEl,"step")}${altStr(txt(pitchEl,"alter"))}${oct}`; }
          if(kid(c, "chord")){ const last = V.toks[V.toks.length-1]; if(last && pitch && !last.rest){ last.pitches.push(pitch); if(kid(c,"tie") && c.querySelector('tie[type="start"]')) last.tie = true; } continue; }
          const start = pos;
          if(start > V.end + 1e-6){ beatsToTokens((start - V.end)/div).forEach(d => V.toks.push({rest:true, pitches:[], dur:d.replace(".",""), dots:d.includes(".")?1:0, marks:[]})); }
          const t = txt(c, "type");
          let d = typeMap[t], dots = kids(c, "dot").length;
          let tup = null; const tmod = kid(c, "time-modification"); if(tmod){ const a = +txt(tmod,"actual-notes"); tup = a===3?"t3":a===5?"t5":a===6?"t6":a===7?"t7":null; }
          const isMeasureRest = kid(c, "rest") && kid(c, "rest").getAttribute("measure") === "yes";
          if(!d){ const tk = beatsToTokens(dur/div)[0] || "q"; d = tk.replace(".",""); dots = tk.includes(".")?1:0; }
          const ev = {rest: !pitchEl, mrest: isMeasureRest || (!pitchEl && !t), pitches: pitch ? [pitch] : [], dur: d, dots, tup, marks: (pendMark[staff]||[]).splice(0)};
          if(c.querySelector('tie[type="start"]')) ev.tie = true;
          const nt = kid(c, "notations");
          if(nt){
            nt.querySelectorAll("slur").forEach(s => { if(s.getAttribute("type")==="start") ev.marks.push("("); else if(s.getAttribute("type")==="stop") ev.marks.push(")"); });
            const a = kid(nt, "articulations");
            if(a) for(const x of a.children){ const m = {staccato:"!st", staccatissimo:"!ss", accent:"!ac", "strong-accent":"!ma", tenuto:"!te"}[x.tagName]; if(m) ev.marks.push(m); }
            if(kid(nt, "fermata")) ev.marks.push("!fe");
            const dyn = kid(nt, "dynamics"); if(dyn && dyn.firstElementChild) ev.marks.push("@" + dyn.firstElementChild.tagName);
          }
          ev.lyrics = {};
          kids(c, "lyric").forEach((ly, k) => {
            const t = ly.querySelectorAll("text"); if(!t.length) return;
            lyrics = true;
            const num = ly.getAttribute("number") || String(k+1);
            const syl = txt(ly, "syllabic");
            ev.lyrics[num] = [...t].map(x => x.textContent).join("").replace(/"/g, "'") + (syl === "begin" || syl === "middle" ? "-" : "");
            (lyricNums[pi] ||= new Set()).add(num);
          });
          V.toks.push(ev);
          V.end = start + dur; pos += dur;
        }
      }
      const lyrStr = e => { if(!e.lyrics || !Object.keys(e.lyrics).length) return ""; const nums = order(); let arr = nums.map(n => e.lyrics[n] || ""); while(arr.length && !arr[arr.length-1]) arr.pop(); return arr.map(t => `"${t}"`).join(""); };
      const fmtEv = e => {
        if(e.mrest) return "R" + e.marks.filter(m=>m.startsWith("@")||m==="!fe").join("");
        const head = e.rest ? "r" : e.pitches.join("+");
        return `${head}:${e.dur}${".".repeat(e.dots)}${e.tup||""}${e.tie?"~":""}${e.marks.join("")}${lyrStr(e)}`;
      };
      const byStaff = {};
      Object.values(voices).sort((a,b) => +a.voice - +b.voice).forEach(V => (byStaff[V.staff] ||= []).push(V.toks.map(fmtEv).join(" ")));
      for(let s=1; s<=nst; s++) M.lines[`${pid}.${s}`] = (byStaff[s] && byStaff[s].length) ? byStaff[s].join(" // ") : "R";
    });
    while(clefs.length < nst) clefs.push(clefs.length ? "bass" : "treble");
    const nm = names[pel.getAttribute("id")] || pid;
    const role = (lyrics || /voice|vocal|sopran|alto|tenor|bariton|bass voice|sing|melod|lead|chor/i.test(nm)) && nst === 1 ? "vocal" : (/piano|organ|keyboard|harp|guitar|accomp/i.test(nm) ? "accompaniment" : "instrument");
    partDefs.push(`PART ${pid} | ${nm} | ${role} | ${clefs.slice(0,nst).join(" ")}`);
  });
  let out = `TITLE: ${title.trim().replace(/\s+/g," ")}\nCOMPOSER: ${composer.trim().replace(/\s+/g," ")}\nTEMPO: ${firstTempo || "100"}\nKEY: ${firstKey} ${firstMode}\nTIME: ${firstTime}\n${partDefs.join("\n")}\n`;
  let num = 0;
  measures.forEach((M, i) => {
    let n = parseInt(M.num, 10); if(isNaN(n) || n <= num - (i?0:1)) n = i===0 ? (M.implicit?0:1) : num + 1;
    if(i>0 && n <= num) n = num + 1;
    num = n;
    const opts = [...M.opts]; if(M.implicit) opts.push("pickup");
    out += `M ${n}${opts.length ? " | " + opts.join(" | ") : ""}\n`;
    for(const k in M.lines) out += `${k}: ${M.lines[k]}\n`;
  });
  return out;
}
