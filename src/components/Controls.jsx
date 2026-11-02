/* Reusable form controls. */

/** On/off switch (role="switch"). */
export function Switch({checked, onChange, label, id}){
  return <button id={id} className="switch" role="switch" aria-checked={checked} aria-label={label} title={label} onClick={() => onChange(!checked)} />;
}

/** Segmented control: one choice out of a few. */
export function Segmented({options, value, onChange, label, style}){
  return (
    <div className="seg" role="group" aria-label={label} style={style}>
      {options.map(o => (
        <button key={o.value} aria-pressed={value === o.value} title={o.title} disabled={o.disabled} onClick={() => onChange(o.value)}>{o.label}</button>
      ))}
    </div>
  );
}

/** − value + stepper; clicking the value resets it. */
export function Stepper({label, id, main, sub, changed, onDown, onUp, onReset, downLabel, upLabel, resetTitle, children}){
  return (
    <div className={`ctl ${id}-ctl`}>
      <label htmlFor={id}>{label}</label>
      <div className="stepper">
        <button aria-label={downLabel} title={downLabel} onClick={onDown}>{children[0]}</button>
        <button className={`val${changed ? " changed" : ""}`} id={id} title={resetTitle} onClick={onReset}><b>{main}</b><small>{sub}</small></button>
        <button aria-label={upLabel} title={upLabel} onClick={onUp}>{children[1]}</button>
      </div>
    </div>
  );
}
