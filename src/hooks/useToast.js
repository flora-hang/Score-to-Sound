import { useCallback, useRef, useState } from "react";

/** A short status message that hides itself after a few seconds. */
export default function useToast(){
  const [message, setMessage] = useState(null);
  const timer = useRef(null);
  const show = useCallback(msg => {
    setMessage(msg);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setMessage(null), 3200);
  }, []);
  return [message, show];
}
