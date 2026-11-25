/* Getting photos and screenshots ready before they're read with AI. Runs entirely in the browser, free.
   - finds the paper inside a screenshot or photo and trims what's around it (players, adverts, desk)
   - notices two pages side by side and suggests splitting them at the gap
   - warns about photos that are sideways, small or blurry, before any songs are spent
   Everything here is a suggestion: the person sees it on the crop screen and can change it. */

const ANALYSIS_SIDE = 1000;   // analyse a smaller copy; plenty for finding pages and staff lines
const OUT_SIDE = 2000;
const BLUR_LIMIT = 60;          // see sharpness(); crisp print scores well above, a shaky photo well below        // pages sent for reading are at most this big (the AI shrinks larger ones anyway)

/** Decode an image file, upright (phone photos carry their rotation separately). */
export async function decodeImage(file){
  try{ return await createImageBitmap(file, {imageOrientation: "from-image"}); }catch(_){}
  const url = URL.createObjectURL(file);
  try{ return await new Promise((ok, bad) => { const im = new Image(); im.onload = () => ok(im); im.onerror = bad; im.src = url; }); }
  catch(_){ return null; }
  finally{ setTimeout(() => URL.revokeObjectURL(url), 1000); }
}
const sizeOf = src => ({w: src.width || src.naturalWidth, h: src.height || src.naturalHeight});

/** A canvas holding `src` turned by `turns` quarter turns clockwise. */
export function rotated(src, turns){
  const {w, h} = sizeOf(src), t = ((turns % 4) + 4) % 4;
  const c = document.createElement("canvas");
  c.width = t % 2 ? h : w; c.height = t % 2 ? w : h;
  const cx = c.getContext("2d");
  cx.translate(c.width / 2, c.height / 2); cx.rotate(t * Math.PI / 2); cx.drawImage(src, -w / 2, -h / 2);
  return c;
}

function grayOf(src){
  const {w, h} = sizeOf(src), s = Math.min(1, ANALYSIS_SIDE / Math.max(w, h));
  const aw = Math.max(1, Math.round(w * s)), ah = Math.max(1, Math.round(h * s));
  const c = document.createElement("canvas"); c.width = aw; c.height = ah;
  const cx = c.getContext("2d", {willReadFrequently: true});
  cx.fillStyle = "#fff"; cx.fillRect(0, 0, aw, ah); cx.drawImage(src, 0, 0, aw, ah);
  const d = cx.getImageData(0, 0, aw, ah).data, g = new Uint8Array(aw * ah);
  for(let i = 0; i < g.length; i++) g[i] = (d[i * 4] * 299 + d[i * 4 + 1] * 587 + d[i * 4 + 2] * 114) / 1000;
  return {g, aw, ah, s};
}

/** Longest run of indexes where pass(i) is true, allowing short interruptions (a dark line, a headline). */
function longestRun(n, pass, gapAllowed){
  let best = [0, -1], start = -1, lastGood = -1;
  for(let i = 0; i <= n; i++){
    const ok = i < n && pass(i);
    if(ok){ if(start < 0 || i - lastGood > gapAllowed + 1) start = i; lastGood = i; if(lastGood - start > best[1] - best[0]) best = [start, lastGood]; }
  }
  return best;
}

/** Find the paper: the biggest bright, roughly rectangular area. Returns a box in analysis pixels. */
function findPaper({g, aw, ah}){
  const sorted = Uint8Array.from(g).sort(), p90 = sorted[Math.floor(sorted.length * .9)];
  const bright = Math.max(150, p90 - 45);
  let x0 = 0, x1 = aw - 1, y0 = 0, y1 = ah - 1;
  for(let pass = 0; pass < 3; pass++){
    const rowFrac = y => { let k = 0; for(let x = x0; x <= x1; x++) if(g[y * aw + x] >= bright) k++; return k / (x1 - x0 + 1); };
    [y0, y1] = longestRun(ah, y => y >= 0 && rowFrac(y) > .6, Math.round(ah * .02));
    if(y1 <= y0) return null;
    const colFrac = x => { let k = 0; for(let y = y0; y <= y1; y++) if(g[y * aw + x] >= bright) k++; return k / (y1 - y0 + 1); };
    [x0, x1] = longestRun(aw, x => colFrac(x) > .6, Math.round(aw * .02));
    if(x1 <= x0) return null;
  }
  return {x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1, bright};
}

