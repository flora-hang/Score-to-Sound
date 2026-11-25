import { useEffect, useRef, useState } from "react";
import Modal from "./Modal.jsx";
import { FileIcon } from "./Icons.jsx";
import { SignInForm, GetMoreSongs } from "./AccountDialog.jsx";
import PagePrep from "./PagePrep.jsx";
import { decodeImage, analyse, rotated, cutPages, guessNotation } from "../engine/prep.js";
import { isImageFile, isPdf, isMusicXml, readMusicXmlFile, pdfToPages, MAX_PAGES,
  buildPrompt, headerContext, transcribePage, mergePages, SAMPLE_ERR, STOP_CODES } from "../engine/reader.js";
import { createJob, finishJob, lookupJob, readPageWithServer, readPageFree, fingerprint } from "../api.js";
import { omrPagesToScore } from "../engine/omr.js";

const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;

/**
 * Open a score.
 *  - MusicXML opens straight away, free, everywhere.
 *  - PDFs and photos are read page by page with AI:
 *      "server": through our own server (sign-in, song credits)  — the public app
 *      "claude": through the viewer's own Claude                 — when opened inside Claude
 *      "free":   no AI available here; MusicXML only (unless free reading is on)
 *  - Where the server offers it, pages can also be read free (see worker/omr.js), no sign-in, no songs:
 *      staff notation: the notes of every part, but no lyrics (homr)
 *      简谱 (numbered notation): the melody and the lyrics (omr/jianpu.py)
 *    The page is checked for staves to tell which it is (people can change it), then people choose.
 */
