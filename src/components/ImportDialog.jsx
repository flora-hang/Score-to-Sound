import { useEffect, useRef, useState } from "react";
import Modal from "./Modal.jsx";
import { FileIcon } from "./Icons.jsx";
import FreeReaderGuide from "./FreeReaderGuide.jsx";
import { SignInForm, GetMoreSongs } from "./AccountDialog.jsx";
import { isImageFile, isPdf, isMusicXml, readMusicXmlFile, pdfToPages, imagesToPages, MAX_PAGES,
  buildPrompt, headerContext, transcribePage, mergePages, SAMPLE_ERR, STOP_CODES } from "../engine/reader.js";
import { createJob, finishJob, lookupJob, readPageWithServer, fingerprint } from "../api.js";

const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;

/**
 * Open a score.
 *  - MusicXML opens straight away, free, everywhere.
 *  - PDFs and photos are read page by page with AI:
 *      "server": through our own server (sign-in, song credits)  — the public app
 *      "claude": through the viewer's own Claude                 — when opened inside Claude
 *      "free":   no AI available here; show the Audiveris route
 */
export default function ImportDialog({sample, account, onOpenText, onClose}){
  const mode = account.ai ? "server" : sample ? "claude" : "free";
  const [pages, setPages] = useState([]);          // {n, url, blob, label, status, bars, text, truncated, retryable}
  const [progress, setProgress] = useState(null);  // {reading} | {done} | {note}
  const [error, setError] = useState("");
  const [running, setRunning] = useState(false);
  const [over, setOver] = useState(false);
  const [gate, setGate] = useState(null);          // server mode before reading: {kind: "signin"|"confirm"|"nocredits", songs}
  const pagesRef = useRef([]), ctl = useRef(null), fileName = useRef(""), hash = useRef(null), job = useRef(null);

  const sync = () => setPages(pagesRef.current.map(p => ({...p})));
  const patch = (i, c) => { Object.assign(pagesRef.current[i], c); sync(); };
  useEffect(() => () => {
    if(ctl.current) ctl.current.abort();
    pagesRef.current.forEach(p => URL.revokeObjectURL(p.url));
    if(job.current && !job.current.finished) finishJob(job.current.id).then(r => account.setCredits(r.credits)).catch(() => {});
  }, []);  // eslint-disable-line

  const reset = () => {
    pagesRef.current.forEach(p => URL.revokeObjectURL(p.url)); pagesRef.current = []; sync();
    setProgress(null); setError(""); setGate(null); job.current = null; hash.current = null;
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
      if(mode === "free"){ setError("Reading PDFs and photos needs AI, which isn't available here. Use the free option below, or open a MusicXML file."); return; }
      if(mode === "claude" && !(await claudeReady())) return;
      setProgress({reading: "Preparing pages…"});
      if(images){
        const {failed, skipped} = await imagesToPages(files, addPage);
        if(failed.length) setError(`Couldn't open ${failed.join(", ")}. This browser can't read that image type; save it as JPG or PNG and try again.`);
        if(skipped) setProgress({note: `Only the first ${MAX_PAGES} images will be read.`}); else setProgress(null);
      } else {
        const {total, read} = await pdfToPages(files[0], addPage);
        setProgress(total > read ? {note: `Only the first ${read} pages will be read.`} : null);
      }
      if(!pagesRef.current.length) return;
      if(mode === "claude"){ await run(); return; }
      // Server mode: say what it costs, then read when the person confirms.
      hash.current = await fingerprint(files);
      const songs = songsFor(pagesRef.current.length);
      if(!account.user){ setGate({kind: "signin", songs}); return; }
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

  async function readOne(i){
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
    if(bars) setProgress({done: bars});
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
    try{ onOpenText(mergePages(done.map(p => p.text), fileName.current)); }
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
        <b>{mode === "free" ? "Drop a MusicXML file here, or " : "Drop a PDF or photos of the score here, or "}<u>choose files</u></b>
        <p>{mode === "free" ? "MusicXML from MuseScore, Finale, Sibelius, Dorico or Audiveris opens exactly as written."
          : "Staff notation or numbered (jianpu) notation, with lyrics and choir parts. AI reads each page and writes out the notes."}</p>
        <input type="file" id="fileIn" multiple className="sr" disabled={running}
          accept=".pdf,.musicxml,.xml,.mxl,application/pdf,image/*,.jpg,.jpeg,.png,.webp,.gif,.bmp,.heic,.heif,.tif,.tiff,.avif"
          onChange={e => { handleFiles(e.target.files); e.target.value = ""; }} />
      </label>

      {mode === "server" && !pages.length && (
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
          <GetMoreSongs config={account.config} />
        </div>
      )}

      {(progress || error) && (
        <div>
          {progress && (
            <div className="progress">
              {progress.reading && <><span className="spin" />{progress.reading}</>}
              {progress.done !== undefined && <span><b style={{color: "var(--ink)"}}>{plural(progress.done, "bar")} read.</b>&nbsp;Open the score, then use Edit notes if anything looks off.</span>}
              {progress.note}
            </div>
          )}
          {error && <div className="err-msg">{error}</div>}
        </div>
      )}

      <FreeReaderGuide open={mode === "free"} />
      <div className="notice">{mode === "server"
        ? <>Page images are sent securely to our AI provider (Anthropic) only to read the notes, and aren't shared with anyone else. <a href="./privacy" target="_blank" rel="noopener">Privacy policy</a></>
        : "Your files stay on this device. Page images are sent to Claude only to read the notes, and nothing is shared with anyone else."}</div>
    </Modal>
  );
}