/** Where to split a two-page spread: the empty vertical strip nearest the middle, or null. */
function findGutter({g, aw}, box){
  const lo = box.x + Math.round(box.w * .35), hi = box.x + Math.round(box.w * .65), mid = box.x + box.w / 2;
  const inks = [];
  for(let x = lo; x <= hi; x++){ let k = 0; for(let y = box.y; y < box.y + box.h; y++) if(g[y * aw + x] < 110) k++; inks.push(k / box.h); }
  // "empty" means far less ink than a typical column of music here (a page number or a stray line doesn't count)
  const typical = [...inks].sort((p, q) => p - q)[Math.floor(inks.length / 2)];
  const limit = Math.max(.004, typical * .2);
  const minRun = Math.max(3, Math.round(box.w * .008));
  let best = null, start = -1;
  for(let x = lo; x <= hi + 1; x++){
    const empty = x <= hi && inks[x - lo] < limit;
    if(empty && start < 0) start = x;
    if(!empty && start >= 0){
      if(x - start >= minRun){ const c = (start + x - 1) / 2; if(!best || Math.abs(c - mid) < Math.abs(best - mid)) best = c; }
      start = -1;
    }
  }
  return best;
}

/** Staff lines are long dark lines. Count them across and down to tell if a page is sideways. */
function lineCounts({g, aw}, box){
  const dark = v => v < 140;
  let rows = 0, cols = 0;
  for(let y = box.y; y < box.y + box.h; y++){ let k = 0; for(let x = box.x; x < box.x + box.w; x++) if(dark(g[y * aw + x])) k++; if(k / box.w > .45) rows++; }
  for(let x = box.x; x < box.x + box.w; x++){ let k = 0; for(let y = box.y; y < box.y + box.h; y++) if(dark(g[y * aw + x])) k++; if(k / box.h > .45) cols++; }
  return {rows, cols};
}

/** How sharp the page is, at the size it will be read (about 1000 px across a page): high means crisp edges. */
function sharpness(src, crop){
  const s = Math.min(1, 1000 / crop.w), w = Math.max(3, Math.round(crop.w * s)), h = Math.max(3, Math.round(crop.h * s));
  const c = document.createElement("canvas"); c.width = w; c.height = h;
  const cx = c.getContext("2d", {willReadFrequently: true}); cx.drawImage(src, crop.x, crop.y, crop.w, crop.h, 0, 0, w, h);
  const d = cx.getImageData(0, 0, w, h).data, g = i => (d[i * 4] * 299 + d[i * 4 + 1] * 587 + d[i * 4 + 2] * 114) / 1000;
  // Only judge edges where there is ink nearby: the strongest 2% of edge responses.
  const v = [];
  for(let y = 1; y < h - 1; y += 2) for(let x = 1; x < w - 1; x += 2){ const i = y * w + x; v.push(Math.abs(4 * g(i) - g(i - 1) - g(i + 1) - g(i - w) - g(i + w))); }
  v.sort((p, q) => q - p);
  const top = v.slice(0, Math.max(1, Math.floor(v.length * .02)));
  return top.reduce((p, q) => p + q, 0) / top.length;
}

/**
 * Look at one image and suggest how to prepare it.
 * Returns {crop: {x,y,w,h}, split: x|null, notes: [...], warnings: [...]} in the image's own pixels.
 */
export function analyse(src){
  const {w, h} = sizeOf(src), a = grayOf(src), k = 1 / a.s;
  const notes = [], warnings = [];
  let box = findPaper(a);
  const full = {x: 0, y: 0, w: a.aw, h: a.ah};
  if(!box || box.w * box.h < a.aw * a.ah * .15) box = full;                          // nothing paper-like: keep it all
  const trimmed = box !== full && (box.w < a.aw * .94 || box.h < a.ah * .94);
  if(!trimmed) box = full;

  let split = null;
  const aspect = box.w / box.h;
  if(aspect > 1.1){
    const gx = findGutter(a, box);
    if(gx != null){ split = Math.round(gx * k); notes.push("Looks like two pages side by side, so it's split into two"); }
    else if(aspect > 1.25) warnings.push("This is a wide image. If it holds two pages, turn on “Two pages” and move the line to the gap.");
  }

  // No safety margin: a margin would pull in a strip of whatever surrounds the page.
  if(trimmed) notes.unshift("Trimmed away what's around the page");

  const lines = lineCounts(a, box);
  if(lines.cols >= 8 && lines.cols > lines.rows * 3) warnings.push("The page looks sideways. Press Rotate until the music reads left to right.");

  const crop = {x: Math.round(box.x * k), y: Math.round(box.y * k), w: Math.round(box.w * k), h: Math.round(box.h * k)};
  crop.w = Math.min(crop.w, w - crop.x); crop.h = Math.min(crop.h, h - crop.y);
  const pageW = split != null ? Math.min(split - crop.x, crop.x + crop.w - split) : crop.w;
  if(pageW < 700) warnings.push("This page is small, so notes may be misread. A bigger photo or screenshot (zoomed in) reads better.");
  else if(sharpness(src, split != null ? {...crop, w: split - crop.x} : crop) < BLUR_LIMIT) warnings.push("This photo looks blurry. A sharper photo, taken in good light with the phone held steady, reads better.");
  return {crop, split, notes, warnings};
}

