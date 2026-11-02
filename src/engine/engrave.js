/* Engraving with VexFlow: lays out systems, measures each one, then places notes,
   slurs, lyrics and dynamics in separate bands so nothing overlaps. */
import * as VF from "vexflow/bravura";   // the Bravura music font only, not all three
import { DUR_BEATS, TUP } from "./notation.js";
import { MAJ } from "./keys.js";
import { staffKeys } from "./timeline.js";

const NS = "http://www.w3.org/2000/svg";
const LY_GAP = 19;
const VF_CLEF = {treble:"treble", bass:"bass", alto:"alto", tenor:"tenor", treble8:"treble"};
const REST_KEY = {treble:"b/4", bass:"d/3", alto:"c/4", tenor:"a/3", treble8:"b/4"};
const ACC_STR = {"-2":"bb","-1":"b","0":"","1":"#","2":"##"};
const keyStr = (p, shift) => `${p.step.toLowerCase()}${ACC_STR[p.alt]}/${p.oct + shift}`;
const W_EST = {w:46,h:38,q:31,"8":26,"16":22,"32":20,"64":19};

function measureMinWidth(m, keys){
  let w = 0;
  for(const st of keys){
    for(const v of (m.staves[st.key]||[])){
      let s = 0;
      for(const e of v){
        let ew = e.mrest ? 64 : (W_EST[e.dur]||30);
        if(e.dots) ew += 7;
        ew += e.pitches.filter(p=>p.alt).length*8;
        if(st.part.role==="vocal") for(const ly of shownLyrics(e)) ew = Math.max(ew, textW(ly.t) + 10);
        s += ew;
      }
      w = Math.max(w, s);
    }
  }
  return Math.max(60, w + 22);
}
const isWide = ch => /[\u1100-\u11ff\u2e80-\ua4cf\uac00-\ud7af\uf900-\ufaff\uff00-\uffef]/.test(ch);
function textW(t){ let w = 0; for(const ch of t) w += isWide(ch) ? 14.5 : 7.6; return w; }
let O = {zoom: 1, lyricsAbove: false, hiddenLines: new Set()};   // options for the render in progress
function shownLyrics(e){ const out = []; (e.lyrics||[]).forEach((t, i) => { if(t && !O.hiddenLines.has(i)) out.push({t, i}); }); return out; }
function visibleLineIdx(p){ const r = []; for(let i=0;i<(p.lyricLines||0);i++) if(!O.hiddenLines.has(i)) r.push(i); return r; }
function ghostFill(beats){
  const out = []; const opts = [[4,"w"],[2,"h"],[1,"q"],[.5,"8"],[.25,"16"],[.125,"32"],[.0625,"64"]];
  let r = beats;
  for(const [b,d] of opts){ while(r >= b - 1e-4){ out.push(new VF.GhostNote(d)); r -= b; } }
  return out;
}
function svgEl(svg, tag, attrs, text){
  const el = document.createElementNS(NS, tag);
  for(const k in attrs) el.setAttribute(k, attrs[k]);
  if(text !== undefined) el.textContent = text;
  svg.appendChild(el); return el;
}
function noteCenterX(n){
  try{ if(n.getNoteHeadBeginX){ const a = n.getNoteHeadBeginX(), b = n.getNoteHeadEndX(); if(isFinite(a)&&isFinite(b)) return (a+b)/2; } }catch(_){}
  try{ return n.getAbsoluteX() + 6; }catch(_){ return 0; }
}

/**
 * Engrave `sc` into `host` (a DOM element React owns but leaves empty).
 * Returns one entry per system (line of music) with the x-position of every beat, used for
 * the playhead, click-to-seek, highlighting and page turns.
 */
