/* Talking to our own server (/api). On hosts without the server (e.g. GitHub Pages) getConfig()
   returns null and the app falls back to the free reading route. */
const base = (import.meta.env.VITE_API_BASE || "").replace(/\/$/, "");

async function call(path, {method = "GET", body, headers = {}, signal} = {}){
  const res = await fetch(base + path, {
    method, signal, credentials: "include",
    headers: {"x-requested-with": "fetch", ...(body && !(body instanceof Blob) ? {"content-type": "application/json"} : {}), ...headers},
    body: body instanceof Blob ? body : body ? JSON.stringify(body) : undefined,
  });
  const isJson = (res.headers.get("content-type") || "").includes("application/json");
  const data = isJson ? await res.json() : null;
  if(!res.ok) throw {status: res.status, ...(data && data.error ? data.error : {code: "network", message: "Couldn't reach the server. Check your connection and try again."})};
  return data;
}

export async function getConfig(){
  try{
    const res = await fetch(base + "/api/config", {credentials: "include"});
    if(!res.ok || !(res.headers.get("content-type") || "").includes("application/json")) return null;
    return await res.json();
  }catch(_){ return null; }
}
export const getMe = () => call("/api/me");
export const sendSignInEmail = email => call("/api/auth/email", {method: "POST", body: {email}});
export const signOut = () => call("/api/auth/logout", {method: "POST"});
export const googleSignInUrl = () => base + "/api/auth/google";

export const createJob = (fileHash, fileName, pages) => call("/api/jobs", {method: "POST", body: {fileHash, fileName, pages}});
export const lookupJob = (fileHash, pages) => call(`/api/jobs/lookup?hash=${fileHash}&pages=${pages}`);
export const finishJob = jobId => call(`/api/jobs/${jobId}/finish`, {method: "POST"});

/** Read one page with AI. Streams progress; resolves {status, text, bars, truncated} or throws {code, message, retryable}. */
export async function readPageWithServer(jobId, pageNo, blob, {signal, onBars} = {}){
  let res;
  try{
    res = await fetch(`${base}/api/jobs/${jobId}/pages/${pageNo}`, {method: "POST", body: blob, signal, credentials: "include",
      headers: {"x-requested-with": "fetch", "content-type": blob.type || "image/jpeg"}});
  }catch(err){
    if(err && err.name === "AbortError") throw {code: "cancelled"};
    throw {code: "network", message: "Couldn't reach the server. Check your connection and try again.", retryable: true};
  }
  if(!res.ok){
    const data = (res.headers.get("content-type") || "").includes("application/json") ? await res.json() : null;
    throw {retryable: res.status >= 500 || res.status === 409, ...(data && data.error ? data.error : {code: "server_error", message: "Reading this page failed."})};
  }
  const reader = res.body.getReader(), dec = new TextDecoder();
  let buf = "", text = "", result = null;
  try{
    for(;;){
      const {value, done} = await reader.read();
      if(done) break;
      buf += dec.decode(value, {stream: true});
      let i;
      while((i = buf.indexOf("\n")) >= 0){
        const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
        if(!line) continue;
        const ev = JSON.parse(line);
        if(ev.t === "text"){ text += ev.d; onBars && onBars((text.match(/^M\b/gm) || []).length); }
        else if(ev.t === "done") result = ev;
        else if(ev.t === "error") throw {code: ev.code, message: ev.message, retryable: ev.retryable};
      }
    }
  }catch(err){
    if(err && err.name === "AbortError") throw {code: "cancelled"};
    throw err && err.code ? err : {code: "network", message: "The connection dropped while reading. Press Retry.", retryable: true};
  }
  if(!result) throw {code: "network", message: "The connection dropped while reading. Press Retry.", retryable: true};
  return result;
}

/** Fingerprint of the chosen file(s), so opening the same score again is free. */
export async function fingerprint(files){
  const parts = [];
  for(const f of [...files].sort((a, b) => a.name.localeCompare(b.name))) parts.push(new Uint8Array(await f.arrayBuffer()));
  const all = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let o = 0; for(const p of parts){ all.set(p, o); o += p.length; }
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", all))].map(b => b.toString(16).padStart(2, "0")).join("");
}
