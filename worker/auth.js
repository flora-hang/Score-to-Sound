/* Sign-in: email links (no passwords) and Google. Sessions are random tokens in an HttpOnly
   cookie; only their SHA-256 is stored, so a database leak doesn't expose live sessions. */
import { now, json, fail, randomToken, sha256, sha256b64url, cookies, setCookie, readJson, rateLimit, clientIp, int, isSecure } from "./util.js";
import { grant } from "./credits.js";

const SESSION_COOKIE = "pa_session";
const SESSION_DAYS = 30;
const LINK_MINUTES = 20;
const DAY = 864e5;

/* ---------------------------------------------------------------- sessions */
export async function getUser(request, env){
  const token = cookies(request)[SESSION_COOKIE];
  if(!token) return null;
  return await env.DB.prepare("SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ?")
    .bind(await sha256(token), now()).first();
}
export async function requireUser(request, env){
  const u = await getUser(request, env);
  if(!u) fail(401, "signed_out", "Please sign in first.");
  return u;
}
async function startSession(env, request, userId, location){
  const token = randomToken();
  await env.DB.prepare("INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)")
    .bind(await sha256(token), userId, now(), now() + SESSION_DAYS * DAY).run();
  return new Response(null, {status: 303, headers: {location, "set-cookie": setCookie(SESSION_COOKIE, token, {maxAge: SESSION_DAYS * 86400, secure: isSecure(request)})}});
}
export async function logout(request, env){
  const token = cookies(request)[SESSION_COOKIE];
  if(token) await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(await sha256(token)).run();
  return json({ok: true}, 200, {"set-cookie": setCookie(SESSION_COOKIE, "", {maxAge: 0, secure: isSecure(request)})});
}

/* ---------------------------------------------------------------- users + free trial */
const cleanEmail = e => String(e || "").trim().toLowerCase();
const validEmail = e => /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/.test(e) && e.length <= 254;
/** The address with +tags removed (and Gmail dots), so one inbox gets one free trial. */
function trialKey(email){
  let [local, domain] = email.split("@");
  local = local.split("+")[0];
  if(domain === "gmail.com" || domain === "googlemail.com"){ local = local.replace(/\./g, ""); domain = "gmail.com"; }
  return `${local}@${domain}`;
}

async function findOrCreateUser(env, request, {email, name = null, googleSub = null}){
  let u = googleSub ? await env.DB.prepare("SELECT * FROM users WHERE google_sub = ?").bind(googleSub).first() : null;
  if(!u) u = await env.DB.prepare("SELECT * FROM users WHERE email = ?").bind(email).first();
  if(u){
    if(googleSub && !u.google_sub) await env.DB.prepare("UPDATE users SET google_sub = ?, name = COALESCE(name, ?) WHERE id = ?").bind(googleSub, name, u.id).run();
    return u;
  }
  const id = crypto.randomUUID();
  await env.DB.prepare("INSERT INTO users (id, email, name, google_sub, created_at) VALUES (?, ?, ?, ?, ?)").bind(id, email, name, googleSub, now()).run();
  // Free trial: once per inbox, and a few per network per day to slow down abuse.
  const trial = int(env.TRIAL_SONGS, 1), key = trialKey(email);
  const claimed = await env.DB.prepare("SELECT 1 FROM trial_claims WHERE email = ?").bind(key).first();
  if(trial > 0 && !claimed && await rateLimit(env, "trial:" + clientIp(request), int(env.TRIALS_PER_NETWORK_PER_DAY, 20), DAY)){
    await env.DB.prepare("INSERT INTO trial_claims (email, claimed_at) VALUES (?, ?)").bind(key, now()).run();
    await grant(env, id, trial, "pack", "trial");
  }
  return env.DB.prepare("SELECT * FROM users WHERE id = ?").bind(id).first();
}

/* ---------------------------------------------------------------- email link */
export async function sendEmailLink(request, env){
  const {email: raw} = await readJson(request);
  const email = cleanEmail(raw);
  if(!validEmail(email)) fail(400, "bad_email", "Please enter a valid email address.");
  const perHour = int(env.EMAILS_PER_HOUR, 5);
  if(!await rateLimit(env, "email:" + email, perHour, 36e5) || !await rateLimit(env, "emailip:" + clientIp(request), perHour * 4, 36e5))
    fail(429, "rate_limited", "Too many sign-in emails. Please wait a while and try again.");
  const token = randomToken();
  await env.DB.prepare("INSERT INTO login_links (token_hash, email, expires_at) VALUES (?, ?, ?)").bind(await sha256(token), email, now() + LINK_MINUTES * 6e4).run();
  const link = `${new URL(request.url).origin}/api/auth/email/verify?token=${token}`;
  const app = env.APP_NAME || "Personal Accompanist";
  if(env.RESEND_API_KEY){
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {authorization: `Bearer ${env.RESEND_API_KEY}`, "content-type": "application/json"},
      body: JSON.stringify({
        from: env.EMAIL_FROM, to: [email], subject: `Sign in to ${app}`,
        text: `Sign in to ${app}:\n\n${link}\n\nThis link works once and expires in ${LINK_MINUTES} minutes. If you didn't ask for it, you can ignore this email.`,
        html: `<div style="font-family:system-ui,sans-serif;max-width:480px;margin:auto;padding:24px;color:#171A21">
          <h2 style="font-weight:600;margin:0 0 12px">Sign in to ${app}</h2>
          <p>Press the button to sign in. It works once and expires in ${LINK_MINUTES} minutes.</p>
          <p style="margin:24px 0"><a href="${link}" style="background:#2A4FC4;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:600">Sign in</a></p>
          <p style="color:#5A6272;font-size:13px">If you didn't ask for this email, you can ignore it.</p></div>`,
      }),
    });
    if(!r.ok){ console.error("resend", r.status, await r.text()); fail(502, "email_failed", "We couldn't send the email. Please try again in a minute."); }
    return json({sent: true});
  }
  if(env.DEV_MODE === "1"){ console.log("Sign-in link for", email, link); return json({sent: true, devLink: link}); }
  fail(503, "email_unavailable", "Email sign-in isn't set up yet.");
}