export function engrave(host, sc, opts){
  O = {zoom: 1, lyricsAbove: false, hiddenLines: new Set(), ...opts};
  const onSeek = opts.onSeek || (() => {});
  host.innerHTML = "";
  const systemsOut = [];
  if(!sc || !sc.measures.length) return systemsOut;
  const zoom = O.zoom;
  const avail = Math.max(300, host.clientWidth || 800);
  const W = avail / zoom;
  const keys = staffKeys(sc);
  const multi = keys.length > 1;
  const named = sc.parts.length > 1;
  const left0 = named ? 78 : (multi ? 30 : 6), leftN = named ? 46 : (multi ? 30 : 6), right = 4;
  const mw = sc.measures.map(m => measureMinWidth(m, keys));
  const prefixW = (m, first, withTime) => (first ? 36 + Math.abs(m.key)*10 + 4 : 0) + (!first && m.keyChange ? Math.abs(m.key)*10 + 18 : 0) + (withTime ? 28 : 0);
  // greedy line breaking
  const systems = []; let cur = [], used = 0;
  sc.measures.forEach((m, i) => {
    const first = cur.length === 0;
    const pre = prefixW(m, first, (systems.length===0 && first) || m.timeChange);
    const lim = W - (systems.length===0 ? left0 : leftN) - right;
    if(!first && used + mw[i] + pre > lim){ systems.push(cur); cur = []; used = 0; const p2 = prefixW(m, true, m.timeChange); cur.push(i); used = mw[i] + p2; return; }
    cur.push(i); used += mw[i] + pre;
  });
  if(cur.length) systems.push(cur);

  const lastIdx = sc.measures.length - 1;
  const pendTie = {}, pendSlur = {}, pendHp = {}, pendHyph = {};

  systems.forEach((idxs, si) => {
    const left = si===0 ? left0 : leftN;
    const lim = W - left - right;
    const pres = idxs.map((mi, j) => prefixW(sc.measures[mi], j===0, (si===0 && j===0) || sc.measures[mi].timeChange));
    const minSum = idxs.reduce((s, mi, j) => s + mw[mi] + pres[j], 0);
    const isLast = si === systems.length-1;
    const extra = (isLast && minSum < lim*.65) ? Math.min(lim - minSum, minSum*.25) : Math.max(0, lim - minSum);
    const mwSum = idxs.reduce((s, mi) => s + mw[mi], 0);
    const widths = idxs.map((mi, j) => mw[mi] + pres[j] + extra*mw[mi]/mwSum);
    const sysHasTop = idxs.some(mi => sc.measures[mi].showTempo || sc.measures[mi].text) ;
    const provisional = () => {
    let y = sysHasTop ? 30 : 4;
    const staffY = {};
    keys.forEach((st, ki) => {
      staffY[st.key] = y;
      const vocal = st.part.role === "vocal";
      let h = 84;
      if(vocal){ const nl = Math.max(1, visibleLineIdx(st.part).length); h += O.lyricsAbove ? 10 : 34 + (nl-1)*LY_GAP; if(O.lyricsAbove) staffY[st.key] += (nl-1)*LY_GAP, y += (nl-1)*LY_GAP; }
      if(!vocal && st.part.clefs.length > 1 && st.idx === 0) h += 6;
      const nextIsNewPart = ki < keys.length-1 && keys[ki+1].part !== st.part;
      if(nextIsNewPart) h += 14;
      y += h;
    });
    return {Y: staffY, H: y + 18};
    };
    const drawSys = (staffY, H, EXT, measure, pendHpAtStart) => {
    const wrap = document.createElement("div");
    wrap.className = "sys";
    if(!measure) host.appendChild(wrap);
    const renderer = new VF.Renderer(wrap, VF.Renderer.Backends.SVG);
    renderer.resize(W*zoom, H*zoom);
    const ctx = renderer.getContext();
    ctx.scale(zoom, zoom);
    ctx.setFillStyle("currentColor"); ctx.setStrokeStyle("currentColor");
    const svg = ctx.svg;
    const sysInfo = {el: wrap, pts: [], evs: [], start: sc.measures[idxs[0]].start, end: sc.measures[idxs[idxs.length-1]].start + sc.measures[idxs[idxs.length-1]].len,
      top: (staffY[keys[0].key] + 34), bottom: (staffY[keys[keys.length-1].key] + 86), zoom, mIdx: idxs};
    let x = left;
    let firstStaves = null;
    const staffNotes = {}; // per staff key: list of {e,n} for lyric/dyn drawing
    keys.forEach(st => staffNotes[st.key] = []);

    idxs.forEach((mi, j) => {
      const m = sc.measures[mi];
      const w = widths[j];
      const prevKey = mi>0 ? sc.measures[mi-1].key : m.key;
      const staves = {};
      keys.forEach(st => {
        const s = new VF.Stave(x, staffY[st.key], w);
        if(j===0){
          s.addClef(VF_CLEF[st.clef], "default", st.clef==="treble8" ? "8vb" : undefined);
          if(m.key) s.addKeySignature(MAJ[m.key+7]);
          if((si===0) || m.timeChange) s.addTimeSignature(`${m.time[0]}/${m.time[1]}`);
        } else {
          if(m.keyChange) s.addKeySignature(MAJ[m.key+7], MAJ[prevKey+7]);
          if(m.timeChange) s.addTimeSignature(`${m.time[0]}/${m.time[1]}`);
        }
        if(mi === lastIdx) s.setEndBarType(VF.Barline.type.END);
        s.setContext(ctx).draw();
        staves[st.key] = s;
      });
      if(j===0) firstStaves = staves;
      // connectors
      if(multi){
        const top = staves[keys[0].key], bot = staves[keys[keys.length-1].key];
        if(j===0) new VF.StaveConnector(top, bot).setType(VF.StaveConnector.type.SINGLE_LEFT).setContext(ctx).draw();
        sc.parts.forEach(p => {
          if(p.clefs.length < 2) return;
          const a = staves[`${p.id}.1`], b = staves[`${p.id}.${p.clefs.length}`];
          if(j===0) new VF.StaveConnector(a, b).setType(VF.StaveConnector.type.BRACE).setContext(ctx).draw();
          new VF.StaveConnector(a, b).setType(mi===lastIdx ? VF.StaveConnector.type.BOLD_DOUBLE_RIGHT : VF.StaveConnector.type.SINGLE_RIGHT).setContext(ctx).draw();
        });
      }
      // notes
      const allVoices = [], perStave = {}, made = [];
      keys.forEach(st => {
        const stave = staves[st.key];
        let vlist = m.staves[st.key];
        if(!vlist || !vlist.length) vlist = [[{rest:true, mrest:true, pitches:[], dur:"w", dots:0, arts:[], beats:m.len, onset:m.start, synthetic:true}]];
        const shift = st.clef==="treble8" ? 1 : 0;
        const voices = [];
        vlist.forEach((evs, vi) => {
          const stemDir = vlist.length > 1 ? (vi % 2 === 0 ? 1 : -1) : 0;
          const notes = evs.map(e => {
            let n;
            if(e.mrest) n = new VF.StaveNote({clef:VF_CLEF[st.clef], keys:[REST_KEY[st.clef]], duration:"wr", align_center:true});
            else if(e.rest) n = new VF.StaveNote({clef:VF_CLEF[st.clef], keys:[REST_KEY[st.clef]], duration:e.dur+"r", dots:e.dots});
            else {
              const opt = {clef:VF_CLEF[st.clef], keys:e.pitches.map(p=>keyStr(p, shift)), duration:e.dur, dots:e.dots};
              if(stemDir) opt.stem_direction = stemDir; else opt.auto_stem = true;
              n = new VF.StaveNote(opt);
            }
            if(e.dots && !e.mrest){ for(let d=0; d<e.dots; d++) VF.Dot.buildAndAttach([n], {all:true}); }
            if(!e.rest){
              const up = n.getStemDirection && n.getStemDirection() === 1;
              for(const a of e.arts){
                const code = {st:"a.", ss:"av", ac:"a>", ma:"a^", te:"a-", fe:"a@a"}[a];
                if(!code) continue;
                const art = new VF.Articulation(code);
                art.setPosition(a==="fe" ? VF.Modifier.Position.ABOVE : (up ? VF.Modifier.Position.BELOW : VF.Modifier.Position.ABOVE));
                n.addModifier(art, 0);
              }
            } else if(e.arts.includes("fe")){
              const art = new VF.Articulation("a@a"); art.setPosition(VF.Modifier.Position.ABOVE); n.addModifier(art, 0);
            }
            made.push({e, n, st, vi});
            return n;
          });
          // tuplets
          for(let i=0; i<evs.length; ){
            if(!evs[i].tup){ i++; continue; }
            const [num, occ] = TUP[evs[i].tup];
            const raw = DUR_BEATS[evs[i].dur] * (evs[i].dots ? 1.5 : 1);
            let sum = 0, j2 = i;
            while(j2 < evs.length && evs[j2].tup === evs[i].tup && sum < raw*num - 1e-4){ sum += DUR_BEATS[evs[j2].dur]*(evs[j2].dots?1.5:1); j2++; }
            try{ new VF.Tuplet(notes.slice(i, j2), {num_notes:num, notes_occupied:occ, ratioed:false}); }catch(_){}
            i = j2;
          }
          let total = 0; evs.forEach(e => total += e.mrest ? m.len : e.beats);
          const ghosts = total < m.len - 1e-3 ? ghostFill(m.len - total) : [];
          const voice = new VF.Voice({num_beats: Math.max(1, Math.round(Math.max(m.len,total)*8)), beat_value:32}).setMode(VF.Voice.Mode.SOFT);
          voice.addTickables(notes.concat(ghosts));
          voice._beamable = notes.filter(n => !n.isRest || !n.isRest());
          voice._notes = notes;
          voice._multi = vlist.length > 1;
          voices.push(voice);
        });
        try{ VF.Accidental.applyAccidentals(voices, MAJ[m.key+7]); }catch(_){}
        voices.forEach(v => v.getTickables().forEach(t => { try{ t.setStave(stave); }catch(_){} }));
        perStave[st.key] = voices;
        allVoices.push(...voices);
      });
      // beams
      const beams = [];
      const groups = (() => { try{ return VF.Beam.getDefaultBeamGroups(`${m.time[0]}/${m.time[1]}`); }catch(_){ return undefined; } })();
      allVoices.forEach(v => { try{ beams.push(...VF.Beam.generateBeams(v._notes.filter(n => !(n instanceof VF.GhostNote)), {groups, maintain_stem_directions: v._multi})); }catch(_){} });
      // align note start across staves
      const startX = Math.max(...keys.map(st => staves[st.key].getNoteStartX()));
      keys.forEach(st => staves[st.key].setNoteStartX(startX));
      const fw = Math.max(20, staves[keys[0].key].getNoteEndX() - startX - 10);
      try{
        const fmt = new VF.Formatter();
        keys.forEach(st => fmt.joinVoices(perStave[st.key]));
        fmt.format(allVoices, fw);
      }catch(err){
        keys.forEach(st => { try{ new VF.Formatter().joinVoices(perStave[st.key]).format(perStave[st.key], fw); }catch(_){} });
      }
      keys.forEach(st => perStave[st.key].forEach(v => { try{ v.draw(ctx, staves[st.key]); }catch(err){ console.warn("draw", err); } }));
      beams.forEach(b => { try{ b.setContext(ctx).draw(); }catch(_){} });
      allVoices.forEach(v => v.getTickables().forEach(t => { if(t.tuplet){ try{ t.tuplet.setContext(ctx).draw(); }catch(_){} } }));
      // positions, ties, slurs
      const mEnd = staves[keys[0].key].getX() + staves[keys[0].key].getWidth();
      sysInfo.pts.push({beat: m.start + m.len - 1e-4, x: mEnd - 6, end: true});
      if(!made.some(o=>Math.abs(o.e.onset - m.start) < 1e-4)) sysInfo.pts.push({beat:m.start, x:startX});
      for(const {e, n, st, vi} of made){
        const cx = e.mrest ? (startX + mEnd)/2 : noteCenterX(n);
        e._x = cx;
        sysInfo.pts.push({beat: e.onset, x: cx, ev: true});
        if(!e.synthetic) staffNotes[st.key].push({e, n, x: cx});
        let id = null; try{ id = n.getAttribute("id"); }catch(_){}
        let ys = []; try{ ys = n.getYs(); }catch(_){}
        sysInfo.evs.push({onset:e.onset, end:e.onset + e.beats, id, part: st.part.id, rest: e.rest, e, x: cx, ys, staff: st.key, clef: st.clef, synthetic: !!e.synthetic});
        const vk = `${st.key}#${vi}`;
        // ties
        if(pendTie[vk] && !e.rest){
          const pt = pendTie[vk];
          const fi = [], li = [];
          pt.e.pitches.forEach((p, a) => { const b = e.pitches.findIndex(q => q.midi === p.midi); if(b >= 0){ fi.push(a); li.push(b); } });
          if(fi.length){
            try{
              if(pt.sys === si) new VF.StaveTie({first_note:pt.n, last_note:n, first_indices:fi, last_indices:li}).setContext(ctx).draw();
              else new VF.StaveTie({first_note:null, last_note:n, first_indices:fi, last_indices:li}).setContext(ctx).draw();
            }catch(_){}
          }
          delete pendTie[vk];
        }
        if(e.tie && !e.rest) pendTie[vk] = {n, e, sys: si, ctx};
        // slurs
        if(e.slurS && !e.rest) pendSlur[vk] = {n, sys: si};
        if(e.slurE && pendSlur[vk]){
          const ps = pendSlur[vk];
          try{
            if(ps.sys === si) new VF.Curve(ps.n, n, {}).setContext(ctx).draw();
            else new VF.Curve(null, n, {}).setContext(ctx).draw();
          }catch(_){}
          delete pendSlur[vk];
        }
      }
      // tempo & text marks
      if(m.showTempo || m.text){
        const E0 = (EXT && EXT[keys[0].key]) || {above:0, dyn:false};
        const ty = staffY[keys[0].key] + 40 - E0.above - (keys[0].part.role === "vocal" && !O.lyricsAbove && E0.dyn ? 24 : 0) - 10;
        let tx = j===0 ? startX - 8 : x + 6;
        if(m.showTempo){
          const t = svgEl(svg, "text", {x: tx, y: ty, class:"tempo"});
          svgEl(t, "tspan", {class:"qn"}, "\u2669");
          svgEl(t, "tspan", {}, ` = ${Math.round(m.tempo)}${m.tempoText ? "   " + m.tempoText : ""}`);
          tx += (`= ${Math.round(m.tempo)}   ${m.tempoText}`).length * 7.4 + 30;
        }
        if(m.text) svgEl(svg, "text", {x: tx, y: ty, class:"mtext"}, m.text);
      }
      // measure number at system start
      if(j===0 && si>0) svgEl(svg, "text", {x: x + 2, y: staffY[keys[0].key] + 40 - Math.max(8, ((EXT && EXT[keys[0].key]) || {above:0}).above * 0 + 8), class:"mnum"}, String(m.num));
      x += w;
    });
    // ties that cross the system end: draw to the right edge
    for(const vk in pendTie){ const pt = pendTie[vk]; if(pt.sys === si){ try{ new VF.StaveTie({first_note:pt.n, last_note:null, first_indices:pt.e.pitches.map((_,i)=>i), last_indices:pt.e.pitches.map((_,i)=>i)}).setContext(ctx).draw(); }catch(_){} } }
    for(const vk in pendSlur){ const ps = pendSlur[vk]; if(ps.sys === si){ try{ new VF.Curve(ps.n, null, {}).setContext(ctx).draw(); }catch(_){} ps.sys = si + .5; } }
    // part names
    if(named){
      sc.parts.forEach(p => {
        const y1 = staffY[`${p.id}.1`] + 40, y2 = staffY[`${p.id}.${p.clefs.length}`] + 80;
        const label = si===0 ? p.name : (p.name.length > 5 ? p.name.slice(0,4) + "." : p.name);
        svgEl(svg, "text", {x: left - (p.clefs.length>1 ? 16 : 6), y: (y1+y2)/2 + 4, class:"pname", "text-anchor":"end"}, label);
      });
    }
    if(measure) return measureExtents(staffNotes, staffY, keys, pendHpAtStart);
    // lyrics, dynamics, hairpins
    const sysRight = x;
    keys.forEach(st => {
      const list = staffNotes[st.key];
      const vocal = st.part.role === "vocal";
      const top = staffY[st.key] + 40, bot = staffY[st.key] + 80;
      const E = EXT[st.key] || {above:0, below:0, dyn:false};
      const lyY = O.lyricsAbove ? top - E.above - 10 : bot + E.below + 20;
      let dynY = vocal ? (O.lyricsAbove ? bot + E.below + 16 : top - E.above - 12) : bot + E.below + 16;
      // lyrics: one row per lyric line (verses, translations), stacked
      if(vocal){
        const rows = visibleLineIdx(st.part);
        const nRows = Math.max(1, rows.length);
        rows.forEach((li, r) => {
          const y = O.lyricsAbove ? lyY - (nRows - 1 - r)*LY_GAP : lyY + r*LY_GAP;
          const hk = `${st.key}|${li}`;
          for(const o of list){
            if(o.e.rest) continue;
            const txt = o.e.lyrics[li]; if(!txt) continue;
            const hy = /-$/.test(txt) && txt.length > 1;
            const show = hy ? txt.slice(0,-1) : txt;
            const el = svgEl(svg, "text", {x: o.x, y, class:"lyric", "text-anchor":"middle"}, show);
            const ev = sysInfo.evs.find(v => v.e === o.e); if(ev) (ev.ly ||= []).push(el);
            const half = textW(show)/2;
            const ph = pendHyph[hk];
            if(ph){ const x1 = ph.sys === si ? ph.xEnd : left + 20; const x2 = o.x - half; if(x2 - x1 > 6) svgEl(svg, "text", {x:(x1+x2)/2, y, class:"lyric", "text-anchor":"middle"}, "-"); delete pendHyph[hk]; }
            if(hy) pendHyph[hk] = {xEnd: o.x + half, sys: si};
          }
          const ph = pendHyph[hk];
          if(ph && ph.sys === si){ svgEl(svg, "text", {x: Math.min(sysRight - 8, ph.xEnd + 14), y, class:"lyric", "text-anchor":"middle"}, "-"); ph.sys = -1; }
          if(si === 0 && rows.length > 1){ const first = list.find(o => !o.e.rest && o.e.lyrics[li]); if(first) svgEl(svg, "text", {x: first.x - textW(first.e.lyrics[li].replace(/-$/,""))/2 - 8, y, class:"lyric vnum", "text-anchor":"end"}, `${li+1}.`); }
        });
      }
      // dynamics
      for(const o of list){
        if(o.e.dyn) svgEl(svg, "text", {x: o.x - 4, y: dynY + 4, class:"dyn", "text-anchor":"middle"}, o.e.dyn);
      }
      // hairpins
      const hp = pendHp[st.key];
      let open = hp ? {x: left + 18, dir: hp.dir} : null;
      for(const o of list){
        if(o.e.hpEnd && open){ drawHp(svg, open.x, o.x + (o.e.hp?0:6), dynY, open.dir); open = null; }
        if(o.e.hp){ if(open) drawHp(svg, open.x, o.x - 10, dynY, open.dir); open = {x: o.x + (o.e.dyn ? 14 : -4), dir: o.e.hp==="cr"?1:-1}; }
      }
      if(open){ drawHp(svg, open.x, sysRight - 6, dynY, open.dir); pendHp[st.key] = {dir: open.dir}; } else delete pendHp[st.key];
    });
    // finalize system info
    sysInfo.pts.sort((a,b) => a.beat - b.beat || a.x - b.x);
    let mx = -Infinity; sysInfo.pts.forEach(p => { if(p.x < mx) p.x = mx; mx = p.x; });
    sysInfo.H = H;
    { const k0 = keys[0]; const nl = k0.part.role === "vocal" && !O.lyricsAbove ? Math.max(1, visibleLineIdx(k0.part).length) : 0;
      const E = (EXT && EXT[k0.key]) || {below:0}; sysInfo.readBottom = staffY[k0.key] + 80 + E.below + (nl ? 26 + (nl-1)*LY_GAP : 14); }
    // hover line and playhead holders
    const hl = document.createElement("div"); hl.className = "hoverline"; hl.style.top = sysInfo.top*zoom + "px"; hl.style.height = (sysInfo.bottom - sysInfo.top)*zoom + "px"; wrap.appendChild(hl);
    wrap.addEventListener("mousemove", ev => { const r = wrap.getBoundingClientRect(); const xs = snapX(sysInfo, (ev.clientX - r.left)/zoom); hl.style.left = xs.x*zoom + "px"; });
    wrap.addEventListener("click", ev => { const r = wrap.getBoundingClientRect(); const s = snapX(sysInfo, (ev.clientX - r.left)/zoom); onSeek(s.beat); });
    wrap.setAttribute("title", "Click to start playing from here");
    systemsOut.push(sysInfo);
    };
    // pass 1: draw off-screen to measure how far notes, stems, beams, slurs and ties reach
    const snap = [pendTie, pendSlur, pendHp, pendHyph].map(m => Object.fromEntries(Object.entries(m).map(([k,v]) => [k, {...v}])));
    const hpStart = {...pendHp};
    const P = provisional();
    const ext = drawSys(P.Y, P.H, null, true, hpStart);
    [pendTie, pendSlur, pendHp, pendHyph].forEach((m, i) => { for(const k in m) delete m[k]; Object.assign(m, snap[i]); });
    // pass 2: give every staff, lyric row and dynamics row its own band
    const L = bandLayout(keys, ext, sysHasTop, si);
    drawSys(L.Y, L.H, ext, false, hpStart);
  });
  // ids for highlighting
  for(const s of systemsOut) for(const ev of s.evs){ if(ev.id){ ev.el = s.el.querySelector(`#vf-${CSS.escape(ev.id)}`); } }
  return systemsOut;
}
/* Measured vertical reach of each staff in one system (relative to its five lines). */
function measureExtents(staffNotes, staffY, keys, pendHpAtStart){
  const ext = {};
  keys.forEach(st => {
    const top = staffY[st.key] + 40, bot = staffY[st.key] + 80;
    let minY = top, maxY = bot, dyn = !!(pendHpAtStart && pendHpAtStart[st.key]);
    for(const {n, e} of staffNotes[st.key]){
      if(e.dyn || e.hp || e.hpEnd) dyn = true;
      try{ const bb = n.getBoundingBox(); if(bb){ minY = Math.min(minY, bb.getY()); maxY = Math.max(maxY, bb.getY() + bb.getH()); } }catch(_){}
      if(e.rest) continue;
      let ys = []; try{ ys = n.getYs(); }catch(_){}
      if(!ys.length) continue;
      const up = n.getStemDirection && n.getStemDirection() === 1;
      const lo = Math.max(...ys), hi = Math.min(...ys);
      // slurs and ties curve on the notehead side, opposite the stem
      const curved = e.slurS || e.slurE || e.inSlur || e.tie;
      const reach = (e.slurS || e.slurE || e.inSlur) ? 20 : (e.tie ? 13 : 0);
      if(curved){ if(up) maxY = Math.max(maxY, lo + reach); else minY = Math.min(minY, hi - reach); }
      // articulations stack on the notehead side too; fermatas always above
      const nArt = e.arts.filter(a => a !== "fe").length;
      if(nArt){ if(up) maxY = Math.max(maxY, lo + 10 + nArt*9); else minY = Math.min(minY, hi - 10 - nArt*9); }
      if(e.arts.includes("fe")) minY = Math.min(minY, Math.min(hi, top) - 22);
    }
    ext[st.key] = {above: Math.max(0, top - minY), below: Math.max(0, maxY - bot), dyn};
  });
  return ext;
}
/* Stack the staves so each band (marks above, notes, lyrics or dynamics below) never overlaps the next. */
function bandLayout(keys, ext, sysHasTop, si){
  const Y = {}; let prevBottom = 0;
  keys.forEach((st, ki) => {
    const E = ext[st.key];
    const vocal = st.part.role === "vocal";
    const nl = vocal ? Math.max(1, visibleLineIdx(st.part).length) : 0;
    let above = E.above + 4, below = E.below + 4;
    if(vocal){
      if(O.lyricsAbove){ above += 10 + nl*LY_GAP; if(E.dyn) below += 26; }
      else { below += 8 + nl*LY_GAP; if(E.dyn) above += 24; }
    } else if(E.dyn) below += 28;
    if(ki === 0){ if(sysHasTop) above += 28; else if(si > 0) above = Math.max(above, 16); }
    const gap = ki === 0 ? 2 : (keys[ki-1].part === st.part ? 6 : 16);
    let y = prevBottom + gap + above - 40;
    if(ki > 0) y = Math.max(y, Y[keys[ki-1].key] + 80);
    Y[st.key] = y; E.aboveTot = above; E.belowTot = below;
    prevBottom = y + 80 + below;
  });
  return {Y, H: prevBottom + 12};
}
function drawHp(svg, x1, x2, y, dir){
  if(x2 - x1 < 10) return;
  const open = 5.5;
  if(dir > 0){ svgEl(svg, "line", {x1, y1:y, x2, y2:y-open, class:"hp"}); svgEl(svg, "line", {x1, y1:y, x2, y2:y+open, class:"hp"}); }
  else { svgEl(svg, "line", {x1, y1:y-open, x2, y2:y, class:"hp"}); svgEl(svg, "line", {x1, y1:y+open, x2, y2:y, class:"hp"}); }
}
export function xAtBeat(sys, b){
  const P = sys.pts; if(!P.length) return 0;
  if(b <= P[0].beat) return P[0].x;
  for(let i=1;i<P.length;i++){
    if(b <= P[i].beat + 1e-9){ const a = P[i-1], c = P[i]; return c.beat - a.beat < 1e-9 ? c.x : a.x + (c.x - a.x) * (b - a.beat)/(c.beat - a.beat); }
  }
  return P[P.length-1].x;
}
export function snapX(sys, x){
  let best = null;
  for(const p of sys.pts){ if(!p.ev) continue; const d = Math.abs(p.x - x); if(!best || d < best.d - .01 || (Math.abs(d-best.d)<.01 && p.beat < best.beat)) best = {d, beat:p.beat, x:p.x}; }
  return best || {beat: sys.start, x: 0};
}
export function sysForBeat(S, b){
  if(!S || !S.length) return null;
  for(let i=S.length-1;i>=0;i--) if(b >= S[i].start - 1e-6) return S[i];
  return S[0];
}
