import { useEffect, useMemo, useRef, useState } from "react";
import { Player } from "../engine/audio.js";

let shared = null;          // one audio engine per page (survives StrictMode's double effects)
const loadListeners = new Set();
const endListeners = new Set();
let loadState = "loading";

function getPlayer(){
  if(!shared){
    shared = new Player({
      baseUrl: import.meta.env.BASE_URL + "piano/",
      onLoadState: s => { loadState = s; loadListeners.forEach(f => f(s)); },
      onEnd: () => endListeners.forEach(f => f()),
    });
  }
  return shared;
}

/** The audio engine plus its loading state ("loading" | "ready" | "error" | "slow"). */
export function usePlayer(onEnd){
  const player = useMemo(getPlayer, []);
  const [state, setState] = useState(loadState);
  const endRef = useRef(onEnd); endRef.current = onEnd;
  useEffect(() => {
    loadListeners.add(setState);
    const end = () => endRef.current && endRef.current();
    endListeners.add(end);
    const slow = setTimeout(() => setState(s => s === "loading" ? "slow" : s), 6000);
    return () => { loadListeners.delete(setState); endListeners.delete(end); clearTimeout(slow); };
  }, []);
  return [player, state];
}

/**
 * A 60-fps "clock" while playing. Components subscribe to it to move the playhead or update
 * the bar counter without re-rendering the whole app every frame.
 */
export function useClock(player, playing){
  const listeners = useRef(new Set());
  useEffect(() => {
    if(!playing) return;
    let id;
    const loop = () => {
      const b = player.currentBeat();
      if(b !== null) listeners.current.forEach(f => f(b));
      id = requestAnimationFrame(loop);
    };
    id = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(id);
  }, [player, playing]);
  return useMemo(() => ({
    subscribe(fn){ listeners.current.add(fn); return () => listeners.current.delete(fn); },
  }), []);
}
