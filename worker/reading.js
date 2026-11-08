/* AI reading of scores, one "job" per uploaded score:
   1. POST /api/jobs                  -> charges songs (or reuses an earlier reading of the same file)
   2. POST /api/jobs/:id/pages/:n     -> reads one page image, streams progress as JSON lines
   3. POST /api/jobs/:id/finish       -> refunds the songs if no page could be read
   The prompt is built here on the server from the pages already read, so the API can only
   ever be used to read sheet music. */
import { json, fail, readJson, rateLimit, int, now } from "./util.js";
import { charge, refund, creditsOf } from "./credits.js";
import { buildPrompt, headerContext, countBars } from "../src/engine/prompt.js";
import { readPageWithClaude } from "./claude.js";

const MAX_ATTEMPTS = 3;          // first reading + 2 free retries per page
const MAX_IMAGE = 6 * 1024 * 1024;

const pagesFor = async (env, jobId) => (await env.DB.prepare("SELECT page, status, text, attempts FROM job_pages WHERE job_id = ? ORDER BY page").bind(jobId).all()).results;
const freshCredits = async (env, id) => creditsOf(await env.DB.prepare("SELECT monthly_songs, pack_songs FROM users WHERE id = ?").bind(id).first());

export async function createJob(request, env, user){
  const {fileHash, fileName, pages} = await readJson(request);
  const maxPages = int(env.MAX_PAGES, 40), n = int(pages, 0);
  if(!/^[a-f0-9]{64}$/.test(String(fileHash || ""))) fail(400, "bad_request", "Missing file fingerprint.");
  if(n < 1 || n > maxPages) fail(400, "too_many_pages", `A score can have up to ${maxPages} pages.`);
  // Reading the same file again never costs another song.
  const prev = await env.DB.prepare("SELECT id, pages FROM jobs WHERE user_id = ? AND file_hash = ? AND status = 'done' ORDER BY created_at DESC LIMIT 1").bind(user.id, fileHash).first();
  if(prev && prev.pages === n){
    return json({jobId: prev.id, reused: true, songsCharged: 0, pages: await pagesFor(env, prev.id), credits: creditsOf(user)});
  }
  const songs = Math.ceil(n / int(env.PAGES_PER_SONG, 6));
  const id = crypto.randomUUID();
  const {fromMonthly, fromPack} = await charge(env, user, songs, id);
  await env.DB.prepare("INSERT INTO jobs (id, user_id, file_hash, file_name, pages, songs_charged, from_monthly, from_pack, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open', ?)")
    .bind(id, user.id, fileHash, String(fileName || "").slice(0, 200), n, songs, fromMonthly, fromPack, now()).run();
  return json({jobId: id, reused: false, songsCharged: songs, pages: [], credits: await freshCredits(env, user.id)});
}

/** Has this person already read this exact file? (Then reading it again is free.) */
export async function lookupJob(request, env, user){
  const q = new URL(request.url).searchParams, hash = q.get("hash") || "", n = int(q.get("pages"), 0);
  if(!/^[a-f0-9]{64}$/.test(hash)) fail(400, "bad_request", "Missing file fingerprint.");
  const prev = await env.DB.prepare("SELECT id FROM jobs WHERE user_id = ? AND file_hash = ? AND status = 'done' AND pages = ? LIMIT 1").bind(user.id, hash, n).first();
  return json({readBefore: !!prev, songs: prev ? 0 : Math.ceil(n / int(env.PAGES_PER_SONG, 6))});
}

function imageType(bytes){
  const b = new Uint8Array(bytes.slice(0, 12));
  if(b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF) return "image/jpeg";
  if(b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47) return "image/png";
  if(b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45) return "image/webp";
  return null;
}

