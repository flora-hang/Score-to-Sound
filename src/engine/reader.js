/* Turning files into notation.
   - MusicXML (.musicxml/.xml/.mxl) is converted directly.
   - PDFs and photos are rendered to page images and read by Claude (the artifact "sample"
     capability), one page at a time, each page given the context of the pages before it. */
import { parseScore } from "./notation.js";
import { musicXmlToText } from "./musicxml.js";

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

const HEADER = /^(TITLE|COMPOSER|TEMPO|KEY|TIME|PART)\b/i;
/** What earlier pages established (parts, last bar number, key, time, tempo), for the next page's prompt. */
export function headerContext(doneTexts){
  const first = doneTexts.find(t => /^PART\b/m.test(t));
  if(!first) return null;
  const hdr = first.split(/\r?\n/).filter(l => HEADER.test(l.trim())).join("\n");
  const all = doneTexts.join("\n").split(/\r?\n/).filter(l => !HEADER.test(l.trim())).join("\n");
  const {score} = parseScore(hdr + "\n" + all);
  const lm = score.measures[score.measures.length-1];
  return {hdr, next: lm ? lm.num + 1 : 1, key: lm ? `${lm.key} ${lm.mode}` : "", time: lm ? lm.time.join("/") : "", tempo: lm ? lm.tempo : ""};
}

export function buildPrompt(n, total, ctx){
  let p = `You are an expert music engraver. The image is page ${n} of ${total} of a piece of sheet music. It may be standard staff notation or numbered musical notation (jianpu, where "1=D" names the tonic, dots above/below change octave, underlines halve the duration, dashes extend it and a dot after a number dots it). It may be a scan or a phone photo: ignore perspective, shadows, page edges and anything that is not part of the music. Transcribe this page into the text notation below so it can be played back and re-engraved. Reply with ONLY the notation: no commentary, no code fences.\n\n`;
  p += `NOTATION\n`;
  if(!ctx) p += `Start with header lines (only on the first page that has music):\nTITLE: <title>\nCOMPOSER: <composer / lyricist line, or blank>\nTEMPO: <quarter-note BPM> <tempo word if printed>\nKEY: <number of sharps as positive or flats as negative, -7..7> <major|minor>\nTIME: <beats>/<beat type>\nPART <id> | <name> | <vocal|accompaniment|instrument> | <clef per staff: treble, bass, alto, tenor, or treble8 for a treble clef with an 8 below>\n  Use ids P1, P2, ... top to bottom. A piano gets ONE part with two clefs (e.g. "treble bass"). Mark singers' lines (staves with lyrics, Voice, Soprano, Melody, choir voices) as vocal.\n  EVERY STAFF MATTERS: before writing anything, count the staves in one system and name each one (solo voice, choir voices, piano right and left hand, other instruments). Every staff must appear in your output; never drop or merge a staff because it repeats a rhythm or shares lyrics.\n  CHOIR (SATB, SAB, SSA, TTBB...): give each voice its OWN part, so a singer can practise their line alone, even when two voices share one staff (stems up = upper voice, stems down = lower voice). Example: PART P2 | Soprano | vocal | treble, PART P3 | Alto | vocal | treble, PART P4 | Tenor | vocal | treble8, PART P5 | Bass | vocal | bass. If the lyrics are printed only once between staves, copy them to every voice that sings them. Where two voices share one note (a unison), write the note in both parts.\n\n`;
  else p += `Earlier pages already set up the score. Do NOT repeat TITLE/COMPOSER/TEMPO/KEY/TIME/PART lines. Use these same part ids:\n${ctx.hdr}\nAt the end of the previous page the key was ${ctx.key}, time ${ctx.time}, tempo ${ctx.tempo}. Number this page's first bar ${ctx.next}.\n\n`;
  p += `Then every bar, in order:\nM <bar number> [| time=3/4] [| key=-2 minor] [| tempo=72 "Andante"] [| pickup] [| rit] [| text="dolce"]\n  Add an option only where the score changes or prints it. "pickup" marks an incomplete first or last bar. "rit" marks a ritardando/rallentando bar.\n<part id>.<staff number>: <voice> [// <second voice on the same staff>]\n  e.g. "P1.1: ...", piano right hand "P2.1: ...", left hand "P2.2: ...". Give every staff a line in every bar.\n\nEVENTS (space separated)\n- Note: letter, accidental (# b ## bb n), octave (middle C = C4), colon, duration: C4:q  F#5:8  Bb3:h.\n- Write the SOUNDING pitch with the key signature and the bar's accidentals applied (in F major a printed B is Bb4).\n- Chord: C4+E4+G4:h\n- Durations: w h q 8 16 32; "." dotted, ".." double dotted; triplet add t3 (8t3), quintuplet t5.\n- Rest: r:q. A whole-bar rest: R\n- Marks right after the duration, no spaces: ~ tie to next note, ( slur starts, ) slur ends, !st staccato, !ss staccatissimo, !ac accent, !ma marcato, !te tenuto, !fe fermata, @pp @p @mp @mf @f @ff @sfz dynamic, !cr crescendo hairpin starts, !dim diminuendo hairpin starts, !he hairpin ends, "lyric" the syllable sung on this note, keeping a trailing hyphen on split words (e.g. "glo-").\n- LYRICS: keep EVERY lyric line printed under (or over) the staff: all verses and every language or translation. Give one quoted string per line in the order they are stacked, top line first, e.g. G4:q"Love""爱" or D4:q"1.A-""2.\'Twas". Copy the text exactly in its own script. If a line has no syllable on a note but a later line does, write "" for it (e.g. E4:q"""雪"). Never drop a line because it repeats a rhythm or is in another language.\n- Each voice must add up to the bar's length, except pickup bars.\n- Grace notes, chord symbols, fingering, pedalling and page numbers: leave out. Repeats: transcribe the bars once, as printed.\n- If the page has no music (a cover or text page), reply exactly: NO MUSIC\n\nEXAMPLE\n`;
  if(!ctx) p += `TITLE: Amazing Grace\nCOMPOSER: John Newton\nTEMPO: 84 Gently\nKEY: 1 major\nTIME: 3/4\nPART P1 | Voice | vocal | treble\nPART P2 | Piano | accompaniment | treble bass\n`;
  p += `M 0 | pickup\nP1.1: D4:q@mf"A-""\'Twas"\nP2.1: r:q\nP2.2: r:q\nM 1\nP1.1: G4:h"maz-""grace" B4:8"ing""that"( G4:8)\nP2.1: r:q@mp D4+G4+B4:q D4+G4+B4:q\nP2.2: G2+D3:h.\n\nNow transcribe page ${n}. Include every staff and every voice. Be exact about pitches, rhythms, ties and every line of lyrics.`;
  return p;
}

export const SAMPLE_ERR = {
  not_granted: "Claude isn't allowed to read pages for this app. Reload the page and choose Allow when asked.",
  sampling_disabled: "Claude isn't available for this account here.",
  rate_limited: "You've reached a usage limit. Wait a little, then press Retry on the page.",
  session_expired: "Your Claude session expired. Sign in again, then retry.",
  image_rejected: "This page image couldn't be used. Try a clearer PDF.",
  refused: "Claude couldn't read this page.",
  empty_completion: "Claude returned nothing for this page.",
  images_unavailable: "This view can't send page images to Claude.",
};
export const STOP_CODES = ["not_granted","sampling_disabled","images_unavailable","session_expired","rate_limited"];
export const countBars = t => (t.match(/^M\b/gm) || []).length;

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