export default function ImportDialog({sample, account, onOpenText, onClose}){
  const mode = account.ai ? "server" : sample ? "claude" : "free";
  const omr = !!(account.config && account.config.omr) && mode !== "claude";   // free note reading on our server
  const [via, setViaState] = useState("ai");     // how these pages are being read: "ai" or "omr"
  const viaRef = useRef("ai");
  const [notation, setNotationState] = useState("staff");   // what the pages look like: "staff" or "jianpu"
  const notationRef = useRef("staff");
  const setNotation = v => { notationRef.current = v; setNotationState(v); };
  const setVia = v => { viaRef.current = v; setViaState(v); };
  const [pages, setPages] = useState([]);          // {n, url, blob, label, status, bars, text, truncated, retryable}
  const [progress, setProgress] = useState(null);  // {reading} | {done} | {note}
  const [error, setError] = useState("");
  const [running, setRunning] = useState(false);
  const [over, setOver] = useState(false);
  const [gate, setGate] = useState(null);          // server mode before reading: {kind: "signin"|"confirm"|"nocredits", songs}
  const [sheets, setSheets] = useState([]);        // photos/screenshots waiting on the "Check your pages" step
  const [prepBusy, setPrepBusy] = useState(false);
  const sheetsRef = useRef([]);
  const setSheetList = list => { sheetsRef.current = list; setSheets(list); };
  const pagesRef = useRef([]), ctl = useRef(null), fileName = useRef(""), hash = useRef(null), job = useRef(null);

  const sync = () => setPages(pagesRef.current.map(p => ({...p})));
  const patch = (i, c) => { Object.assign(pagesRef.current[i], c); sync(); };
  useEffect(() => () => {
    if(ctl.current) ctl.current.abort();
    pagesRef.current.forEach(p => URL.revokeObjectURL(p.url));
    dropSheets(sheetsRef.current);
    if(job.current && !job.current.finished) finishJob(job.current.id).then(r => account.setCredits(r.credits)).catch(() => {});
  }, []);  // eslint-disable-line

  const reset = () => {
    dropSheets(sheetsRef.current); setSheetList([]);
    pagesRef.current.forEach(p => URL.revokeObjectURL(p.url)); pagesRef.current = []; sync();
    setProgress(null); setError(""); setGate(null); job.current = null; hash.current = null; setVia("ai");
  };
  const addPage = ({blob, label}) => { pagesRef.current.push({n: pagesRef.current.length + 1, url: URL.createObjectURL(blob), blob, label, status: "wait"}); sync(); };
  const songsFor = n => Math.ceil(n / (account.config ? account.config.pagesPerSong : 6));

  async function claudeReady(){
    const lim = await sample.limits().catch(() => null);
    if(!lim || !lim.images){ setError("This view can't send page images to Claude. Open the page in Claude, or use a MusicXML file."); return false; }
    return true;
  }

  async function handleFiles(list){
    const files = [...list]; if(!files.length) return;
    reset(); fileName.current = files[0].name;
    try{
      const images = files.every(isImageFile);
      if(!images && files.length > 1){ setError("Choose one PDF or MusicXML file, or several images. Mixing them isn't supported."); return; }
      if(!images && isMusicXml(files[0])){ onOpenText(await readMusicXmlFile(files[0])); return; }
      if(!images && !isPdf(files[0])){ setError("Choose a PDF, images (JPG, PNG, WebP, HEIC…), or a .musicxml, .xml or .mxl file."); return; }
      if(mode === "free" && !omr){ setError("Reading PDFs and photos isn't available in this copy of the app. Open a MusicXML file instead, or use scoretosound.com."); return; }
      if(mode === "claude" && !(await claudeReady())) return;
      setProgress({reading: "Preparing pages…"});
      if(images){
        // Photos and screenshots go to the "Check your pages" step first; reading continues from usePreparedPages().
        const sorted = files.sort((a, b) => a.name.localeCompare(b.name, undefined, {numeric: true, sensitivity: "base"}));
        const failed = [], list = [];
        for(const f of sorted.slice(0, MAX_PAGES)){
          const orig = await decodeImage(f);
          if(!orig || !(orig.width || orig.naturalWidth)){ failed.push(f.name); continue; }
          list.push(await makeSheet(f.name, orig, orig, 0, URL.createObjectURL(f)));
        }
        if(failed.length) setError(`Couldn't open ${failed.join(", ")}. This browser can't read that image type; save it as JPG or PNG and try again.`);
        setProgress(files.length > MAX_PAGES ? {note: `Only the first ${MAX_PAGES} images will be read.`} : null);
        setSheetList(list);
        return;
      }
      const {total, read} = await pdfToPages(files[0], addPage);
      setProgress(total > read ? {note: `Only the first ${read} pages will be read.`} : null);
      hash.current = await fingerprint(files);
      await afterPages();
    }catch(err){ console.error(err); setError(err.message || "This file couldn't be opened."); setProgress(null); }
  }

  const nextId = useRef(1);
  async function makeSheet(name, orig, src, turns, url){
    const {w, h} = {w: src.width || src.naturalWidth, h: src.height || src.naturalHeight};
    const a = analyse(src);
    return {id: nextId.current++, name, orig, src, turns, url, w, h, crop: a.crop, split: a.split, notes: a.notes, warnings: a.warnings, auto: {crop: a.crop, split: a.split}};
  }
  function dropSheets(list){ list.forEach(s => { URL.revokeObjectURL(s.url); if(s.orig && s.orig.close) s.orig.close(); }); }
  const changeSheet = (id, c) => setSheetList(sheetsRef.current.map(s => s.id === id ? {...s, ...c} : s));
  const resetSheet = id => setSheetList(sheetsRef.current.map(s => s.id === id ? {...s, crop: s.auto.crop, split: s.auto.split} : s));
  const removeSheet = id => { const s = sheetsRef.current.find(x => x.id === id); if(s) dropSheets([s]); setSheetList(sheetsRef.current.filter(x => x.id !== id)); };
  async function rotateSheet(id){
    const s = sheetsRef.current.find(x => x.id === id); if(!s || s.turning) return;
    changeSheet(id, {turning: true});
    await new Promise(r => setTimeout(r, 30));   // let "Turning…" show before the heavy work
    const turns = (s.turns + 1) % 4, src = turns ? rotated(s.orig, turns) : s.orig;
    const blob = await new Promise(r => (src.toBlob ? src : rotated(s.orig, 0)).toBlob(r, "image/jpeg", .85));
    URL.revokeObjectURL(s.url);
    const next = await makeSheet(s.name, s.orig, src, turns, URL.createObjectURL(blob));
    setSheetList(sheetsRef.current.map(x => x.id === id ? {...next, id} : x));
  }

  /** "Use these pages": cut the chosen areas out and carry on as if these were the pages chosen. */
  async function usePreparedPages(){
    setPrepBusy(true); setError("");
    try{
      for(const s of sheetsRef.current){
        const blobs = await cutPages(s.src, s.crop, s.split);
        blobs.forEach((blob, k) => { if(pagesRef.current.length < MAX_PAGES) addPage({blob, label: blobs.length > 1 ? `${s.name} (${k ? "right" : "left"})` : s.name}); });
      }
      dropSheets(sheetsRef.current); setSheetList([]);
      // The fingerprint is of the pages as prepared, so a different crop counts as a different reading.
      hash.current = await fingerprint(pagesRef.current.map((p, i) => new File([p.blob], String(i).padStart(3, "0"))));
      await afterPages();
    }catch(err){ console.error(err); setError(err.message || "These images couldn't be prepared."); }
    finally{ setPrepBusy(false); }
  }

  /** Pages are ready: read straight away (inside Claude), offer free or AI reading, or say what AI costs. */
  async function afterPages(){
    if(!pagesRef.current.length) return;
    if(mode === "claude"){ await run(); return; }
    if(omr){
      // Most of the pages decide (only the first three are looked at; that's plenty).
      const looks = await Promise.all(pagesRef.current.slice(0, 3).map(p => guessNotation(p.blob).catch(() => "staff")));
      setNotation(looks.filter(v => v === "jianpu").length * 2 > looks.length ? "jianpu" : "staff");
      setGate({kind: "choose", songs: songsFor(pagesRef.current.length), ai: mode === "server"});
      return;
    }
    await gateAI();
  }

  /** Free reading: notes only, no sign-in. */
  async function startFree(){ setGate(null); setError(""); setVia("omr"); await run(); }

  /** Read the same pages again with AI, e.g. after free reading, to get the lyrics too. */
  async function switchToAI(){
    pagesRef.current.forEach(p => { p.status = "wait"; p.xml = p.text = p.jianpu = undefined; p.bars = 0; });
    sync(); setProgress(null); setError(""); setVia("ai");
    await gateAI();
  }

  /** AI reading: sign in, then say what it costs (or that this score was read before). */
  async function gateAI(){
    setVia("ai");
    try{
      const songs = songsFor(pagesRef.current.length);
      const now = await account.whenReady();
      if(now.status === "offline" && !now.user){ setError("Couldn't reach the server to check your account. Check your connection and try again."); return; }
      if(!now.user){ setGate({kind: "signin", songs}); return; }
      const look = await lookupJob(hash.current, pagesRef.current.length).catch(() => null);
      setGate({kind: "confirm", songs, free: !!(look && look.readBefore)});
    }catch(err){ console.error(err); setError(err.message || "This file couldn't be opened."); setProgress(null); }
  }

  /** Server mode: charge (or reuse an earlier reading of the same file), then read. */
  async function startServerReading(){
    setGate(null); setError("");
    try{
      const r = await createJob(hash.current, fileName.current, pagesRef.current.length);
      job.current = {id: r.jobId, finished: false};
      account.setCredits(r.credits);
      for(const p of r.pages || []){
        const i = p.page - 1; if(!pagesRef.current[i]) continue;
        if(p.status === "done") patch(i, {status: "done", text: p.text, bars: (p.text.match(/^M\b/gm) || []).length});
        else if(p.status === "nomusic") patch(i, {status: "skip"});
      }
      if(r.reused) setProgress({note: "You've read this score before, so this one is free."});
      await run();
    }catch(err){
      if(err.code === "no_credits") setGate({kind: "nocredits", songs: err.needed, have: err.have});
      else if(err.code === "signed_out"){ account.refresh(); setGate({kind: "signin", songs: songsFor(pagesRef.current.length)}); }
      else setError(err.message || "Couldn't start reading. Please try again.");
    }
  }

  /** For 简谱: what the pages before this one said (key, time) and where its bar numbers start. */
  function jianpuHints(i){
    const before = pagesRef.current.slice(0, i).filter(p => p.status === "done" && p.jianpu);
    if(!before.length) return null;
    const last = before[before.length - 1].jianpu;
    return {key: last.key, time: last.time, bar: before.reduce((s, p) => s + p.bars, 0) + 1};
  }

  async function readOneFree(i){
    const pg = pagesRef.current[i], total = pagesRef.current.length, jianpu = notationRef.current === "jianpu";
    ctl.current = new AbortController();
    patch(i, {status: "run"});
    const first = !pagesRef.current.some(p => p.status === "done" || p.status === "skip");
    setProgress({reading: `Reading the ${jianpu ? "notes and lyrics" : "notes"} on page ${pg.n} of ${total}. About ${jianpu ? 20 : 25} seconds a page${first ? "; the first can take a minute while the reader starts" : ""}.`});
    try{
      if(jianpu){
        const text = await readPageFree(pg.blob, {signal: ctl.current.signal, kind: "jianpu", hints: jianpuHints(i)});
        const bars = (text.match(/^M\b/gm) || []).length;
        const m = text.match(/^# jianpu 1=([A-G][#b]?) (\d+\/\d+)/m);
        patch(i, bars ? {status: "done", text, bars, jianpu: m ? {key: m[1], time: m[2]} : {}} : {status: "skip"});
        return;
      }
      const xml = await readPageFree(pg.blob, {signal: ctl.current.signal});
      const firstPart = xml.split(/<part\s+id=/)[1] || "";
      const bars = (firstPart.match(/<measure\b/g) || []).length;
      patch(i, bars ? {status: "done", xml, bars} : {status: "skip"});
    }catch(err){
      if(err && err.code === "cancelled"){ patch(i, {status: "stopped"}); setProgress({note: "Stopped."}); return "stop"; }
      if(err && err.code === "unreadable"){ patch(i, {status: "skip"}); return; }
      patch(i, {status: "err", retryable: err.retryable !== false});
      setError(err.message || "Reading this page failed.");
      if(["rate_limited", "omr_off"].includes(err.code)) return "stop";
    }
  }

  async function readOne(i){
    if(viaRef.current === "omr") return readOneFree(i);
    const pg = pagesRef.current[i], total = pagesRef.current.length;
    ctl.current = new AbortController();
    patch(i, {status: "run"});
    setProgress({reading: `Reading page ${pg.n} of ${total}. This takes about a minute per page.`});
    const onBars = k => setProgress({reading: `Reading page ${pg.n} of ${total} · ${plural(k, "bar")} so far`});
    try{
      let r;
      if(mode === "server") r = await readPageWithServer(job.current.id, pg.n, pg.blob, {signal: ctl.current.signal, onBars});
      else {
        const done = pagesRef.current.filter(p => p.status === "done").map(p => p.text);
        const t = await transcribePage(sample, pg.blob, buildPrompt(pg.n, total, headerContext(done)), {signal: ctl.current.signal, onBars});
        r = t.noMusic ? {status: "nomusic"} : {status: "done", ...t};
      }
      if(r.status === "nomusic") patch(i, {status: "skip"});
      else patch(i, {status: "done", text: r.text, bars: r.bars, truncated: r.truncated});
    }catch(err){
      if(err && err.code === "cancelled"){ patch(i, {status: "stopped"}); setProgress({note: "Stopped."}); return "stop"; }
      const retryable = mode === "server" ? err.retryable !== false : true;
      patch(i, {status: "err", retryable});
      setError(mode === "server" ? (err.message || "Reading this page failed.") : (SAMPLE_ERR[err && err.code] || "Reading this page failed. Press Retry to try again."));
      if(mode === "server" ? ["rate_limited", "signed_out", "closed", "ai_unavailable"].includes(err.code) : STOP_CODES.includes(err && err.code)) return "stop";
    }
  }

  async function run(){
    setRunning(true);
    setError(e => e.startsWith("Couldn't open") ? e : "");
    for(let i=0;i<pagesRef.current.length;i++){
      if(["done", "skip"].includes(pagesRef.current[i].status)) continue;
      if(pagesRef.current[i].status === "err" && pagesRef.current[i].retryable === false) continue;
      if(await readOne(i) === "stop") break;
    }
    ctl.current = null; setRunning(false);
    const bars = pagesRef.current.filter(p => p.status === "done").reduce((s, p) => s + p.bars, 0);
    if(bars) setProgress({done: bars, free: viaRef.current === "omr", jianpu: notationRef.current === "jianpu"});
    else if(viaRef.current === "omr" && pagesRef.current.every(p => p.status === "skip")) setError("The free reader couldn't find music on these pages. Try straighter, sharper photos, or read them with AI.");
    // Close the reading on the server. If nothing could be read, the song comes back.
    if(mode === "server" && job.current && pagesRef.current.every(p => p.status !== "wait" && p.status !== "stopped")){
      try{
        const r = await finishJob(job.current.id);
        job.current.finished = true;
        account.setCredits(r.credits);
        if(r.refunded) setProgress({note: `Nothing could be read from this score, so your ${r.refunded === 1 ? "song was" : "songs were"} given back.`});
      }catch(_){}
    }
  }
  const stop = () => { if(ctl.current) ctl.current.abort(); };

  function open(){
    const done = pagesRef.current.filter(p => p.status === "done");
    if(!done.length) return;
    try{
      if(viaRef.current === "omr" && notationRef.current === "jianpu") onOpenText(mergePages(done.map(p => p.text), fileName.current));
      else if(viaRef.current === "omr") onOpenText(omrPagesToScore(done.map(p => p.xml), fileName.current).text);
      else onOpenText(mergePages(done.map(p => p.text), fileName.current));
    }
    catch(err){ setError(err.message); }
  }

  const doneCount = pages.filter(p => p.status === "done").length;
  const status = p => ({
    wait: ["", `Page ${p.n} · waiting`], run: ["run", `Page ${p.n} · reading`], skip: ["", `Page ${p.n} · no music`],
    stopped: ["", `Page ${p.n} · stopped`], err: ["err", `Page ${p.n} · failed`],
    done: ["ok", `Page ${p.n} · ${plural(p.bars, "bar")}${p.truncated ? " (cut short)" : ""}`],
  })[p.status];
  const credits = account.credits ? account.credits.total : 0;

  return (
    <Modal title="Open a score" onClose={running ? stop : onClose} footer={<>
      {running && <button className="btn" onClick={stop}>Stop reading</button>}
      <button className="btn" onClick={onClose}>Cancel</button>
      <button className="btn primary" disabled={running || !doneCount} onClick={open}>Open score</button>
    </>}>
      <label className={`drop${over ? " over" : ""}`} htmlFor="fileIn"
        onDragEnter={e => { e.preventDefault(); setOver(true); }} onDragOver={e => { e.preventDefault(); setOver(true); }}
        onDragLeave={e => { e.preventDefault(); setOver(false); }}
        onDrop={e => { e.preventDefault(); setOver(false); if(!running) handleFiles(e.dataTransfer.files); }}>
        <FileIcon />
        <b>{mode === "free" && !omr ? "Drop a MusicXML file here, or " : "Drop a PDF or photos of the score here, or "}<u>choose files</u></b>
        <p>{mode === "free" && !omr ? "MusicXML from MuseScore, Finale, Sibelius or Dorico opens exactly as written."
          : mode === "free" ? "Staff notation or 简谱, read for free. MusicXML files open exactly as written."
          : omr ? "Staff notation or 简谱 (numbered notation). Read it free, or with AI."
          : "Staff notation or 简谱, with lyrics and choir parts. AI reads each page and writes out the notes."}</p>
        <input type="file" id="fileIn" multiple className="sr" disabled={running}
          accept=".pdf,.musicxml,.xml,.mxl,application/pdf,image/*,.jpg,.jpeg,.png,.webp,.gif,.bmp,.heic,.heif,.tif,.tiff,.avif"
          onChange={e => { handleFiles(e.target.files); e.target.value = ""; }} />
      </label>

      {(mode !== "free" || omr) && !pages.length && !sheets.length && (
        <ul className="tips" aria-label="Tips for photos">
          <li><b>One page per photo,</b> flat and well lit, with the whole page in the frame.</li>
          <li><b>Screenshots:</b> zoom in so the notes are big. You can trim off the player next.</li>
          <li><b>PDFs</b> work best of all.</li>
        </ul>
      )}

      {sheets.length > 0 && !pages.length && (
        <PagePrep sheets={sheets} busy={prepBusy} onChange={changeSheet} onRotate={rotateSheet} onRemove={removeSheet}
          onReset={resetSheet} onDone={usePreparedPages} songsFor={mode === "server" ? songsFor : null} />
      )}

      {mode === "server" && !pages.length && !sheets.length && (
        <div className="ai-banner">
          <b>AI reading</b>
          <span>{account.user ? `You have ${plural(credits, "song")} to read with AI.` : `Sign in and your first ${account.config.trialSongs === 1 ? "song is" : plural(account.config.trialSongs, "song") + " are"} free.`}</span>
        </div>
      )}

      {pages.length > 0 && (
        <div className="pages">
          {pages.map(p => { const [cls, text] = status(p); return (
            <div className="pg" key={p.n} title={p.label}>
              <img src={p.url} alt={`Page ${p.n}`} />
              <div className={`st ${cls}`}>
                <span>{text}</span>
                {p.status === "run" && <span className="spin" />}
                {p.status === "err" && !running && p.retryable !== false && <button onClick={run}>Retry</button>}
              </div>
            </div>); })}
        </div>
      )}

      {gate && gate.kind === "choose" && (
        <div className="gate choose">
          <p className="kind-line">
            {notation === "jianpu" ? <>These pages look like <b>简谱</b> (numbered notation).</> : <>These pages look like <b>staff notation</b>.</>}
            {" "}<button className="linkish" onClick={() => setNotation(notation === "jianpu" ? "staff" : "jianpu")}>
              {notation === "jianpu" ? "It's staff notation" : "It's 简谱 (numbered notation)"}</button>
          </p>
          {notation === "jianpu" ? (
            <div className="choice">
              <b>Read free</b>
              <span>The melody <b>and lyrics</b>, with repeat signs, 1st/2nd endings and claps (X). About 20 seconds a page, no sign-in needed.</span>
              <button className="btn primary" onClick={startFree}>Read free</button>
            </div>
          ) : (
            <div className="choice">
              <b>Read the notes free</b>
              <span>Notes and rhythms of every part. <b>No lyrics.</b> About 25 seconds a page, no sign-in needed.</span>
              <button className="btn primary" onClick={startFree}>Read notes free</button>
            </div>
          )}
          {gate.ai && (
            <div className="choice">
              <b>Read with AI · {plural(gate.songs, "song")}</b>
              <span>{notation === "jianpu" ? "Melody and lyrics, the most accurate, and it reads D.C., D.S. and Fine too." : <>Notes <b>and lyrics</b>, the most accurate.</>} {account.user ? `You have ${plural(credits, "song")}.` : `Your first ${account.config.trialSongs === 1 ? "song is" : plural(account.config.trialSongs, "song") + " are"} free.`}</span>
              <button className="btn" onClick={gateAI}>Read with AI</button>
            </div>
          )}
        </div>
      )}
      {gate && gate.kind === "signin" && (
        <div className="gate">
          <SignInForm config={account.config} intro={`Sign in to read these ${plural(pages.length, "page")} with AI. Your first ${account.config.trialSongs === 1 ? "song is" : plural(account.config.trialSongs, "song") + " are"} free. After signing in, open this score again.`} />
        </div>
      )}
      {gate && gate.kind === "confirm" && (
        <div className="gate confirm">
          {gate.free
            ? <div><b>Read with AI: free</b><span>You've read this score before, so opening it again doesn't use a song.</span></div>
            : <div><b>Read with AI: {plural(gate.songs, "song")}</b>
                <span>{plural(pages.length, "page")} · you have {plural(credits, "song")}. Opening the same file again later is free, and if nothing can be read you get it back.</span></div>}
          {gate.free || credits >= gate.songs ? <button className="btn primary" onClick={startServerReading}>{gate.free ? "Open with AI" : "Read with AI"}</button>
            : <button className="btn primary" onClick={() => setGate({kind: "nocredits", songs: gate.songs, have: credits})}>Read with AI</button>}
        </div>
      )}
      {gate && gate.kind === "nocredits" && (
        <div className="gate">
          <p><b>You're out of songs.</b> This score needs {plural(gate.songs, "song")} and you have {gate.have ?? credits}.</p>
          <GetMoreSongs account={account} note="After paying you'll come back here. Open this score again to read it." />
        </div>
      )}

      {(progress || error) && (
        <div>
          {progress && (
            <div className="progress">
              {progress.reading && <><span className="spin" />{progress.reading}</>}
              {progress.done !== undefined && !progress.free && <span><b style={{color: "var(--ink)"}}>{plural(progress.done, "bar")} read.</b>&nbsp;Open the score, then use Edit notes if anything looks off.</span>}
              {progress.done !== undefined && progress.free && progress.jianpu && (
                <span><b style={{color: "var(--ink)"}}>{plural(progress.done, "bar")} read, with lyrics.</b>&nbsp;Open the score and check any bars it flags.</span>
              )}
              {progress.done !== undefined && progress.free && !progress.jianpu && (
                <span className="free-done">
                  <span><b style={{color: "var(--ink)"}}>{plural(progress.done, "bar")} read, without lyrics.</b>&nbsp;Open the score and check any bars it flags.</span>
                  {mode === "server" && !running && <span>Want the words too? <button className="linkish" onClick={switchToAI}>Read these pages with AI instead</button></span>}
                </span>
              )}
              {progress.note}
            </div>
          )}
          {error && <div className="err-msg">{error}</div>}
        </div>
      )}

      <div className="notice">{mode === "server" || omr
        ? <>Page images are only used to read the notes: free reading happens on our own servers, and AI reading sends them securely to our AI provider (Anthropic). They aren't kept or shared. <a href="./privacy" target="_blank" rel="noopener">Privacy policy</a></>
        : "Your files stay on this device. Page images are sent to Claude only to read the notes, and nothing is shared with anyone else."}</div>
    </Modal>
  );
}