/** Cut the prepared page(s) out of an image as JPEG blobs. */
export async function cutPages(src, crop, split){
  const parts = split != null && split > crop.x && split < crop.x + crop.w
    ? [{x: crop.x, y: crop.y, w: split - crop.x, h: crop.h}, {x: split, y: crop.y, w: crop.x + crop.w - split, h: crop.h}]
    : [crop];
  const out = [];
  for(const p of parts){
    const s = Math.min(1, OUT_SIDE / Math.max(p.w, p.h * .78));
    const c = document.createElement("canvas"); c.width = Math.max(1, Math.round(p.w * s)); c.height = Math.max(1, Math.round(p.h * s));
    const cx = c.getContext("2d"); cx.fillStyle = "#fff"; cx.fillRect(0, 0, c.width, c.height);
    cx.drawImage(src, p.x, p.y, p.w, p.h, 0, 0, c.width, c.height);
    out.push(await new Promise(r => c.toBlob(r, "image/jpeg", .9)));
  }
  return out;
}

/**
 * Staff notation or 简谱 (numbered notation)? Staff notation has five-line staves; 简谱 has none.
 * The page is cut into narrow strips (so a tilted photo still has straight-enough lines in each),
 * and each strip is searched for five evenly spaced dark lines. Printed and photographed staff
 * pages show ten or more such staves; 简谱 pages show none. Returns "staff" or "jianpu".
 */
export async function guessNotation(blob){
  let bmp;
  try{ bmp = await createImageBitmap(blob); }catch(_){ return "staff"; }
  const s = Math.min(1, ANALYSIS_SIDE / Math.max(bmp.width, bmp.height));
  const w = Math.max(16, Math.round(bmp.width * s)), h = Math.max(16, Math.round(bmp.height * s));
  const c = document.createElement("canvas"); c.width = w; c.height = h;
  const cx = c.getContext("2d", {willReadFrequently: true});
  cx.fillStyle = "#fff"; cx.fillRect(0, 0, w, h); cx.drawImage(bmp, 0, 0, w, h);
  if(bmp.close) bmp.close();
  const d = cx.getImageData(0, 0, w, h).data, g = new Uint8Array(w * h);
  for(let i = 0; i < w * h; i++) g[i] = (d[i * 4] * 299 + d[i * 4 + 1] * 587 + d[i * 4 + 2] * 114) / 1000;
  const STRIPS = 16, found = [];
  for(let b = 0; b < STRIPS; b++){
    const x0 = Math.floor(b * w / STRIPS), x1 = Math.floor((b + 1) * w / STRIPS), bw = x1 - x0;
    // paper brightness in this strip: the 90th percentile
    const hist = new Uint32Array(256);
    for(let y = 0; y < h; y++) for(let x = x0; x < x1; x++) hist[g[y * w + x]]++;
    let paper = 255, k = 0; const need = bw * h * .1;
    for(let v = 255; v >= 0; v--){ k += hist[v]; if(k >= need){ paper = v; break; } }
    const limit = paper * .85;
    // centres of thin dark rows (lines) in this strip
    const ys = [];
    for(let y = 0; y < h; ){
      const line = yy => { let n = 0; for(let x = x0; x < x1; x++) if(g[yy * w + x] < limit) n++; return n > bw * .5; };
      if(!line(y)){ y++; continue; }
      let e = y; while(e + 1 < h && line(e + 1)) e++;
      if(e - y < 4) ys.push((y + e) / 2);
      y = e + 1;
    }
    let staves = 0;
    for(let i = 0; i + 4 < ys.length; ){
      const gaps = [1, 2, 3, 4].map(j => ys[i + j] - ys[i + j - 1]), lo = Math.min(...gaps), hi = Math.max(...gaps);
      if(lo >= 3 && hi <= 25 && hi <= lo * 1.35){ staves++; i += 5; } else i++;
    }
    found.push(staves);
  }
  found.sort((p, q) => p - q);
  return found[STRIPS - 3] >= 2 ? "staff" : "jianpu";
}
