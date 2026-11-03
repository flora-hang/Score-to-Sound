import { useCallback, useEffect, useState } from "react";
import { getConfig, getMe, signOut as apiSignOut } from "../api.js";

const SIGNIN_ERRORS = {
  link: "That sign-in link didn't work. Please ask for a new one.",
  expired: "That sign-in link has expired or was already used. Please ask for a new one.",
  google: "Google sign-in didn't finish. Please try again.",
};

/**
 * The signed-in person and their songs, when the app runs with its own server.
 * server === false means no server here (e.g. GitHub Pages): AI reading isn't offered.
 */
export default function useAccount(toast){
  const [config, setConfig] = useState(undefined);   // undefined: still checking, null: no server
  const [user, setUser] = useState(null);
  const [credits, setCredits] = useState(null);

  const refresh = useCallback(async () => {
    try{ const me = await getMe(); setUser(me.user); setCredits(me.credits || null); return me; }
    catch(_){ setUser(null); setCredits(null); return null; }
  }, []);

  useEffect(() => {
    (async () => {
      const cfg = await getConfig();
      setConfig(cfg);
      if(!cfg) return;
      const me = await refresh();
      const q = new URLSearchParams(location.search);
      if(q.has("signedin") && me && me.user) toast(`Signed in as ${me.user.email}`);
      if(q.has("signin_error")) toast(SIGNIN_ERRORS[q.get("signin_error")] || SIGNIN_ERRORS.link);
      if(q.has("signedin") || q.has("signin_error")){ q.delete("signedin"); q.delete("signin_error"); history.replaceState(null, "", location.pathname + (q.toString() ? "?" + q : "") + location.hash); }
    })();
  }, []);  // eslint-disable-line

  const signOut = useCallback(async () => { try{ await apiSignOut(); }catch(_){} setUser(null); setCredits(null); toast("Signed out"); }, [toast]);

  return {config, server: !!config, ai: !!(config && config.ai), user, credits, setCredits, refresh, signOut};
}
