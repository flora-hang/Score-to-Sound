/* Small helpers shared by the API routes. */

export const now = () => Date.now();

export function json(data, status = 200, headers = {}){
  return new Response(JSON.stringify(data), {status, headers: {"content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers}});
}
export class ApiError extends Error {
  constructor(status, code, message, extra = {}){ super(message); this.status = status; this.code = code; this.extra = extra; }
}
export const fail = (status, code, message, extra) => { throw new ApiError(status, code, message, extra); };

const b64url = bytes => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
export function randomToken(bytes = 32){ const a = new Uint8Array(bytes); crypto.getRandomValues(a); return b64url(a); }
export async function sha256(input){
  const data = typeof input === "string" ? new TextEncoder().encode(input) : input;
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", data))].map(b => b.toString(16).padStart(2, "0")).join("");
}
export async function sha256b64url(text){ return b64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)))); }

export function cookies(request){
  const out = {};
  (request.headers.get("cookie") || "").split(";").forEach(p => { const i = p.indexOf("="); if(i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim()); });
  return out;
}
export function setCookie(name, value, {maxAge, secure = true} = {}){
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}${maxAge !== undefined ? `; Max-Age=${maxAge}` : ""}`;
}

export async function readJson(request, maxBytes = 16 * 1024){
  const len = +(request.headers.get("content-length") || 0);
  if(len > maxBytes) fail(413, "too_large", "Request is too large.");
  try{ return await request.json(); }catch(_){ fail(400, "bad_json", "Request body must be JSON."); }
}

/** Fixed-window rate limit. Returns true if allowed (and counts this use). */
export async function rateLimit(env, key, limit, windowMs){
  const t = now();
  const row = await env.DB.prepare("SELECT count, window_start FROM rate_limits WHERE key = ?").bind(key).first();
  if(!row || t - row.window_start >= windowMs){
    await env.DB.prepare("INSERT INTO rate_limits (key, count, window_start) VALUES (?, 1, ?) ON CONFLICT(key) DO UPDATE SET count = 1, window_start = excluded.window_start").bind(key, t).run();
    return true;
  }
  if(row.count >= limit) return false;
  await env.DB.prepare("UPDATE rate_limits SET count = count + 1 WHERE key = ?").bind(key).run();
  return true;
}

export const clientIp = request => request.headers.get("cf-connecting-ip") || "local";
export const int = (v, d) => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : d; };
export const isSecure = request => new URL(request.url).protocol === "https:";
