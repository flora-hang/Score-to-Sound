import { useState } from "react";
import Modal from "./Modal.jsx";
import { sendSignInEmail, googleSignInUrl } from "../api.js";

const songs = n => `${n} song${n === 1 ? "" : "s"}`;

const GoogleLogo = () => (
  <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
    <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/>
    <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/>
    <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/>
    <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/>
  </svg>
);

/** Email-link and Google sign-in. Used in the account window and inside "Open a score". */
export function SignInForm({config, intro}){
  const [email, setEmail] = useState(""), [state, setState] = useState("idle"), [msg, setMsg] = useState(""), [devLink, setDevLink] = useState(null);
  async function submit(e){
    e.preventDefault();
    setState("sending"); setMsg("");
    try{ const r = await sendSignInEmail(email); setState("sent"); setDevLink(r.devLink || null); }
    catch(err){ setState("idle"); setMsg(err.message || "Couldn't send the email. Please try again."); }
  }
  if(state === "sent") return (
    <div className="signin">
      <p className="signin-sent"><b>Check your inbox.</b> We sent a sign-in link to {email}. It works once and expires in 20 minutes.</p>
      {devLink && <p className="notice">Development mode: <a href={devLink}>open the sign-in link</a></p>}
      <button className="btn ghost" onClick={() => setState("idle")}>Use a different email</button>
    </div>
  );
  return (
    <div className="signin">
      {intro && <p className="signin-intro">{intro}</p>}
      {config && config.google && <a className="btn google" href={googleSignInUrl()}><GoogleLogo />Continue with Google</a>}
      {config && config.google && config.email && <div className="or"><span>or</span></div>}
      {config && config.email && (
        <form onSubmit={submit} className="email-form">
          <label htmlFor="signinEmail" className="sr">Email address</label>
          <input id="signinEmail" type="email" required autoComplete="email" placeholder="you@example.com" value={email} onChange={e => setEmail(e.target.value)} />
          <button className="btn primary" disabled={state === "sending"}>{state === "sending" ? "Sending…" : "Email me a sign-in link"}</button>
        </form>
      )}
      {msg && <div className="err-msg">{msg}</div>}
      <p className="fine">No password needed. We only use your email to sign you in and keep track of your songs. By signing in, you agree to the <a href="./terms" target="_blank" rel="noopener">Terms of service</a> and <a href="./privacy" target="_blank" rel="noopener">Privacy policy</a>.</p>
    </div>
  );
}

/** Upgrade options. Payments come in stage two. */
export function GetMoreSongs({config}){
  return (
    <div className="getmore">
      <h4>Get more songs</h4>
      <div className="plans">
        <div className="plan"><b>Song packs</b><span>Pay once, use any time. Songs never expire.</span></div>
        <div className="plan"><b>Monthly plan</b><span>A set of songs every month, for regular practice.</span></div>
      </div>
      {!(config && config.payments) && <p className="fine">Paid plans are coming soon. Until then you can still open MusicXML files and use the free reader.</p>}
    </div>
  );
}

export default function AccountDialog({account, onClose}){
  const {config, user, credits, signOut} = account;
  const trial = config ? config.trialSongs : 1;
  return (
    <Modal title={user ? "Your account" : "Sign in"} width={480} onClose={onClose}>
      {user ? (
        <div className="account">
          <div className="acct-row"><span className="avatar" aria-hidden="true">{(user.name || user.email)[0].toUpperCase()}</span>
            <div><b>{user.name || user.email}</b>{user.name && <small>{user.email}</small>}</div></div>
          <div className="songs-left">
            <span className="big">{credits ? credits.total : 0}</span>
            <span>{credits && credits.total === 1 ? "song" : "songs"} left to read with AI
              {credits && credits.monthly > 0 && <small>{songs(credits.monthly)} this month · {songs(credits.pack)} that never expire</small>}</span>
          </div>
          <p className="fine">One song is a score of up to {config ? config.pagesPerSong : 6} pages. Opening the same file again is free, and if a score can't be read at all, you get the song back.</p>
          <GetMoreSongs config={config} />
          <div style={{display: "flex", justifyContent: "flex-end", marginTop: 14}}><button className="btn ghost" onClick={async () => { await signOut(); onClose(); }}>Sign out</button></div>
        </div>
      ) : (
        <SignInForm config={config} intro={`Sign in to read scores with AI. Your first ${trial === 1 ? "song is" : songs(trial) + " are"} free.`} />
      )}
    </Modal>
  );
}