export async function readPage(request, env, ctx, user, jobId, pageNo){
  const job = await env.DB.prepare("SELECT * FROM jobs WHERE id = ? AND user_id = ?").bind(jobId, user.id).first();
  if(!job) fail(404, "not_found", "This reading wasn't found.");
  if(job.status === "refunded") fail(409, "closed", "This reading was cancelled. Open the score again to start over.");
  if(pageNo < 1 || pageNo > job.pages) fail(400, "bad_page", "That page isn't part of this score.");
  const len = +(request.headers.get("content-length") || 0);
  if(len > MAX_IMAGE) fail(413, "too_large", "This page image is too large.");
  const image = await request.arrayBuffer();
  if(image.byteLength > MAX_IMAGE || image.byteLength < 100) fail(413, "too_large", "This page image is too large or empty.");
  const mediaType = imageType(image);
  if(!mediaType) fail(415, "bad_image", "Pages must be JPEG, PNG or WebP images.");

  const existing = await env.DB.prepare("SELECT * FROM job_pages WHERE job_id = ? AND page = ?").bind(jobId, pageNo).first();
  if(existing && (existing.status === "done" || existing.status === "nomusic"))
    return ndjson([{t: "done", status: existing.status, text: existing.text || "", bars: countBars(existing.text || ""), cached: true}]);
  if(existing && existing.status === "reading" && now() - existing.updated_at < 3 * 60e3) fail(409, "busy", "This page is already being read.");
  const attempts = existing ? existing.attempts : 0;
  if(attempts >= MAX_ATTEMPTS) fail(429, "too_many_retries", "This page has been tried several times. Try a clearer scan or photo, or fix it in the editor.");
  if(!await rateLimit(env, "pages:" + user.id, int(env.PAGES_PER_HOUR, 60), 36e5)) fail(429, "rate_limited", "You've read a lot of pages this hour. Please wait a little.");

  const model = attempts === 0 ? env.MODEL_PRIMARY : (env.MODEL_RETRY || env.MODEL_PRIMARY);
  await env.DB.prepare(`INSERT INTO job_pages (job_id, page, attempts, status, updated_at) VALUES (?, ?, 1, 'reading', ?)
    ON CONFLICT(job_id, page) DO UPDATE SET attempts = attempts + 1, status = 'reading', updated_at = excluded.updated_at`).bind(jobId, pageNo, now()).run();
  const earlier = (await env.DB.prepare("SELECT text FROM job_pages WHERE job_id = ? AND page < ? AND status = 'done' ORDER BY page").bind(jobId, pageNo).all()).results.map(r => r.text);
  const prompt = buildPrompt(pageNo, job.pages, headerContext(earlier));

  // Stream JSON lines to the browser; keep working (and save the result) even if it disconnects.
  const {readable, writable} = new TransformStream();
  const writer = writable.getWriter(), enc = new TextEncoder();
  let open = true;
  const send = obj => { if(open) writer.write(enc.encode(JSON.stringify(obj) + "\n")).catch(() => { open = false; }); };
  ctx.waitUntil((async () => {
    send({t: "start", page: pageNo, attempt: attempts + 1});
    let pending = "", last = 0;
    try{
      const r = await readPageWithClaude(env, {model, image, mediaType, prompt, signal: AbortSignal.timeout(5 * 60e3), onActivity: () => {
        // While Claude thinks there's no text yet; a small ping keeps the browser from giving up.
        if(Date.now() - last > 10e3){ send({t: "ping"}); last = Date.now(); }
      }, onText: d => {
        pending += d;
        if(Date.now() - last > 250){ send({t: "text", d: pending}); pending = ""; last = Date.now(); }
      }});
      if(pending) send({t: "text", d: pending});
      const text = r.text.replace(/```[a-z]*\n?/gi, "").trim();
      const noMusic = /^NO MUSIC/i.test(text), bars = countBars(text);
      const status = noMusic ? "nomusic" : bars ? "done" : "error";
      await env.DB.prepare("UPDATE job_pages SET status = ?, text = ?, model = ?, input_tokens = ?, output_tokens = ?, updated_at = ? WHERE job_id = ? AND page = ?")
        .bind(status, noMusic ? "" : text, model, r.inputTokens, r.outputTokens, now(), jobId, pageNo).run();
      if(status === "error"){
        // Keep a note of why, so an empty reading can be explained later (Workers logs + the page row).
        console.error("readPage empty", JSON.stringify({jobId, pageNo, model, stop: r.stop, outputTokens: r.outputTokens, start: text.slice(0, 200)}));
        if(!text) await env.DB.prepare("UPDATE job_pages SET text = ? WHERE job_id = ? AND page = ?").bind(`[no reply; stop_reason=${r.stop || "none"}]`, jobId, pageNo).run();
        if(r.stop === "max_tokens" && !text) send({t: "error", code: "too_long", message: "This image has too much music for one reading. Crop it to one page (or half a page) and try again.", retryable: attempts + 1 < MAX_ATTEMPTS});
        else if(r.stop === "refusal") send({t: "error", code: "declined", message: "The AI declined to read this page. Screenshots that include another app's player or adverts are more likely to be turned down. Try a clean scan or photo of just the page, one page at a time.", retryable: attempts + 1 < MAX_ATTEMPTS});
        else send({t: "error", code: "empty", message: "No music could be read on this page. Press Retry to try again with our most careful reader. If it still fails, crop the photo to one page with nothing around it.", retryable: attempts + 1 < MAX_ATTEMPTS});
      }
      else send({t: "done", status, text: noMusic ? "" : text, bars, truncated: r.truncated});
    }catch(err){
      // A busy or failed service doesn't use up one of the page's tries.
      const e = err && err.code ? err : {code: "upstream_error", message: "Reading this page failed. Please try again.", retryable: true};
      await env.DB.prepare("UPDATE job_pages SET status = 'error', attempts = CASE WHEN ? THEN MAX(attempts - 1, 0) ELSE attempts END, updated_at = ? WHERE job_id = ? AND page = ?")
        .bind(e.retryable ? 1 : 0, now(), jobId, pageNo).run();
      if(!(err && err.code)) console.error("readPage", err);
      send({t: "error", code: e.code, message: e.message, retryable: e.retryable});
    }finally{
      try{ await writer.close(); }catch(_){}
    }
  })());
  return new Response(readable, {headers: {"content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store", "x-accel-buffering": "no"}});
}

function ndjson(lines){
  return new Response(lines.map(l => JSON.stringify(l)).join("\n") + "\n", {headers: {"content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store"}});
}

/** Close a reading. If no page could be read at all, the songs are given back. */
export async function finishJob(request, env, user, jobId){
  const job = await env.DB.prepare("SELECT * FROM jobs WHERE id = ? AND user_id = ?").bind(jobId, user.id).first();
  if(!job) fail(404, "not_found", "This reading wasn't found.");
  if(job.status === "open"){
    const ok = await env.DB.prepare("SELECT COUNT(*) AS n FROM job_pages WHERE job_id = ? AND status = 'done'").bind(jobId).first();
    if(ok.n === 0){
      const r = await env.DB.prepare("UPDATE jobs SET status = 'refunded', finished_at = ? WHERE id = ? AND status = 'open'").bind(now(), jobId).run();
      if(r.meta.changes === 1) await refund(env, user.id, job.from_monthly, job.from_pack, jobId);
    } else {
      await env.DB.prepare("UPDATE jobs SET status = 'done', finished_at = ? WHERE id = ? AND status = 'open'").bind(now(), jobId).run();
    }
  }
  const after = await env.DB.prepare("SELECT status FROM jobs WHERE id = ?").bind(jobId).first();
  return json({status: after.status, refunded: after.status === "refunded" ? job.songs_charged : 0, credits: await freshCredits(env, user.id)});
}
