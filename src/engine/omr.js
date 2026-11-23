/* Turning the free reader's pages (MusicXML from homr, one file per page) into one score.

   homr names parts per page ("Voice", "Voice", "Piano"…), and a page can show fewer parts than
   the next (a solo verse, then the choir joins). So pages are lined up by role and order: the
   first voice on every page is the same part, the second voice too, and so on; likewise for piano.
   A part missing from a page rests there. Two things homr gets wrong are corrected:
   - it ignores the small "8" under a tenor's treble clef, so tenor notes come out an octave high;
   - it can't read lyrics (nothing to fix, but the app says so).
   Bars whose length doesn't add up are left for the app's usual "things to check". */
import { musicXmlToText } from "./musicxml.js";
import { parseScore, serializeScore } from "./notation.js";

const WHOLE_BAR_REST = parseScore("TIME: 4/4\nPART P1 | V | vocal | treble\nM 1\nP1.1: R\n").score.measures[0].staves["P1.1"][0][0];

const lower = (e, by) => ({...e, pitches: e.pitches.map(p => ({...p, oct: p.oct - by / 12, midi: p.midi - by}))});

/** Each page as a parsed score, plus which of its parts are voices and which are piano. */
function readPage(xml){
  const {score} = parseScore(musicXmlToText(xml));
  const voices = score.parts.filter(p => p.role !== "accompaniment");
  const piano = score.parts.filter(p => p.role === "accompaniment");
  // A treble-clef voice sitting right above a bass-clef voice, in a choir of three or more, is a tenor.
  const tenors = new Set();
  if(voices.length >= 3) voices.forEach((p, i) => {
    const below = voices[i + 1];
    if(below && p.clefs[0] === "treble" && below.clefs[0] === "bass") tenors.add(p.id);
  });
  return {score, voices, piano, tenors};
}

/**
 * xmls: MusicXML text of each page, in page order. Returns {text, warnings} for the app to open.
 */
export function omrPagesToScore(xmls, fileName){
  const pages = xmls.map(readPage).filter(p => p.score.measures.length);
  if(!pages.length) throw new Error("No music could be found on these pages.");
  const nVoices = Math.max(...pages.map(p => p.voices.length));
  const nPiano = Math.max(...pages.map(p => p.piano.length));
  // The page with the most voices names them best (it shows the whole choir).
  const fullest = pages.reduce((a, b) => b.voices.length > a.voices.length ? b : a);
  const tenorSlot = fullest.voices.findIndex(p => fullest.tenors.has(p.id));

  const parts = [];
  for(let i = 0; i < nVoices; i++){
    const src = fullest.voices[i];
    const clefs = i === tenorSlot ? ["treble8"] : src.clefs.slice();
    const name = nVoices === 1 ? "Voice" : nVoices === 4 && tenorSlot === 2 ? ["Soprano", "Alto", "Tenor", "Bass"][i] : `Voice ${i + 1}`;
    parts.push({...src, id: `P${i + 1}`, name, role: "vocal", clefs, lyricLines: 0});
  }
  for(let i = 0; i < nPiano; i++){
    const src = pages.find(p => p.piano[i]).piano[i];
    parts.push({...src, id: `P${nVoices + i + 1}`, name: nPiano === 1 ? "Piano" : `Piano ${i + 1}`, role: "accompaniment", lyricLines: 0});
  }

  const measures = [];
  for(const page of pages){
    // which merged part each of this page's parts becomes
    const map = new Map();
    page.voices.forEach((p, i) => map.set(p.id, {to: parts[i], tenor: page.tenors.has(p.id)}));
    page.piano.forEach((p, i) => map.set(p.id, {to: parts[nVoices + i], tenor: false}));
    for(const m of page.score.measures){
      const staves = {};
      for(const [key, voices] of Object.entries(m.staves)){
        const [pid, staff] = key.split(".");
        const t = map.get(pid);
        if(!t) continue;
        staves[`${t.to.id}.${staff}`] = t.tenor ? voices.map(v => v.map(e => e.rest ? e : lower(e, 12))) : voices;
      }
      for(const p of parts) p.clefs.forEach((_, s) => { const k = `${p.id}.${s + 1}`; if(!staves[k]) staves[k] = [[{...WHOLE_BAR_REST}]]; });
      // keep the parts' order in the text
      const ordered = {};
      for(const p of parts) p.clefs.forEach((_, s) => { const k = `${p.id}.${s + 1}`; ordered[k] = staves[k]; });
      measures.push({...m, num: measures.length + 1, staves: ordered});
    }
  }

  const first = pages[0].score;
  const title = (first.title && first.title !== "Untitled score" ? first.title : "") || (fileName || "Untitled score").replace(/\.[a-z0-9]+$/i, "");
  const merged = {...first, title, composer: first.composer || "", parts, measures};
  const text = serializeScore(merged);
  const {warns} = parseScore(text);
  return {text, warnings: warns, tenorFixed: tenorSlot >= 0, pages: pages.length};
}
