/* Personal Accompanist API on Cloudflare Workers. Everything outside /api is the app itself,
   served from dist/ by Cloudflare's static assets. */
import { json, ApiError, int } from "./util.js";
import { getUser, requireUser, logout, sendEmailLink, emailLinkPage, verifyEmailLink, googleStart, googleCallback } from "./auth.js";
import { creditsOf } from "./credits.js";
import { createJob, readPage, finishJob, lookupJob } from "./reading.js";

export default {
  async fetch(request, env, ctx){
    const url = new URL(request.url), path = url.pathname, method = request.method;
    try{
      // Requests that change things must come from our own app (blocks cross-site form tricks).
      const fromApp = request.headers.get("x-requested-with") === "fetch";
      const post = method === "POST";
      if(post && !fromApp && path !== "/api/auth/email/verify") throw new ApiError(403, "forbidden", "Forbidden.");

      if(path === "/api/config" && method === "GET") return json({
        ai: !!env.ANTHROPIC_API_KEY, email: !!env.RESEND_API_KEY || env.DEV_MODE === "1", google: !!env.GOOGLE_CLIENT_ID,
        trialSongs: int(env.TRIAL_SONGS, 1), pagesPerSong: int(env.PAGES_PER_SONG, 6), maxPages: int(env.MAX_PAGES, 40),
        payments: false,
      });
      if(path === "/api/me" && method === "GET"){
        const u = await getUser(request, env);
        if(!u) return json({user: null});
        return json({user: {email: u.email, name: u.name, plan: u.plan}, credits: creditsOf(u)});
      }
      if(path === "/api/auth/email" && post) return await sendEmailLink(request, env);
      if(path === "/api/auth/email/verify" && method === "GET") return await emailLinkPage(request, env);
      if(path === "/api/auth/email/verify" && post) return await verifyEmailLink(request, env);
      if(path === "/api/auth/google" && method === "GET") return await googleStart(request, env);
      if(path === "/api/auth/google/callback" && method === "GET") return await googleCallback(request, env);
      if(path === "/api/auth/logout" && post) return await logout(request, env);

      if(path === "/api/jobs" && post){
        if(!env.ANTHROPIC_API_KEY) throw new ApiError(503, "ai_unavailable", "AI reading isn't set up yet.");
        return await createJob(request, env, await requireUser(request, env));
      }
      if(path === "/api/jobs/lookup" && method === "GET") return await lookupJob(request, env, await requireUser(request, env));
      let m;
      if(post && (m = path.match(/^\/api\/jobs\/([0-9a-f-]{36})\/pages\/(\d{1,3})$/)))
        return await readPage(request, env, ctx, await requireUser(request, env), m[1], +m[2]);
      if(post && (m = path.match(/^\/api\/jobs\/([0-9a-f-]{36})\/finish$/)))
        return await finishJob(request, env, await requireUser(request, env), m[1]);

      return json({error: {code: "not_found", message: "Not found."}}, 404);
    }catch(err){
      if(err instanceof ApiError) return json({error: {code: err.code, message: err.message, ...err.extra}}, err.status);
      console.error(err);
      return json({error: {code: "server_error", message: "Something went wrong on our side. Please try again."}}, 500);
    }
  },
};