/* Email apps often open links to scan them, which would use up a one-time link. So the link
   opens a page with a button, and only pressing the button (a POST) signs you in. */
export async function emailLinkPage(request, env){
  const token = new URL(request.url).searchParams.get("token") || "";
  const app = env.APP_NAME || "Personal Accompanist";
  const esc = s => s.replace(/[&<>"]/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;"}[c]));
  return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sign in · ${esc(app)}</title>
<style>body{font-family:system-ui,sans-serif;background:#EDEFF3;color:#171A21;display:grid;place-items:center;min-height:100vh;margin:0;padding:16px}
main{background:#fff;border:1px solid #D5D9E1;border-radius:14px;padding:28px;max-width:380px;width:100%;text-align:center}
h1{font-size:22px;margin:0 0 8px}p{color:#5A6272;margin:0 0 20px}button{background:#2A4FC4;color:#fff;border:0;border-radius:8px;padding:12px 22px;font:600 15px system-ui;cursor:pointer;width:100%}
@media (prefers-color-scheme:dark){body{background:#11141A;color:#E6E9EF}main{background:#191D25;border-color:#2D333F}p{color:#9AA3B3}button{background:#7D9BFF;color:#0C1222}}</style></head>
<body><main><h1>Sign in to ${esc(app)}</h1><p>Press the button to finish signing in on this device.</p>
<form method="post" action="/api/auth/email/verify"><input type="hidden" name="token" value="${esc(token)}"><button type="submit" autofocus>Sign in</button></form></main></body></html>`,
    {headers: {"content-type": "text/html; charset=utf-8", "cache-control": "no-store", "referrer-policy": "no-referrer"}});
}
export async function verifyEmailLink(request, env){
  const form = await request.formData().catch(() => null);
  const token = form && form.get("token");
  if(!token) return Response.redirect(new URL("/?signin_error=link", request.url).toString(), 303);
  const row = await env.DB.prepare("SELECT * FROM login_links WHERE token_hash = ?").bind(await sha256(String(token))).first();
  if(!row || row.used || row.expires_at < now()) return Response.redirect(new URL("/?signin_error=expired", request.url).toString(), 303);
  await env.DB.prepare("UPDATE login_links SET used = 1 WHERE token_hash = ?").bind(row.token_hash).run();
  const user = await findOrCreateUser(env, request, {email: row.email});
  return startSession(env, request, user.id, "/?signedin=1");
}

/* ---------------------------------------------------------------- Google (OAuth 2 + PKCE) */
const redirectUri = request => `${new URL(request.url).origin}/api/auth/google/callback`;
export async function googleStart(request, env){
  if(!env.GOOGLE_CLIENT_ID) fail(503, "google_unavailable", "Google sign-in isn't set up yet.");
  const state = randomToken(24), verifier = randomToken(48);
  await env.DB.prepare("INSERT INTO oauth_states (state, verifier, expires_at) VALUES (?, ?, ?)").bind(state, verifier, now() + 6e5).run();
  const p = new URLSearchParams({client_id: env.GOOGLE_CLIENT_ID, redirect_uri: redirectUri(request), response_type: "code", scope: "openid email profile",
    state, code_challenge: await sha256b64url(verifier), code_challenge_method: "S256", prompt: "select_account"});
  return Response.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${p}`, 302);
}
export async function googleCallback(request, env){
  const url = new URL(request.url), home = path => Response.redirect(new URL(path, request.url).toString(), 303);
  const state = url.searchParams.get("state"), code = url.searchParams.get("code");
  if(!state || !code) return home("/?signin_error=google");
  const row = await env.DB.prepare("SELECT * FROM oauth_states WHERE state = ?").bind(state).first();
  await env.DB.prepare("DELETE FROM oauth_states WHERE state = ? OR expires_at < ?").bind(state, now()).run();
  if(!row || row.expires_at < now()) return home("/?signin_error=expired");
  const tokenRes = await fetch(env.GOOGLE_TOKEN_URL || "https://oauth2.googleapis.com/token", {method: "POST", headers: {"content-type": "application/x-www-form-urlencoded"},
    body: new URLSearchParams({code, client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET, redirect_uri: redirectUri(request), grant_type: "authorization_code", code_verifier: row.verifier})});
  if(!tokenRes.ok){ console.error("google token", tokenRes.status, await tokenRes.text()); return home("/?signin_error=google"); }
  const {access_token} = await tokenRes.json();
  const infoRes = await fetch(env.GOOGLE_USERINFO_URL || "https://openidconnect.googleapis.com/v1/userinfo", {headers: {authorization: `Bearer ${access_token}`}});
  const info = infoRes.ok ? await infoRes.json() : null;
  if(!info || !info.sub || !info.email || info.email_verified === false) return home("/?signin_error=google");
  const user = await findOrCreateUser(env, request, {email: cleanEmail(info.email), name: info.name || null, googleSub: String(info.sub)});
  return startSession(env, request, user.id, "/?signedin=1");
}
