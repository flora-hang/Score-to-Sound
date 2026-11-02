import { useEffect, useState } from "react";

export default function useMediaQuery(query){
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setMatches(mq.matches);
    mq.addEventListener("change", on); on();
    return () => mq.removeEventListener("change", on);
  }, [query]);
  return matches;
}
