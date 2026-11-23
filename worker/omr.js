/* Free note reading (optical music recognition) with homr, running in a Cloudflare Container.
   It reads the notes of printed or photographed staff notation, but not lyrics. The app turns
   the MusicXML it returns into a score; reading with AI stays the option for lyrics.
   The container is defined in omr/ (Dockerfile + server.py) and in wrangler.toml. */
import { Container, getRandom } from "@cloudflare/containers";
import { fail, int, rateLimit, clientIp } from "./util.js";

const MAX_BYTES = 15 * 1024 * 1024;

export class OmrReader extends Container {
  defaultPort = 8080;
  sleepAfter = "3m";        // stay warm between the pages of one score, then stop (and stop costing)
  enableInternet = false;   // everything homr needs is inside the image
}

export const omrOn = env => !!env.OMR && env.OMR_ENABLED !== "0";

/** POST /api/omr/page — body: one page image (JPEG/PNG). Reply: MusicXML, or a JSON error. */
export async function readPageFree(request, env){
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
    res = await reader.fetch(new Request("http://omr/read", {method: "POST", body, headers: {"content-type": type}}));
  }catch(err){
    console.error("omr", err && err.message);
    fail(503, "omr_busy", "The free reader is starting up or busy. Please try again in a minute.", {retryable: true});
  }
  if(res.ok) return new Response(res.body, {headers: {"content-type": "application/vnd.recordare.musicxml+xml; charset=utf-8", "cache-control": "no-store"}});
  if(res.status === 422) fail(422, "unreadable", "No music could be found on this page. Try a straighter, sharper photo of one page, or read it with AI.");
  if(res.status === 503) fail(503, "omr_busy", "The free reader is starting up. Please try again in a minute.", {retryable: true});
  console.error("omr status", res.status, (await res.text()).slice(0, 300));
  fail(502, "omr_error", "The free reader had a problem with this page. Please try again.", {retryable: true});
}
