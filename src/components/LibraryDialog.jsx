import { useEffect, useState } from "react";
import Modal from "./Modal.jsx";
import { Save } from "./Icons.jsx";

/** A private list of saved songs (notes + key, tempo and part settings), stored per person. */
export default function LibraryDialog({db, uid, current, onSaved, onOpen, onClose, toast}){
  const [docs, setDocs] = useState(null), [err, setErr] = useState(""), [saving, setSaving] = useState(false), [confirm, setConfirm] = useState(null);
  const enabled = !!(db && uid);

  useEffect(() => {
    if(!enabled) return;
    const t = setTimeout(() => setErr("Your library can't be reached right now."), 10000);
    const unsub = db.collection("data/users/" + uid).onSnapshot(
      snap => { clearTimeout(t); setErr(""); setDocs(snap.docs.map(x => ({id: x.id, ...x.data()}))); },
      () => { clearTimeout(t); setErr("Your library can't be reached right now."); });
    return () => { clearTimeout(t); unsub(); };
  }, [db, uid, enabled]);

  async function save(){
    if(current.src.length > 240000){ toast("This score is too large to save."); return; }
    const id = current.id || ("s" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6));
    setSaving(true);
    try{
      await db.collection("data/users/" + uid).doc(id).set({title: current.title, composer: current.composer || "", text: current.src,
        bars: current.bars, settings: current.settings, savedAt: Date.now()});
      onSaved(id); toast("Saved to your library");
    }catch(e){ toast(e && e.code === "quota_exceeded" ? "Your library is full. Delete a score first." : "Couldn't save. Check you're signed in, then try again."); }
    setSaving(false);
  }
  const remove = async d => {
    if(confirm !== d.id){ setConfirm(d.id); setTimeout(() => setConfirm(c => c === d.id ? null : c), 4000); return; }
    try{ await db.collection("data/users/" + uid).doc(d.id).delete(); toast("Deleted"); }catch(_){ toast("Couldn't delete. Try again."); }
  };
  const describe = d => { const s = d.settings || {};
    return `${d.bars || "?"} bars · ${s.transpose ? (s.transpose > 0 ? "+" : "−") + Math.abs(s.transpose) + " semitones · " : ""}${s.tempoF && s.tempoF !== 1 ? Math.round(s.tempoF*100) + "% tempo · " : ""}saved ${new Date(d.savedAt || Date.now()).toLocaleDateString()}`; };

  let list;
  if(!enabled) list = <div className="notice" style={{marginTop: 4}}>Saving needs you to be signed in to Claude. You can still open and practise scores.</div>;
  else if(err) list = <div className="err-msg">{err}</div>;
  else if(docs === null) list = <div className="progress"><span className="spin" />Loading your library…</div>;
  else if(!docs.length) list = <div className="empty" style={{padding: 24}}>No saved scores yet. Open a score, set the key and tempo you like, then press Save.</div>;
  else list = [...docs].sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0)).map(d => (
    <div className="lib-row" key={d.id}>
      <div className="info"><b>{d.title || "Untitled"}</b><small>{describe(d)}</small></div>
      <button className="btn" onClick={() => onOpen(d)}>Open</button>
      <button className="btn ghost" style={confirm === d.id ? {color: "var(--danger)"} : undefined} onClick={() => remove(d)}>{confirm === d.id ? "Delete for good?" : "Delete"}</button>
    </div>));

  return (
    <Modal title="Your library" onClose={onClose}>
      <div style={{display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap"}}>
        <button className="btn primary" disabled={!enabled || saving} onClick={save}><Save />Save current score</button>
        <span style={{color: "var(--muted)", fontSize: 13}}>Saves the notes plus your key, tempo and part choices.</span>
      </div>
      <div className="lib-list">{list}</div>
      <div className="notice">Your library is private to your Claude account. It keeps the transcribed notes, not the PDF file, and it is never shared.</div>
    </Modal>
  );
}
