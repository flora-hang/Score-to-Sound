import { useEffect, useState } from "react";

/**
 * Capabilities the page gets when it runs as a Claude artifact:
 *  - sample: ask Claude (used to read PDF and photo pages)
 *  - db + uid: a private per-person store (the Library)
 * Outside Claude, window.claude doesn't exist and everything stays null.
 */
export default function useClaude(){
  const [caps, setCaps] = useState({sample: null, db: null, uid: null, checked: false});
  useEffect(() => {
    let alive = true;
    const c = window.claude;
    if(!c || !c.use){ setCaps(x => ({...x, checked: true})); return; }
    (async () => {
      const [sample, db, user] = await Promise.all([c.use("sample"), c.use("db"), c.use("user")].map(p => p.catch(() => null)));
      const uid = user ? await user.id().catch(() => null) : null;
      if(alive) setCaps({sample, db, uid, checked: true});
    })();
    return () => { alive = false; };
  }, []);
  return caps;
}
