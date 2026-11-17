import { useCallback, useEffect, useRef, useState } from "react";
import { getConfig, getMe, signOut as apiSignOut } from "../api.js";

const SIGNIN_ERRORS = {
  link: "That sign-in link didn't work. Please ask for a new one.",
  expired: "That sign-in link has expired or was already used. Please ask for a new one.",
  google: "Google sign-in didn't finish. Please try again.",
};

/**
 * The signed-in person and their songs, when the app runs with its own server.
 *
 * status is always exactly one of:
 *   "checking"  – still asking the server who this is (show neither "Sign in" nor an account)
 *   "guest"     – the server answered: nobody is signed in
 *   "signedIn"  – the server answered with a user
 *   "offline"   – the server couldn't be reached; keep whatever we last knew, never guess "signed out"
 *   "noServer"  – this copy has no server (e.g. GitHub Pages): AI reading isn't offered
 * Each check ends in one of the last four, so nothing can spin forever.
 */
export default function useAccount(toast){
  const [config, setConfig] = useState(undefined);
  const [status, setStatus] = useState("checking");
  const [user, setUser] = useState(null);
  const [credits, setCredits] = useState(null);
  const ready = useRef(null);       // promise that settles once the first check is over
  const busy = useRef(null);        // the check in flight, so focus events don't start a second one
  const latest = useRef({status: "checking", user: null});
  latest.current = {status, user};

  const refresh = useCallback(() => {
    if(busy.current) return busy.current;
    busy.current = (async () => {
      try{
        const me = await getMe();                    // 200: {user: null} for guests, {user, credits} when signed in
        setUser(me.user || null); setCredits(me.user ? me.credits || null : null);
        setStatus(me.user ? "signedIn" : "guest");
        latest.current = {status: me.user ? "signedIn" : "guest", user: me.user || null};
        return me;
      }catch(err){
        if(err && err.status === 401){ setUser(null); setCredits(null); setStatus("guest"); latest.current = {status: "guest", user: null}; return {user: null}; }
        setStatus("offline"); latest.current = {...latest.current, status: "offline"};                       // network error or 5xx: don't throw the person out
        return null;
      }finally{ busy.current = null; }
    })();
    return busy.current;
  }, []);

  useEffect(() => {
    let alive = true;
    ready.current = (async () => {
      const cfg = await getConfig();
      if(!alive) return;
      setConfig(cfg);
      if(!cfg){ setStatus("noServer"); return; }
      const me = await refresh();
      const q = new URLSearchParams(location.search);
      if(q.has("signedin") && me && me.user) toast(`Signed in as ${me.user.email}`);
      if(q.has("signin_error")) toast(SIGNIN_ERRORS[q.get("signin_error")] || SIGNIN_ERRORS.link);
      if(q.has("purchase")){
        if(q.get("purchase") === "done") waitForPurchase(me);
        else toast("Payment cancelled. Nothing was charged.");
      }
      if(q.has("signedin") || q.has("signin_error") || q.has("purchase")){ q.delete("signedin"); q.delete("signin_error"); q.delete("purchase"); history.replaceState(null, "", location.pathname + (q.toString() ? "?" + q : "") + location.hash); }
    })();
    return () => { alive = false; };
  }, []);  // eslint-disable-line

  // Back from Stripe: the songs arrive when Stripe confirms the payment, usually within seconds.
  async function waitForPurchase(before){
    toast("Payment received. Adding your songs…");
    const had = before && before.user ? JSON.stringify([before.credits && before.credits.total, before.user.plan, before.user.renews]) : null;
    for(let i = 0; i < 15; i++){
      await new Promise(r => setTimeout(r, 2000));
      const me = await refresh();
      if(me && me.user && JSON.stringify([me.credits && me.credits.total, me.user.plan, me.user.renews]) !== had){ toast(`Thank you! You now have ${me.credits.total} song${me.credits.total === 1 ? "" : "s"}.`); return; }
    }
    toast("Your payment went through. Your songs will appear in a minute or two.");
  }

  // Coming back to the tab re-checks, so signing out (or buying songs) in another tab shows up here.
  useEffect(() => {
    if(!config) return;
    const onVisible = () => { if(document.visibilityState === "visible") refresh(); };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", refresh);
    return () => { document.removeEventListener("visibilitychange", onVisible); window.removeEventListener("online", refresh); };
  }, [config, refresh]);

  const signOut = useCallback(async () => {
    try{ await apiSignOut(); }
    catch(err){
      // The cookie is only removed by the server. If that didn't happen, saying "signed out" would be untrue.
      if(!(err && err.status === 401)){ toast("Couldn't sign out: no connection. Please try again."); return false; }
    }
    setUser(null); setCredits(null); setStatus("guest");
    toast("Signed out");
    return true;
  }, [toast]);

  /** Waits for the first check, then gives the up-to-date {status, user} (not a stale render's copy). */
  const whenReady = useCallback(async () => { await (ready.current || Promise.resolve()); return latest.current; }, []);

  return {config, status, server: !!config, ai: !!(config && config.ai), user, credits, setCredits, refresh, signOut, whenReady};
}
