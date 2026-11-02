import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { parseScore, serializeScore } from "./engine/notation.js";
import * as E from "./engine/edit.js";
import { transposeScore } from "./engine/keys.js";
import { buildTimeline, measureAt } from "./engine/timeline.js";
import { DEMO } from "./engine/demo.js";
import { usePlayer, useClock } from "./hooks/usePlayer.js";
import useClaude from "./hooks/useClaude.js";
import useToast from "./hooks/useToast.js";
import useMediaQuery from "./hooks/useMediaQuery.js";
import AppBar from "./components/AppBar.jsx";
import ScoreView from "./components/ScoreView.jsx";
import Sidebar from "./components/Sidebar.jsx";
import Transport from "./components/Transport.jsx";
import ImportDialog from "./components/ImportDialog.jsx";
import LibraryDialog from "./components/LibraryDialog.jsx";
import EditNotesDialog from "./components/EditNotesDialog.jsx";
import ShortcutsDialog from "./components/ShortcutsDialog.jsx";
import EditToolbar from "./components/EditToolbar.jsx";

const LAST_KEY = "pa:last";
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

function defaultMix(score, saved){
  const mix = {};
  score.parts.forEach(p => { const s = saved && saved[p.id]; mix[p.id] = s ? {...s} : {on: true, vol: p.role === "vocal" ? .9 : .8, inst: "piano"}; });
  return mix;
}
const firstVocal = score => (score.parts.find(p => p.role === "vocal") || {}).id || null;
/** The score to show on load: the last one you had open, or the example. */
function initialDoc(){
  try{
    const last = JSON.parse(localStorage.getItem(LAST_KEY) || "null");
    if(last && last.src){ const {score, warns} = parseScore(last.src); if(score.measures.length) return {src: last.src, score, warns, id: last.id || null, demo: false, settings: last.settings || {}}; }
  }catch(_){}
  const {score, warns} = parseScore(DEMO);
  return {src: DEMO, score, warns, id: null, demo: true, settings: {}};
}

