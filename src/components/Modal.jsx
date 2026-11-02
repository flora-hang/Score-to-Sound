import { useEffect, useRef } from "react";
import { Close } from "./Icons.jsx";

/** Accessible dialog: closes on Escape or backdrop click, moves focus in and back out. */
export default function Modal({title, onClose, footer, width, children}){
  const box = useRef(null);
  useEffect(() => {
    const prev = document.activeElement;
    box.current?.querySelector("button, textarea, input, [tabindex]")?.focus();
    const onKey = e => { if(e.key === "Escape"){ e.stopPropagation(); onClose(); } };
    document.addEventListener("keydown", onKey, true);
    return () => { document.removeEventListener("keydown", onKey, true); try{ prev && prev.focus(); }catch(_){} };
  }, [onClose]);
  const titleId = "dlg-" + title.replace(/\W+/g, "-").toLowerCase();
  return (
    <div className="overlay" onMouseDown={e => { if(e.target === e.currentTarget) onClose(); }}>
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} ref={box} style={width ? {width: `min(${width}px,100%)`} : undefined}>
        <header><h3 id={titleId}>{title}</h3><button className="btn icon-btn ghost" aria-label="Close" onClick={onClose}><Close /></button></header>
        <div className="body">{children}</div>
        {footer && <footer>{footer}</footer>}
      </div>
    </div>
  );
}
