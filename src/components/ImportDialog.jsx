import { useEffect, useRef, useState } from "react";
import Modal from "./Modal.jsx";
import { FileIcon } from "./Icons.jsx";
import { isImageFile, isPdf, isMusicXml, readMusicXmlFile, pdfToPages, imagesToPages, MAX_PAGES,
  buildPrompt, headerContext, transcribePage, mergePages, SAMPLE_ERR, STOP_CODES } from "../engine/reader.js";

const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;

/**
 * Open a score. MusicXML opens straight away; PDFs and photos are shown as page cards and
 * read by Claude one page at a time, with Stop and per-page Retry.
 */
export default function ImportDialog({sample, onOpenText, onClose}){
  const [pages, setPages] = useState([]);          // {n, url, blob, label, status, bars, text, truncated}
  const [progress, setProgress] = useState(null);  // {reading: "..."} | {done: bars} | {note: "..."}
  const [error, setError] = useState("");
  const [running, setRunning] = useState(false);
  const [over, setOver] = useState(false);
  const pagesRef = useRef([]), ctl = useRef(null), fileName = useRef("");

  const sync = () => setPages(pagesRef.current.map(p => ({...p})));
  const patch = (i, c) => { Object.assign(pagesRef.current[i], c); sync(); };
  useEffect(() => () => { if(ctl.current) ctl.current.abort(); pagesRef.current.forEach(p => URL.revokeObjectURL(p.url)); }, []);

  const reset = () => { pagesRef.current.forEach(p => URL.revokeObjectURL(p.url)); pagesRef.current = []; sync(); setProgress(null); setError(""); };
  const addPage = ({blob, label}) => { pagesRef.current.push({n: pagesRef.current.length + 1, url: URL.createObjectURL(blob), blob, label, status: "wait"}); sync(); };

  async function canRead(){
    if(!sample){ setError("Reading pages needs Claude, which isn't available in this view. Open the page in Claude, or use a MusicXML file."); return false; }
    const lim = await sample.limits().catch(() => null);
    if(!lim || !lim.images){ setError("This view can't send page images to Claude. Open the page in Claude, or use a MusicXML file."); return false; }
    return true;
  }

  async function handleFiles(list){
    const files = [...list]; if(!files.length) return;
    reset(); fileName.current = files[0].name;
    try{
      if(files.every(isImageFile)){
        if(!(await canRead())) return;
        const {failed, skipped} = await imagesToPages(files, addPage);
        if(failed.length) setError(`Couldn't open ${failed.join(", ")}. This browser can't read that image type; save it as JPG or PNG and try again.`);
        if(skipped) setProgress({note: `Only the first ${MAX_PAGES} images will be read.`});
        if(pagesRef.current.length) await run();
      } else if(files.length > 1){
        setError("Choose one PDF or MusicXML file, or several images. Mixing them isn't supported.");
      } else if(isMusicXml(files[0])){
        onOpenText(await readMusicXmlFile(files[0]));
      } else if(isPdf(files[0])){
        if(!(await canRead())) return;
        const {total, read} = await pdfToPages(files[0], addPage);
        if(total > read) setProgress({note: `Only the first ${read} pages will be read.`});
        await run();
      } else setError("Choose a PDF, images (JPG, PNG, WebP, HEIC…), or a .musicxml, .xml or .mxl file.");
    }catch(err){ console.error(err); setError(err.message || "This file couldn't be opened."); }
  }

  async function readOne(i){
    const pg = pagesRef.current[i], total = pagesRef.current.length;
    ctl.current = new AbortController();
    patch(i, {status: "run"});
    setProgress({reading: `Claude is reading page ${pg.n} of ${total}. This takes about a minute per page.`});
    const done = pagesRef.current.filter(p => p.status === "done").map(p => p.text);
    try{
      const r = await transcribePage(sample, pg.blob, buildPrompt(pg.n, total, headerContext(done)), {
        signal: ctl.current.signal,
        onBars: k => setProgress({reading: `Reading page ${pg.n} of ${total} · ${plural(k, "bar")} so far`}),
      });
      if(r.noMusic) patch(i, {status: "skip"});
      else patch(i, {status: "done", text: r.text, bars: r.bars, truncated: r.truncated});
    }catch(err){
      if(err && err.code === "cancelled"){ patch(i, {status: "stopped"}); setProgress({note: "Stopped."}); return "stop"; }
      patch(i, {status: "err"});
      setError(SAMPLE_ERR[err && err.code] || "Reading this page failed. Press Retry to try again.");
      if(STOP_CODES.includes(err && err.code)) return "stop";
    }
  }

  async function run(){
    setRunning(true);
    setError(e => e.startsWith("Couldn't open") ? e : "");
    for(let i=0;i<pagesRef.current.length;i++){
      if(["done", "skip"].includes(pagesRef.current[i].status)) continue;
      if(await readOne(i) === "stop") break;
    }
    ctl.current = null; setRunning(false);
    const bars = pagesRef.current.filter(p => p.status === "done").reduce((s, p) => s + p.bars, 0);
    if(bars) setProgress({done: bars});
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
        <b>Drop a PDF or photos of the score here, or <u>choose files</u></b>
        <p>Staff notation or numbered (jianpu) notation. Claude reads each page and writes out the notes, lyrics and markings.</p>
        <input type="file" id="fileIn" multiple className="sr" disabled={running}
          accept=".pdf,.musicxml,.xml,.mxl,application/pdf,image/*,.jpg,.jpeg,.png,.webp,.gif,.bmp,.heic,.heif,.tif,.tiff,.avif"
          onChange={e => { handleFiles(e.target.files); e.target.value = ""; }} />
      </label>
      <div className="formats">
        <div><b>PDF or images</b><span>JPG, PNG, WebP, HEIC and more. Pick several photos for several pages; they're read in file-name order. Check the result with Edit notes.</span></div>
        <div><b>MusicXML (.musicxml, .mxl)</b><span>Exported from MuseScore, Finale, Sibelius or Dorico. Opens exactly as written.</span></div>
      </div>
      {(pages.length > 0 || error || progress) && (
        <div>
          {pages.length > 0 && (
            <div className="pages">
              {pages.map((p, i) => { const [cls, text] = status(p); return (
                <div className="pg" key={p.n} title={p.label}>
                  <img src={p.url} alt={`Page ${p.n}`} />
                  <div className={`st ${cls}`}>
                    <span>{text}</span>
                    {p.status === "run" && <span className="spin" />}
                    {p.status === "err" && !running && <button onClick={run}>Retry</button>}
                  </div>
                </div>); })}
            </div>
          )}
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
      <div className="notice">Your files stay on this device. Page images are sent to Claude only to read the notes, and nothing is shared with anyone else.</div>
    </Modal>
  );
}
