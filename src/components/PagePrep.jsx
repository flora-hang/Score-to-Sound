import { useRef } from "react";

/* The "Check your pages" step: each photo or screenshot with the crop the app suggests.
   Drag the corners or the box to adjust, drag the dashed line to move a page split. */

const MIN = .06;   // smallest crop, as a share of the image

function CropBox({sheet, onChange}){
  const {w, h, crop, split} = sheet;
  const host = useRef(null);
  const pct = (v, of) => `${(v / of) * 100}%`;

  function clampCrop(c){
    const mw = w * MIN, mh = h * MIN;
    let {x, y, w: cw, h: ch} = c;
    cw = Math.max(mw, Math.min(cw, w)); ch = Math.max(mh, Math.min(ch, h));
    x = Math.max(0, Math.min(x, w - cw)); y = Math.max(0, Math.min(y, h - ch));
    return {x: Math.round(x), y: Math.round(y), w: Math.round(cw), h: Math.round(ch)};
  }
  const clampSplit = (sx, c) => sx == null ? null : Math.round(Math.max(c.x + c.w * .1, Math.min(sx, c.x + c.w * .9)));

  /** Change the crop by dx, dy (image pixels) using handle `kind`. */
  function moveBy(kind, start, dx, dy){
    let {x, y, w: cw, h: ch} = start.crop;
    if(kind === "move"){ x += dx; y += dy; }
    if(kind.includes("w")){ const nx = Math.min(x + cw - w * MIN, Math.max(0, x + dx)); cw += x - nx; x = nx; }
    if(kind.includes("e")) cw = Math.min(w - x, cw + dx);
    if(kind.includes("n")){ const ny = Math.min(y + ch - h * MIN, Math.max(0, y + dy)); ch += y - ny; y = ny; }
    if(kind.includes("s")) ch = Math.min(h - y, ch + dy);
    if(kind === "split") return {split: clampSplit(start.split + dx, start.crop)};
    const c = clampCrop({x, y, w: cw, h: ch});
    const shifted = start.split == null ? null : kind === "move" ? start.split + (c.x - start.crop.x) : start.split;
    return {crop: c, split: clampSplit(shifted, c)};
  }

  function onPointerDown(kind, e){
    e.preventDefault(); e.stopPropagation();
    const rect = host.current.getBoundingClientRect(), sx = e.clientX, sy = e.clientY;
    const start = {crop: {...crop}, split};
    const target = e.currentTarget;
    target.setPointerCapture && target.setPointerCapture(e.pointerId);
    const move = ev => onChange(moveBy(kind, start, (ev.clientX - sx) / rect.width * w, (ev.clientY - sy) / rect.height * h));
    const up = () => { target.removeEventListener("pointermove", move); target.removeEventListener("pointerup", up); target.removeEventListener("pointercancel", up); };
    target.addEventListener("pointermove", move); target.addEventListener("pointerup", up); target.addEventListener("pointercancel", up);
  }
  function onKey(kind, e){
    const step = (e.shiftKey ? .05 : .01), d = {ArrowLeft: [-w * step, 0], ArrowRight: [w * step, 0], ArrowUp: [0, -h * step], ArrowDown: [0, h * step]}[e.key];
    if(!d) return;
    e.preventDefault();
    onChange(moveBy(kind, {crop: {...crop}, split}, d[0], d[1]));
  }
  const handle = (kind, label) => (
    <span className={`ch ch-${kind}`} role="slider" tabIndex={0} aria-label={label}
      onPointerDown={e => onPointerDown(kind, e)} onKeyDown={e => onKey(kind, e)} />
  );

  return (
    <div className="crop" ref={host}>
      <img src={sheet.url} alt={`${sheet.name}`} draggable={false} />
      <div className="crop-box" style={{left: pct(crop.x, w), top: pct(crop.y, h), width: pct(crop.w, w), height: pct(crop.h, h)}}
        onPointerDown={e => onPointerDown("move", e)} onKeyDown={e => onKey("move", e)} tabIndex={0} role="group"
        aria-label="Area to read. Drag to move; use the corners to resize. Arrow keys move it.">
        {split != null && (
          <span className="crop-split" style={{left: pct(split - crop.x, crop.w)}} role="slider" tabIndex={0}
            aria-label="Where the two pages meet. Drag left or right."
            onPointerDown={e => onPointerDown("split", e)} onKeyDown={e => onKey("split", e)}>
            <i>1</i><i>2</i>
          </span>
        )}
        {handle("nw", "Top left corner")}{handle("ne", "Top right corner")}{handle("sw", "Bottom left corner")}{handle("se", "Bottom right corner")}
      </div>
    </div>
  );
}

export default function PagePrep({sheets, onChange, onRotate, onRemove, onReset, onDone, songsFor, busy}){
  const pageCount = sheets.reduce((n, s) => n + (s.split != null ? 2 : 1), 0);
  return (
    <div className="prep">
      <div className="prep-head">
        <b>Check your pages</b>
        <span>We've tidied them so the AI reads more accurately. Drag the box or its corners if anything is cut off or left in.</span>
      </div>
      {sheets.map(s => (
        <div className="prep-sheet" key={s.id}>
          <CropBox sheet={s} onChange={c => onChange(s.id, c)} />
          <div className="prep-side">
            <div className="prep-name" title={s.name}>{s.name}<small>{s.split != null ? "2 pages" : "1 page"}</small></div>
            {s.notes.map(n => <p className="prep-ok" key={n}>✓ {n}</p>)}
            {s.warnings.map(n => <p className="prep-warn" key={n}>{n}</p>)}
            <label className="prep-toggle">
              <input type="checkbox" checked={s.split != null}
                onChange={e => onChange(s.id, {split: e.target.checked ? Math.round(s.crop.x + s.crop.w / 2) : null})} />
              Two pages side by side
            </label>
            <div className="prep-btns">
              <button className="btn" onClick={() => onRotate(s.id)} disabled={s.turning} title="Turn a quarter turn clockwise">{s.turning ? "Turning…" : "Rotate"}</button>
              <button className="btn ghost" onClick={() => onReset(s.id)} title="Go back to the suggested crop">Reset</button>
              <button className="btn ghost" onClick={() => onRemove(s.id)}>Remove</button>
            </div>
          </div>
        </div>
      ))}
      <div className="prep-foot">
        <span>{pageCount} page{pageCount === 1 ? "" : "s"}{songsFor ? ` · ${songsFor(pageCount)} song${songsFor(pageCount) === 1 ? "" : "s"} to read with AI` : ""}</span>
        <button className="btn primary" disabled={busy || !sheets.length} onClick={onDone}>{busy ? "Preparing…" : "Use these pages"}</button>
      </div>
    </div>
  );
}
