/* Free note reading (optical music recognition), running in a Cloudflare Container.
   Staff notation: homr reads the notes (not lyrics) and returns MusicXML.
   Numbered notation (简谱 / jianpu): our own reader (omr/jianpu.py) reads the melody and the
   lyrics and returns the app's text notation. Reading with AI stays the other option.
   The container is defined in omr/ (Dockerfile + server.py) and in wrangler.toml. */
import { Container, getRandom } from "@cloudflare/containers";
import { fail, int, rateLimit, clientIp } from "./util.js";

const MAX_BYTES = 15 * 1024 * 1024;

export class OmrReader extends Container {
  defaultPort = 8080;
  sleepAfter = "3m";        // stay warm between the pages of one score, then stop (and stop costing)
  enableInternet = false;   // everything homr needs is inside the image
}

/** Pass on only the hints the 简谱 reader understands (the key, time and first bar from earlier pages). */
function jianpuQuery(request){
  const q = new URL(request.url).searchParams, out = new URLSearchParams();
  const key = q.get("key") || "", time = q.get("time") || "", bar = q.get("bar") || "";
  if(/^[A-G][#b]?$/.test(key)) out.set("key", key);
  if(/^\d{1,2}\/\d{1,2}$/.test(time)) out.set("time", time);
  if(/^\d{1,4}$/.test(bar)) out.set("bar", bar);
  const s = out.toString();
  return s ? "?" + s : "";
}

export const omrOn = env => !!env.OMR && env.OMR_ENABLED !== "0";

/** POST /api/omr/page — body: one page image (JPEG/PNG). Reply: MusicXML, or a JSON error.
    POST /api/omr/jianpu — the same for a 简谱 page. Reply: the app's text notation. */
export async function readPageFree(request, env, kind = "staff"){
  const jianpu = kind === "jianpu";
  if(!omrOn(env)) fail(503, "omr_off", "Free note reading isn't available right now.");
  // Free, but each page costs us a little computing: a generous limit per connection stops abuse.
  if(!await rateLimit(env, "omr:" + clientIp(request), int(env.OMR_PAGES_PER_HOUR, 60), 36e5))
    fail(429, "rate_limited", "That's a lot of pages in a short time. Please wait a while and try again.");
  const type = (request.headers.get("content-type") || "").toLowerCase();
  if(!/^image\/(jpeg|png)/.test(type)) fail(415, "bad_type", "Send each page as a JPEG or PNG image.");
  const body = await request.arrayBuffer();
  if(!body.byteLength || body.byteLength > MAX_BYTES) fail(413, "too_big", "Each page image must be under 15 MB.");

  let res;
  try{
    const reader = await getRandom(env.OMR, int(env.OMR_INSTANCES, 3));
    res = await reader.fetch(new Request(jianpu ? "http://omr/read-jianpu" + jianpuQuery(request) : "http://omr/read", {method: "POST", body, headers: {"content-type": type}}));
  }catch(err){
    console.error("omr", err && err.message);
    fail(503, "omr_busy", "The free reader is starting up or busy. Please try again in a minute.", {retryable: true});
  }
  if(res.ok) return new Response(res.body, {headers: {"cache-control": "no-store",
    "content-type": jianpu ? "text/plain; charset=utf-8" : "application/vnd.recordare.musicxml+xml; charset=utf-8"}});
  if(res.status === 422) fail(422, "unreadable", "No music could be found on this page. Try a straighter, sharper photo of one page, or read it with AI.");
  if(res.status === 503) fail(503, "omr_busy", "The free reader is starting up. Please try again in a minute.", {retryable: true});
  console.error("omr status", res.status, (await res.text()).slice(0, 300));
  fail(502, "omr_error", "The free reader had a problem with this page. Please try again.", {retryable: true});
}
