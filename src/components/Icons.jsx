/* Small inline SVG icons used across the interface. */
const S = {fill: "none", stroke: "currentColor", strokeLinecap: "round", strokeLinejoin: "round"};

export const Logo = () => (
  <svg width="26" height="26" viewBox="0 0 26 26" aria-hidden="true">
    <g {...S} strokeWidth="1.4"><path d="M2 7h22M2 11h22M2 15h22M2 19h22" /></g>
    <ellipse cx="10" cy="17" rx="3.4" ry="2.5" transform="rotate(-20 10 17)" fill="currentColor" />
    <path d="M13 16.5V4.5" stroke="currentColor" strokeWidth="1.6" />
    <path d="M13 4.5c2.5 1.2 4.6 2.6 4.2 5.6" fill="none" stroke="currentColor" strokeWidth="1.6" />
  </svg>
);
export const Open = () => <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2v9M4 7l4 4 4-4M2.5 13.5h11" {...S} strokeWidth="1.6" /></svg>;
export const Library = () => <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M3 2.5h3v11H3zM7.5 2.5h3v11h-3zM11.6 3.2l2.6.7-2.4 9.4-2.6-.7" {...S} strokeWidth="1.4" /></svg>;
export const Pencil = () => <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M10.5 2.5l3 3L6 13H3v-3z" {...S} strokeWidth="1.4" /></svg>;
export const Keyboard = () => <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true"><rect x="1.5" y="4" width="15" height="10" rx="2" {...S} strokeWidth="1.3" /><path d="M4.5 7h1M8.5 7h1M12.5 7h1M5 11h8" {...S} strokeWidth="1.4" /></svg>;
export const Sliders = () => (
  <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
    <path d="M3 5h12M3 9h12M3 13h12" {...S} strokeWidth="1.5" />
    {[[6,5],[12,9],[8,13]].map(([x,y]) => <circle key={y} cx={x} cy={y} r="1.8" fill="var(--surface)" stroke="currentColor" strokeWidth="1.3" />)}
  </svg>
);
export const Pointer = () => <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M4 2l8 6-3.5.8L10.5 13 9 13.7 7 9.6 4 12z" fill="currentColor" /></svg>;
export const Close = () => <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M3 3l8 8M11 3l-8 8" {...S} strokeWidth="1.6" /></svg>;
export const Minus = ({size = 12}) => <svg width={size} height={size} viewBox="0 0 12 12" aria-hidden="true"><path d="M2 6h8" {...S} strokeWidth="1.7" /></svg>;
export const Plus = ({size = 12}) => <svg width={size} height={size} viewBox="0 0 12 12" aria-hidden="true"><path d="M2 6h8M6 2v8" {...S} strokeWidth="1.7" /></svg>;
export const ToStart = () => <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M2.5 2v10M12 2.5L5 7l7 4.5z" fill="currentColor" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" /></svg>;
export const Prev = () => <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M9 3L5 7l4 4" {...S} strokeWidth="1.7" /></svg>;
export const Next = () => <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M5 3l4 4-4 4" {...S} strokeWidth="1.7" /></svg>;
export const Play = () => <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true"><path d="M6 3.5l11 6.5-11 6.5z" fill="currentColor" /></svg>;
export const Pause = () => <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true"><rect x="5" y="4" width="3.6" height="12" rx="1" fill="currentColor" /><rect x="11.4" y="4" width="3.6" height="12" rx="1" fill="currentColor" /></svg>;
export const Metronome = () => <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M5.5 2h5l2.5 12H3z M8 11l3.5-6" {...S} strokeWidth="1.4" /></svg>;
export const FileIcon = () => (
  <svg width="34" height="34" viewBox="0 0 34 34" aria-hidden="true">
    <path d="M9 3h11l7 7v20a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z M20 3v7h7" {...S} strokeWidth="1.6" />
    <path d="M12 17h10M12 21h10M12 25h6" stroke="currentColor" strokeWidth="1.4" />
  </svg>
);
export const Save = () => <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M3 2.5h8l2.5 2.5v8.5H3zM5.5 2.5v3.5h5v-3.5M5 13.5v-4h6v4" {...S} strokeWidth="1.4" /></svg>;
