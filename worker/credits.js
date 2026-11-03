/* Song credits. Each user has two buckets:
   - monthly_songs: from a monthly plan, used first, reset each period (stage two)
   - pack_songs: the free trial plus bought packs; never expire                    */
import { now, fail } from "./util.js";

export const creditsOf = u => ({monthly: u.monthly_songs, pack: u.pack_songs, total: u.monthly_songs + u.pack_songs});

async function ledger(env, userId, delta, bucket, reason, ref){
  await env.DB.prepare("INSERT INTO credit_ledger (user_id, delta, bucket, reason, ref, created_at) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(userId, delta, bucket, reason, ref || null, now()).run();
}

export async function grant(env, userId, songs, bucket, reason, ref){
  if(songs <= 0) return;
  const col = bucket === "monthly" ? "monthly_songs" : "pack_songs";
  await env.DB.prepare(`UPDATE users SET ${col} = ${col} + ? WHERE id = ?`).bind(songs, userId).run();
  await ledger(env, userId, songs, bucket, reason, ref);
}

/** Take `songs` from the user, monthly first. Throws 402 if they don't have enough. */
export async function charge(env, user, songs, ref){
  for(let attempt = 0; attempt < 3; attempt++){
    const u = await env.DB.prepare("SELECT monthly_songs, pack_songs FROM users WHERE id = ?").bind(user.id).first();
    const total = u.monthly_songs + u.pack_songs;
    if(total < songs) fail(402, "no_credits", `This score needs ${songs} song${songs === 1 ? "" : "s"} and you have ${total}.`, {needed: songs, have: total});
    const fromMonthly = Math.min(u.monthly_songs, songs), fromPack = songs - fromMonthly;
    // Only succeeds if the balance hasn't changed since we read it (no double spending).
    const r = await env.DB.prepare("UPDATE users SET monthly_songs = monthly_songs - ?, pack_songs = pack_songs - ? WHERE id = ? AND monthly_songs = ? AND pack_songs = ?")
      .bind(fromMonthly, fromPack, user.id, u.monthly_songs, u.pack_songs).run();
    if(r.meta.changes === 1){
      if(fromMonthly) await ledger(env, user.id, -fromMonthly, "monthly", "read", ref);
      if(fromPack) await ledger(env, user.id, -fromPack, "pack", "read", ref);
      return {fromMonthly, fromPack};
    }
  }
  fail(409, "busy", "Please try again.");
}

export async function refund(env, userId, fromMonthly, fromPack, ref){
  if(fromMonthly) await grant(env, userId, fromMonthly, "monthly", "refund", ref);
  if(fromPack) await grant(env, userId, fromPack, "pack", "refund", ref);
}
