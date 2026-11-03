/* Turning files into notation.
   - MusicXML (.musicxml/.xml/.mxl) is converted directly.
   - PDFs and photos are rendered to page images and read by Claude (the artifact "sample"
     capability), one page at a time, each page given the context of the pages before it. */
import { HEADER, countBars } from "./prompt.js";
import { musicXmlToText } from "./musicxml.js";
export { buildPrompt, headerContext, SAMPLE_ERR, STOP_CODES, countBars } from "./prompt.js";

// PDF.js and JSZip are large and only needed when a file is opened, so they load on demand.
async function loadPdfJs(){
  const [pdfjsLib, worker] = await Promise.all([import("pdfjs-dist"), import("pdfjs-dist/build/pdf.worker.min.js?url")]);
  pdfjsLib.GlobalWorkerOptions.workerSrc = worker.default;
  return pdfjsLib;
}
export const MAX_PAGES = 40;
const IMG_EXT = /\.(jpe?g|png|webp|gif|bmp|heic|heif|tiff?|avif)$/i;
export const isImageFile = f => (f.type || "").startsWith("image/") || IMG_EXT.test(f.name);
export const isPdf = f => f.name.toLowerCase().endsWith(".pdf") || f.type === "application/pdf";
export const isMusicXml = f => /\.(mxl|musicxml|xml)$/i.test(f.name);

export async function readMusicXmlFile(file){
  if(/\.mxl$/i.test(file.name)){
    const {default: JSZip} = await import("jszip");
    const zip = await JSZip.loadAsync(file);
    let path = null;
    const cont = zip.file("META-INF/container.xml");
    if(cont){ const x = new DOMParser().parseFromString(await cont.async("string"), "application/xml"); const rf = x.querySelector("rootfile"); path = rf && rf.getAttribute("full-path"); }
    if(!path) path = Object.keys(zip.files).find(p => /\.(xml|musicxml)$/i.test(p) && !p.startsWith("META-INF"));
    if(!path) throw new Error("This .mxl file has no score inside.");
    return musicXmlToText(await zip.file(path).async("string"));
  }
  return musicXmlToText(await file.text());
}

const canvasToJpeg = c => new Promise(r => c.toBlob(r, "image/jpeg", .9));

/** Render each PDF page to a JPEG blob. */
export async function pdfToPages(file, onPage){
  const pdfjsLib = await loadPdfJs();
  const pdf = await pdfjsLib.getDocument({data: await file.arrayBuffer()}).promise;
  const N = Math.min(pdf.numPages, MAX_PAGES);
  for(let i=1;i<=N;i++){
    const page = await pdf.getPage(i);
    const vp0 = page.getViewport({scale:1});
    const vp = page.getViewport({scale: Math.min(2.6, 1700 / vp0.width)});
    const c = document.createElement("canvas"); c.width = Math.round(vp.width); c.height = Math.round(vp.height);
    const cx = c.getContext("2d"); cx.fillStyle = "#fff"; cx.fillRect(0,0,c.width,c.height);
    await page.render({canvasContext: cx, viewport: vp}).promise;
    onPage({blob: await canvasToJpeg(c), label: `${file.name} p.${i}`});
  }
  return {total: pdf.numPages, read: N};
}

async function decodeImage(file){
  try{ return await createImageBitmap(file, {imageOrientation:"from-image"}); }catch(_){}
  const url = URL.createObjectURL(file);
  try{ return await new Promise((ok, bad) => { const im = new Image(); im.onload = () => ok(im); im.onerror = bad; im.src = url; }); }
  catch(_){ return null; }
  finally{ setTimeout(() => URL.revokeObjectURL(url), 1000); }
}

/** Photos/scans -> upright JPEG blobs, sorted by file name with numbers in order (2 before 10). */
export async function imagesToPages(files, onPage){
  const sorted = [...files].sort((a,b) => a.name.localeCompare(b.name, undefined, {numeric:true, sensitivity:"base"}));
  const failed = [];
  for(const f of sorted.slice(0, MAX_PAGES)){
    const bmp = await decodeImage(f);
    const w = bmp && (bmp.width || bmp.naturalWidth), h = bmp && (bmp.height || bmp.naturalHeight);
    if(!bmp || !w || !h){ failed.push(f.name); continue; }
    const scale = Math.min(1, 2000 / Math.max(w, h * .78));
    const c = document.createElement("canvas"); c.width = Math.round(w*scale); c.height = Math.round(h*scale);
    const cx = c.getContext("2d"); cx.fillStyle = "#fff"; cx.fillRect(0,0,c.width,c.height);
    cx.drawImage(bmp, 0, 0, c.width, c.height);
    if(bmp.close) bmp.close();
    onPage({blob: await canvasToJpeg(c), label: f.name});
  }
  return {failed, skipped: Math.max(0, files.length - MAX_PAGES)};
}


/** Ask Claude to read one page. Resolves {text, bars, truncated} or {noMusic:true}; rejects with the sample error. */
export async function transcribePage(sample, blob, prompt, {signal, onBars}){
  const res = await sample(prompt, {images:[blob], modelTier:"complex", signal, onText: ({text}) => onBars && onBars(countBars(text))});
  const text = res.text.replace(/```[a-z]*\n?/gi, "").trim();
  if(/^NO MUSIC/i.test(text)) return {noMusic: true};
  const bars = countBars(text);
  if(!bars) throw {code: "empty_completion"};
  return {text, bars, truncated: res.truncated};
}

/** Join the pages: one header (title, parts...) then every page's bars in order. */
export function mergePages(texts, fileName){
  const head = [], body = [];
  texts.forEach(t => t.split(/\r?\n/).forEach(l => {
    if(HEADER.test(l.trim())){ if(!head.some(h => h.split(/[:|]/)[0].trim() === l.split(/[:|]/)[0].trim() && !/^PART/i.test(l)) && !head.includes(l.trim())) head.push(l.trim()); }
    else body.push(l);
  }));
  let text = head.join("\n") + "\n" + body.join("\n");
  if(!/^TITLE:/m.test(text) && fileName) text = `TITLE: ${fileName.replace(/\.[a-z0-9]+$/i, "")}\n` + text;
  return text;
}