export default function App(){
  // ---- the open score and how it is played
  const [init] = useState(initialDoc);
  const [doc, setDoc] = useState(init);
  const [transpose, setTranspose] = useState(init.settings.transpose || 0);
  const [tempoF, setTempoF] = useState(init.settings.tempoF || 1);
  const [mix, setMix] = useState(() => defaultMix(init.score, init.settings.mix));
  const [myPart, setMyPart] = useState(() => init.settings.myPart || firstVocal(init.score));
  const [expressive, setExpressive] = useState(true);
  const [countIn, setCountIn] = useState(false);
  const [metronome, setMetronome] = useState(false);
  // ---- how it is shown
  const [zoom, setZoom] = useState(1);
  const [lyricsAbove, setLyricsAbove] = useState(false);
  const [hiddenLines, setHiddenLines] = useState(() => new Set());
  const [follow, setFollow] = useState(true);
  // ---- playback position
  const [playing, setPlaying] = useState(false);
  const [cursor, setCursor] = useState(0);
  // ---- visual editing
  const [editing, setEditing] = useState(false);
  const [sel, setSel] = useState(null);          // {addr, pi}: the selected note and which pitch of a chord
  const history = useRef({past: [], future: []});
  const [, setHistVer] = useState(0);
  // ---- interface
  const [dialog, setDialog] = useState(null);   // "import" | "library" | "text" | "keys"
  const [railOpen, setRailOpen] = useState(false);
  const [toastMsg, toast] = useToast();
  const narrow = useMediaQuery("(max-width:860px)");
  const railRef = useRef(null);

  const claude = useClaude();

  // The score in the chosen key, with every note's timing and expression worked out.
  const view = useMemo(() => {
    const v = transposeScore(doc.score, transpose);
    buildTimeline(v, {expressive});
    return v;
  }, [doc.score, transpose, expressive]);

  // ---- playback
  const [player, soundState] = usePlayer(() => { setPlaying(false); setCursor(0); });
  const clock = useClock(player, playing);
  const live = useRef(); live.current = {view, tempoF, mix, metronome, expressive, countIn, cursor, playing};

  const startAt = useCallback((from, withCountIn = false) => {
    const s = live.current;
    player.play(s.view, from, {tempoF: s.tempoF, mix: s.mix, metronome: s.metronome, expressive: s.expressive, countIn: withCountIn});
    setPlaying(true);
  }, [player]);
  const pause = useCallback(() => {
    const b = player.stop();
    setPlaying(false);
    if(b !== null) setCursor(clamp(b, 0, live.current.view.total - 1e-6));
  }, [player]);
  const play = useCallback(() => {
    const {cursor: c, view: v, countIn: ci} = live.current;
    startAt(c >= v.total - 1e-6 ? 0 : c, ci);
  }, [startAt]);
  const togglePlay = useCallback(() => live.current.playing ? pause() : play(), [pause, play]);
  const seek = useCallback(b => {
    b = clamp(b, 0, live.current.view.total - 1e-6);
    if(live.current.playing) startAt(b); else setCursor(b);
  }, [startAt]);
  const barStep = useCallback(dir => {
    const {view: v, playing: p, cursor: c} = live.current;
    const b = p ? (player.currentBeat() ?? c) : c;
    const m = measureAt(v, b);
    const target = dir < 0 ? ((b - m.start > .5 || m.idx === 0) ? m.start : v.measures[m.idx-1].start)
      : (m.idx < v.measures.length - 1 ? v.measures[m.idx+1].start : m.start);
    seek(target);
  }, [player, seek]);

  // Changing tempo, key, parts or the metronome while playing carries on from the same spot.
  const firstRun = useRef(true);
  useEffect(() => {
    if(firstRun.current){ firstRun.current = false; return; }
    if(!live.current.playing) return;
    const b = player.currentBeat();
    if(b !== null) startAt(b);
  }, [view, tempoF, mix, metronome, player, startAt]);

  // ---- opening scores
  const openScore = useCallback((text, {id = null, settings = {}, demo = false} = {}) => {
    const {score, warns} = parseScore(text);
    if(!score.measures.length) throw new Error("No bars were found in this score.");
    player.stop(); setPlaying(false); setCursor(0);
    setDoc({src: text, score, warns, id, demo, settings});
    setTranspose(settings.transpose || 0);
    setTempoF(settings.tempoF || 1);
    setMix(defaultMix(score, settings.mix));
    setMyPart(settings.myPart && score.parts.some(p => p.id === settings.myPart) ? settings.myPart : firstVocal(score));
    setHiddenLines(new Set());
    setSel(null); history.current = {past: [], future: []}; setHistVer(v => v + 1);
    return warns;
  }, [player]);

  // ---- editing: every change goes through the text notation, so the text editor, saving and
  //      undo all see exactly the same score
  const docRef = useRef(doc); docRef.current = doc;
  const replaceText = useCallback((text, {record = true} = {}) => {
    const {score, warns} = parseScore(text);
    if(record){ history.current.past.push(docRef.current.src); if(history.current.past.length > 200) history.current.past.shift(); history.current.future = []; setHistVer(v => v + 1); }
    setDoc(d => ({...d, src: text, score, warns, demo: false}));
    setMix(m => { const next = {...m}; score.parts.forEach(p => { if(!next[p.id]) next[p.id] = {on: true, vol: .8, inst: "piano"}; }); return next; });
  }, []);
  const edit = useCallback((fn, keepSel = true) => {
    const sc = E.clone(docRef.current.score);
    const res = fn(sc);
    replaceText(serializeScore(sc));
    if(res && "sel" in res) setSel(res.sel); else if(!keepSel) setSel(null);
  }, [replaceText]);
  const undo = useCallback(() => {
    const h = history.current; if(!h.past.length) return;
    h.future.push(docRef.current.src); replaceText(h.past.pop(), {record: false}); setHistVer(v => v + 1);
  }, [replaceText]);
  const redo = useCallback(() => {
    const h = history.current; if(!h.future.length) return;
    h.past.push(docRef.current.src); replaceText(h.future.pop(), {record: false}); setHistVer(v => v + 1);
  }, [replaceText]);

  // Remember the last score and its settings in this browser.
  useEffect(() => {
    if(doc.demo) return;
    try{ localStorage.setItem(LAST_KEY, JSON.stringify({src: doc.src, id: doc.id, settings: {transpose, tempoF, mix, myPart}})); }catch(_){}
  }, [doc, transpose, tempoF, mix, myPart]);

  // Everything the toolbar needs to know about the selected note.
  const selInfo = useMemo(() => {
    if(!editing || !sel) return null;
    const v = E.findEvent(view, sel.addr), o = E.findEvent(doc.score, sel.addr);
    if(!v || !o) return null;
    const part = doc.score.parts.find(p => sel.addr.split("|")[1].startsWith(p.id + "."));
    const voice = v.voice, nominal = v.m.time[0] * 4 / v.m.time[1];
    const used = voice.reduce((s, e) => s + (e.mrest ? nominal : e.beats), 0);
    const fmt = x => { const w = Math.floor(x + 1e-6), f = x - w; const fr = f > .7 ? "¾" : f > .4 ? "½" : f > .2 ? "¼" : f > .05 ? "⅛" : ""; return (w || !fr ? String(w) : "") + fr; };
    const barState = v.m.partial || Math.abs(used - nominal) < 1e-3 ? "ok" : used > nominal ? "long" : "short";
    const barText = barState === "ok" ? `${fmt(used)} of ${fmt(nominal)} beats` : barState === "long"
      ? `${fmt(used)} of ${fmt(nominal)} beats: this bar is too long. Shorten a note or delete one.`
      : `${fmt(used)} of ${fmt(nominal)} beats: this bar is short. Lengthen a note or add one.`;
    const vp = v.e.pitches[sel.pi];
    return {addr: sel.addr, pi: Math.min(sel.pi, Math.max(0, v.e.pitches.length - 1)), ve: v.e, oe: o.e, part, vocal: part && part.role === "vocal",
      lyricLines: Math.max(1, part ? part.lyricLines || 0 : 0, o.e.lyrics.length), barNum: v.m.num, barState, barText,
      keyAlt: vp ? E.keyAlt(v.m.key, "CDEFGAB".indexOf(vp.step)) : 0, clef: part ? part.clefs[+sel.addr.split("|")[1].split(".")[1] - 1] : "treble"};
  }, [editing, sel, view, doc.score]);

  const selectStep = useCallback((dir, skipRests = false) => {
    if(!sel) return;
    const order = E.voiceOrder(docRef.current.score, sel.addr);
    let i = order.indexOf(sel.addr);
    do { i += dir; } while(skipRests && i >= 0 && i < order.length && E.findEvent(docRef.current.score, order[i]).e.rest);
    if(i < 0 || i >= order.length) return;
    setSel({addr: order[i], pi: 0});
    const e = E.findEvent(live.current.view, order[i]).e;
    if(!e.rest) player.preview(e.pitches[e.pitches.length - 1].midi);
  }, [sel, player]);

  const ops = useMemo(() => {
    if(!selInfo) return {};
    const {addr, pi, ve, clef} = selInfo, vkey = E.findEvent(view, addr).m.key;
    const interval = iv => edit(sc => { const npi = E.applyInterval(sc, addr, pi, iv); player.preview(ve.pitches[pi].midi + iv.semis); return {sel: {addr, pi: npi}}; });
    return {
      step: n => interval(E.stepMove(ve.pitches[pi], n, vkey)),
      accidental: a => interval(E.accidentalMove(ve.pitches[pi], a, vkey)),
      duration: d => edit(sc => E.setDuration(sc, addr, d)),
      dot: () => edit(sc => E.toggleDot(sc, addr)),
      rest: () => edit(sc => { E.toggleRest(sc, addr, clef); return {sel: {addr, pi: 0}}; }),
      tie: () => edit(sc => E.toggleTie(sc, addr)),
      art: a => edit(sc => E.toggleArt(sc, addr, a)),
      dynamic: d => edit(sc => E.setDynamic(sc, addr, d)),
      lyric: (line, text, advance) => { edit(sc => E.setLyric(sc, addr, line, text)); if(advance) setTimeout(() => selectStep(1, true), 0); },
      insert: () => edit(sc => ({sel: {addr: E.insertAfter(sc, addr), pi: 0}})),
      remove: () => edit(sc => { const a = E.deleteEvent(sc, addr); return {sel: a ? {addr: a, pi: 0} : null}; }),
    };
  }, [selInfo, view, edit, player, selectStep]);

  const movePitch = useCallback((s, steps) => {
    const v = E.findEvent(live.current.view, s.addr); if(!v || v.e.rest) return;
    const iv = E.stepMove(v.e.pitches[s.pi], steps, v.m.key);
    edit(sc => ({sel: {addr: s.addr, pi: E.applyInterval(sc, s.addr, s.pi, iv)}}));
  }, [edit]);
  const selectNote = useCallback(s => setSel(s), []);
  const editingRef = useRef(editing); editingRef.current = editing;
  const toggleEditing = useCallback(() => {
    const on = editingRef.current;
    if(!on && live.current.playing) pause();
    if(on) setSel(null);
    setEditing(!on);
  }, [pause]);

  // ---- settings
  const changeTempo = f => setTempoF(clamp(Math.round(f * 100) / 100, .25, 2));
  const changeKey = T => setTranspose(clamp(T, -12, 12));
  const changeExpressive = v => { setExpressive(v); toast(v ? "Expressive playing on" : "Strict playing: exact rhythm, no pedal"); };
  const lyricLines = Math.max(0, ...doc.score.parts.map(p => p.lyricLines || 0));
  const toggleLine = i => setHiddenLines(prev => {
    const next = new Set(prev);
    if(next.has(i)) next.delete(i); else if(lyricLines - next.size > 1) next.add(i);   // keep at least one line
    return next;
  });

  // ---- keyboard shortcuts
  const keys = useRef(); keys.current = {togglePlay, seek, barStep, tempoF, transpose, metronome, dialog, editing, sel, selInfo, ops, undo, redo, selectStep, toggleEditing, startAt};
  useEffect(() => {
    const onKey = e => {
      if(e.target.closest("textarea, input, select")) return;
      const k = keys.current; if(k.dialog) return;
      if((e.metaKey || e.ctrlKey) && !e.altKey){
        const key = e.key.toLowerCase();
        if(key === "z" && !e.shiftKey){ e.preventDefault(); k.undo(); }
        else if(key === "y" || (key === "z" && e.shiftKey)){ e.preventDefault(); k.redo(); }
        return;
      }
      if(e.altKey) return;
      if(k.editing){
        const o = k.ops, si = k.selInfo, isNote = si && !si.ve.rest;
        const em = {
          ArrowUp: () => isNote && o.step(e.shiftKey ? 7 : 1), ArrowDown: () => isNote && o.step(e.shiftKey ? -7 : -1),
          ArrowLeft: () => k.selectStep(-1), ArrowRight: () => k.selectStep(1),
          Delete: () => si && o.remove(), Backspace: () => si && o.remove(),
          Escape: () => k.sel ? setSel(null) : k.toggleEditing(),
          "#": () => isNote && o.accidental(1), b: () => isNote && o.accidental(-1), n: () => isNote && o.accidental(0),
          3: () => si && o.duration("16"), 4: () => si && o.duration("8"), 5: () => si && o.duration("q"), 6: () => si && o.duration("h"), 7: () => si && o.duration("w"),
          ".": () => si && o.dot(), t: () => isNote && o.tie(), r: () => si && o.rest(), i: () => si && o.insert(), e: () => k.toggleEditing(),
          " ": () => { if(si && !live.current.playing) k.startAt(si.ve.onset); else k.togglePlay(); },
        };
        const fn = em[e.key.length === 1 ? e.key.toLowerCase() : e.key] || (e.key === "#" ? em["#"] : null);
        if(fn){ e.preventDefault(); fn(); return; }
        if(["-", "_", "=", "+", "[", "]", "m"].includes(e.key)) return;   // don't change key/tempo by accident while editing
      }
      if(e.metaKey || e.ctrlKey) return;
      const map = {
        " ": () => k.togglePlay(), Home: () => k.seek(0), ArrowLeft: () => k.barStep(-1), ArrowRight: () => k.barStep(1),
        "[": () => changeTempo(k.tempoF - .05), "]": () => changeTempo(k.tempoF + .05),
        "-": () => changeKey(k.transpose - 1), _: () => changeKey(k.transpose - 1), "=": () => changeKey(k.transpose + 1), "+": () => changeKey(k.transpose + 1),
        m: () => setMetronome(!k.metronome), o: () => setDialog("import"), l: () => setDialog("library"), e: () => k.toggleEditing(), "?": () => setDialog("keys"),
      };
      const fn = map[e.key.length === 1 ? e.key.toLowerCase() : e.key];
      if(fn){ e.preventDefault(); fn(); }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  // On phones the side panel slides in; tap outside to close it.
  useEffect(() => {
    if(!narrow || !railOpen) return;
    const onDown = e => { if(railRef.current && !railRef.current.contains(e.target) && !e.target.closest(".rail-toggle")) setRailOpen(false); };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [narrow, railOpen]);

  const closeDialog = useCallback(() => setDialog(null), []);

  return (
    <div className="app">
      <AppBar title={doc.score.title} composer={doc.score.composer}
        onOpen={() => setDialog("import")} onLibrary={() => setDialog("library")} onEdit={toggleEditing}
        onShortcuts={() => setDialog("keys")} onToggleRail={() => setRailOpen(o => !o)} editing={editing} />
      <div className="work">
        <ScoreView view={view} transpose={transpose} zoom={zoom} lyricsAbove={lyricsAbove} hiddenLines={hiddenLines}
          clock={clock} playing={playing} cursor={cursor} follow={follow} mix={mix} tempoF={tempoF} onSeek={seek}
          isDemo={doc.demo} warnCount={doc.warns.length} onReview={() => setDialog("text")} soundState={soundState}
          editing={editing} selection={selInfo ? {addr: selInfo.addr, pi: selInfo.pi} : null} onSelect={selectNote} onMovePitch={movePitch}
          onPreview={m => player.preview(m)}
          toolbar={<EditToolbar sel={selInfo} ops={ops} canUndo={history.current.past.length > 0} canRedo={history.current.future.length > 0}
            onUndo={undo} onRedo={redo} onDone={toggleEditing} onText={() => setDialog("text")} />} />
        <Sidebar parts={doc.score.parts} mix={mix} onMix={setMix} myPart={myPart} onMyPart={setMyPart}
          expressive={expressive} onExpressive={changeExpressive} countIn={countIn} onCountIn={setCountIn}
          metronome={metronome} onMetronome={setMetronome} follow={follow} onFollow={setFollow}
          lyricsAbove={lyricsAbove} onLyricsAbove={setLyricsAbove} lyricLines={lyricLines} hiddenLines={hiddenLines} onToggleLine={toggleLine}
          zoom={zoom} onZoom={z => setZoom(clamp(Math.round(z * 10) / 10, .6, 1.8))} hidden={narrow && !railOpen} railRef={railRef} />
      </div>
      <Transport view={view} playing={playing} cursor={cursor} clock={clock} tempoF={tempoF} transpose={transpose}
        metronome={metronome} countIn={countIn} onPlayPause={togglePlay} onStart={() => seek(0)}
        onPrevBar={() => barStep(-1)} onNextBar={() => barStep(1)} onSeek={seek}
        onTempo={changeTempo} onTranspose={changeKey} onMetronome={setMetronome} onCountIn={setCountIn} />

      {dialog === "import" && <ImportDialog sample={claude.sample} onClose={closeDialog} onOpenText={text => {
        const warns = openScore(text);
        setDialog(null);
        toast(warns.length ? `Opened with ${warns.length} thing${warns.length === 1 ? "" : "s"} to check` : "Score opened");
      }} />}
      {dialog === "library" && <LibraryDialog db={claude.db} uid={claude.uid} toast={toast} onClose={closeDialog}
        current={{src: doc.src, id: doc.id, title: doc.score.title, composer: doc.score.composer, bars: doc.score.measures.length, settings: {transpose, tempoF, mix, myPart}}}
        onSaved={id => setDoc(d => ({...d, id, demo: false}))}
        onOpen={d => { try{ openScore(d.text, {id: d.id, settings: d.settings}); setDialog(null); toast(`Opened ${d.title}`); }catch(err){ toast(err.message); } }} />}
      {dialog === "text" && <EditNotesDialog src={doc.src} warns={doc.warns} toast={toast} onClose={closeDialog}
        onApply={text => { const {score} = parseScore(text); if(!score.measures.length) throw new Error("No bars were found in this score."); replaceText(text); }} />}
      {dialog === "keys" && <ShortcutsDialog onClose={closeDialog} />}

      {toastMsg && <div className="toast" role="status">{toastMsg}</div>}
    </div>
  );
}
