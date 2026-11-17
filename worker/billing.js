/* Payments with Stripe: song packs (pay once) and the monthly plan (subscription).
   People pay on Stripe's own checkout page; card details never touch this server.
   Songs are only added when Stripe tells us, through the signed webhook, that the payment
   went through — never because someone reached the "thank you" page. */
import { json, fail, now, int, readJson } from "./util.js";
import { grant, ledger } from "./credits.js";

const API = "https://api.stripe.com/v1";

export const paymentsOn = env => !!(env.STRIPE_SECRET_KEY && env.STRIPE_WEBHOOK_SECRET && (env.STRIPE_PRICE_PACK || env.STRIPE_PRICE_MONTHLY));
export const testMode = env => (env.STRIPE_SECRET_KEY || "").startsWith("sk_test_");

/** Stripe wants form encoding with brackets for nested values: line_items[0][price]=… */
function form(obj, prefix = "", out = new URLSearchParams()){
  for(const [k, v] of Object.entries(obj)){
    if(v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if(typeof v === "object") form(v, key, out); else out.append(key, String(v));
  }
  return out;
}

async function stripe(env, method, path, params){
  let res, data;
  try{
    res = await fetch(API + path, {method, body: params ? form(params) : undefined,
      headers: {authorization: `Bearer ${env.STRIPE_SECRET_KEY}`, "content-type": "application/x-www-form-urlencoded"}});
    data = await res.json();
  }catch(_){ fail(502, "payment_error", "Couldn't reach the payment service. Please try again in a minute."); }
  if(!res.ok){
    console.error("stripe", method, path, res.status, data && data.error && data.error.message);
    fail(502, "payment_error", "The payment service had a problem. Please try again in a minute.");
  }
  return data;
}

/* ------------------------------------------------------------------ prices */
let priceCache = null;   // prices rarely change; ask Stripe at most every 10 minutes per server instance

/** What the app shows: {pack: {songs, amount, currency}, monthly: {…}}, or null when payments are off. */
export async function prices(env){
  if(!paymentsOn(env)) return null;
  if(priceCache && Date.now() - priceCache.at < 10 * 60e3) return priceCache.data;
  try{
    const get = id => id ? stripe(env, "GET", `/prices/${encodeURIComponent(id)}`) : null;
    const [p, m] = await Promise.all([get(env.STRIPE_PRICE_PACK), get(env.STRIPE_PRICE_MONTHLY)]);
    const data = {
      pack: p ? {songs: int(env.PACK_SONGS, 5), amount: p.unit_amount, currency: p.currency} : null,
      monthly: m ? {songs: int(env.MONTHLY_SONGS, 10), amount: m.unit_amount, currency: m.currency} : null,
      test: testMode(env),
    };
    priceCache = {at: Date.now(), data};
    return data;
  }catch(err){ console.error("prices", err && err.message); return null; }
}

/* --------------------------------------------------------- checkout/portal */
async function customerFor(env, user){
  if(user.stripe_customer_id) return user.stripe_customer_id;
  const c = await stripe(env, "POST", "/customers", {email: user.email, name: user.name || undefined, metadata: {user_id: user.id}});
  await env.DB.prepare("UPDATE users SET stripe_customer_id = ? WHERE id = ? AND stripe_customer_id IS NULL").bind(c.id, user.id).run();
  const row = await env.DB.prepare("SELECT stripe_customer_id FROM users WHERE id = ?").bind(user.id).first();
  return row.stripe_customer_id;   // if two clicks raced, both use the one that was saved first
}

/** POST /api/billing/checkout {kind: "pack"|"monthly"} → {url} of Stripe's payment page. */
export async function checkout(request, env, user){
  if(!paymentsOn(env)) fail(503, "payments_off", "Payments aren't set up yet.");
  const {kind} = await readJson(request);
  const price = kind === "monthly" ? env.STRIPE_PRICE_MONTHLY : kind === "pack" ? env.STRIPE_PRICE_PACK : null;
  if(!price) fail(400, "bad_kind", "Choose a song pack or the monthly plan.");
  if(kind === "monthly" && user.plan === "monthly") fail(409, "already_subscribed", "You're already on the monthly plan. Use “Manage plan” to change or cancel it.");
  const origin = new URL(request.url).origin;
  const session = await stripe(env, "POST", "/checkout/sessions", {
    mode: kind === "monthly" ? "subscription" : "payment",
    customer: await customerFor(env, user),
    client_reference_id: user.id,
    line_items: [{price, quantity: 1}],
    metadata: {user_id: user.id, kind},
    ...(kind === "monthly" ? {subscription_data: {metadata: {user_id: user.id}}} : {payment_intent_data: {metadata: {user_id: user.id, kind}}}),
    allow_promotion_codes: true,
    success_url: `${origin}/?purchase=done`,
    cancel_url: `${origin}/?purchase=cancelled`,
  });
  return json({url: session.url});
}

/** POST /api/billing/portal → {url} of Stripe's page for receipts, card changes and cancelling. */
export async function portal(request, env, user){
  if(!paymentsOn(env)) fail(503, "payments_off", "Payments aren't set up yet.");
  if(!user.stripe_customer_id) fail(400, "no_customer", "There's nothing to manage yet: you haven't bought anything.");
  const s = await stripe(env, "POST", "/billing_portal/sessions", {customer: user.stripe_customer_id, return_url: new URL(request.url).origin + "/"});
  return json({url: s.url});
}

/* ------------------------------------------------------------------ webhook */
const enc = s => new TextEncoder().encode(s);
const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
function sameText(a, b){ if(a.length !== b.length) return false; let d = 0; for(let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; }

/** Check Stripe's signature (HMAC-SHA256 of "timestamp.body") so nobody can fake a payment. */
async function verified(request, env){
  const header = request.headers.get("stripe-signature") || "", body = await request.text();
  let t = null; const sigs = [];
  for(const part of header.split(",")){ const [k, v] = part.split("="); if(k === "t") t = v; else if(k === "v1" && v) sigs.push(v); }
  if(!t || !sigs.length || Math.abs(Date.now() / 1000 - Number(t)) > 300) fail(400, "bad_signature", "Bad signature.");
  const key = await crypto.subtle.importKey("raw", enc(env.STRIPE_WEBHOOK_SECRET), {name: "HMAC", hash: "SHA-256"}, false, ["sign"]);
  const mac = hex(await crypto.subtle.sign("HMAC", key, enc(`${t}.${body}`)));
  if(!sigs.some(s => sameText(s, mac))) fail(400, "bad_signature", "Bad signature.");
  return JSON.parse(body);
}

/** POST /api/stripe/webhook — Stripe calls this after payments, renewals and cancellations. */
export async function webhook(request, env){
  if(!env.STRIPE_WEBHOOK_SECRET) fail(503, "payments_off", "Payments aren't set up yet.");
  const ev = await verified(request, env);
  // Stripe may send the same event more than once; handle each one exactly once.
  const fresh = await env.DB.prepare("INSERT OR IGNORE INTO stripe_events (id, type, created_at) VALUES (?, ?, ?)").bind(ev.id, ev.type, now()).run();
  if(!fresh.meta.changes) return json({received: true, duplicate: true});
  try{ await handle(env, ev); }
  catch(err){
    await env.DB.prepare("DELETE FROM stripe_events WHERE id = ?").bind(ev.id).run();   // so Stripe's retry is handled
    throw err;
  }
  return json({received: true});
}

const userByCustomer = (env, id) => env.DB.prepare("SELECT * FROM users WHERE stripe_customer_id = ?").bind(id).first();

async function endPlan(env, u, ref){
  if(u.plan !== "monthly" && !u.monthly_songs) return;
  await env.DB.prepare("UPDATE users SET plan = NULL, plan_renews_at = NULL, monthly_songs = 0 WHERE id = ?").bind(u.id).run();
  if(u.monthly_songs) await ledger(env, u.id, -u.monthly_songs, "monthly", "plan_ended", ref);
}

async function handle(env, ev){
  const o = ev.data.object;
  switch(ev.type){
    // A song pack was paid for (cards right away; some bank methods a little later).
    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded": {
      if(o.mode !== "payment" || o.payment_status !== "paid") return;    // plans are handled by invoice.paid
      const userId = o.client_reference_id || (o.metadata && o.metadata.user_id);
      if(userId) await grant(env, userId, int(env.PACK_SONGS, 5), "pack", "pack", o.id);
      return;
    }
    // The monthly plan started or renewed: a fresh set of monthly songs (unused ones don't carry over).
    case "invoice.paid": {
      const lines = (o.lines && o.lines.data) || [];
      const isPlan = o.subscription || (o.parent && o.parent.subscription_details) || lines.some(l => l.subscription || (l.parent && l.parent.subscription_item_details));
      if(!isPlan) return;
      const u = await userByCustomer(env, o.customer);
      if(!u) return;
      const songs = int(env.MONTHLY_SONGS, 10);
      const end = Math.max(0, ...lines.map(l => (l.period && l.period.end) || 0)) * 1000 || null;
      await env.DB.prepare("UPDATE users SET plan = 'monthly', plan_renews_at = ?, monthly_songs = ? WHERE id = ?").bind(end, songs, u.id).run();
      await ledger(env, u.id, songs - u.monthly_songs, "monthly", "monthly", o.id);
      return;
    }
    case "customer.subscription.updated": {
      if(!["canceled", "unpaid", "incomplete_expired"].includes(o.status)) return;
      const u = await userByCustomer(env, o.customer);
      if(u) await endPlan(env, u, o.id);
      return;
    }
    case "customer.subscription.deleted": {
      const u = await userByCustomer(env, o.customer);
      if(u) await endPlan(env, u, o.id);
      return;
    }
  }
}
