"""Builds the Habanera (Bizet, Carmen, 1875: public domain) in the app's text notation.
Written from the bar-by-bar reading of the score; repeated sections are written once.
{} = next syllable from the verse's lyric list, {text} = this syllable."""
import re, sys

STAVES = ["P1", "P2", "P3", "P4", "P5", "P6.1", "P6.2"]   # Carmen, S, A, T, B, piano RH, piano LH
REST = "r:h"

def fill(s, it=None):
    def rep(m):
        t = m.group(1)
        if t == "": t = next(it)
        return f'"{t}"'
    return re.sub(r"\{([^{}]*)\}", rep, s)

# ---- left-hand ostinato (D pedal, then a slurred upper pair)
def lh(kind, minor):
    up = {"AF": ("A2", "F3" if minor else "F#3"), "BG": ("Bb2" if minor else "B2", "G3"), "AG": ("A2", "G3"), "CA": ("C#3", "A3")}[kind]
    return f"D2:8!st r:16 {up[0]}:16( {up[1]}:8!st) {up[0]}:8!st"

# ---- verse (bars 4-19; again as 64-79), Carmen with the piano
VERSE_C = [
    "r:q@p D5:8{} C#5:8{}",
    "C5:8t3{} C5:8t3{} C5:8t3{} B4:8{} Bb4:8{}",
    "A4:8{}( A4:16{}) A4:16{} G#4:8{} G4:8{}",
    "F4:16t3{}( G4:16t3 F4:16t3) E4:16{}( F4:16) G4:8{} F4:8{}",
    "E4:8{} r:8 D5:8{} C#5:8{}",
    "C5:8t3{} C5:8t3{} C5:8t3{} B4:8{} Bb4:8{}",
    "A4:16{} A4:16{} r:16 A4:16{} G4:8{} F4:8{}",
    "E4:16t3{}( F4:16t3 E4:16t3) D4:16{}( E4:16) F4:8{} E4:8{}",
    "D4:q{}( D5:8{}) C#5:8{}",
    "C5:8t3{} C5:8t3{} C5:8t3{} B4:8{} Bb4:8{}",
    "A4:16{} A4:16{} r:16 A4:16{} G#4:8{} G4:8{}",
    "F4:16t3{}( G4:16t3 F4:16t3) E4:16{}( F4:16) G4:8{} F4:8{}",
    "E4:q{}( D5:8{}) C#5:8{}",
    "C5:8t3{} C5:8t3{} C5:8t3{} B4:8{} Bb4:8{}",
    "A4:16{} A4:16{} r:16 A4:16{} G4:8{} F4:8{}",
    "E4:16t3{}( F4:16t3 E4:16t3) D4:16{}( E4:16) F4:8{} E4:8{}",
]
_R = {
    "a": "r:q F4+D5:8!st F4+C#5:8!st",
    "b": "F4+C5:8!st r:8 F4+B4:8!st F4+Bb4:8!st",
    "c": "F4+A4:8!st r:8 D4+G#4:8!st D4+G4:8!st",
    "d": "D4+F4:8!st r:8 D4+G4:8!st D4+F4:8!st",
    "e": "Bb3+E4:8!st r:8 E4+D5:8!st E4+C#5:8!st",
    "f": "E4+C5:8!st r:8 E4+B4:8!st E4+Bb4:8!st",
    "g": "E4+A4:8!st r:8 D4+G4:8!st D4+F4:8!st",
    "h": "C#4+E4:8!st r:8 C#4+E4:8!st C#4+E4:8!st",
    "i": "D4:8!st r:8 F4+D5:8!st F4+C#5:8!st",
}
VERSE_RH = [_R[k] for k in "abcdefghibcdefgh"]
VERSE_LH = ["AF", "AF", "AF", "AF", "BG", "BG", "BG", "AG", "AF", "AF", "AF", "AF", "BG", "BG", "BG", "AG"]

V1 = ("L'a- mour est un oi- seau re- bel- le Que nul ne peut ap- pri- voi- ser. Et c'est bien en vain qu'on l'a- "
      "pel- le, S'il lui con- vient de re- fu- ser. Rien n'y fait, me- nace ou pri- è- re. L'un par- le bien, "
      "l'au- tre se tait; Et c'est l'au- tre que je pré- fè- re. Il n'a rien dit: mais il me").split()
V2 = ("L'oi- seau que tu croy- ais sur- pren- dre Bat- tit de l'aile et s'en- vo- la; L'a- mour est loin, tu "
      "peux l'at- ten- dre: Tu ne l'at- tends plus, il est là! Tout au- tour de toi vi- te, vi- te, Il vient, "
      "s'en va, puis il re- vient; Tu crois le te- nir, il t'é- vi- te; Tu crois l'é- vi- ter, il te").split()

def verse(lyrics, first_rh_dyn):
    it = iter(lyrics); bars = []
    for i in range(16):
        rh = VERSE_RH[i]
        if i == 0 and first_rh_dyn: rh = rh.replace("F4+D5:8!st", f"F4+D5:8!st@{first_rh_dyn}", 1)
        bars.append({"P1": fill(VERSE_C[i], it), "P6.1": rh, "P6.2": lh(VERSE_LH[i], True)})
    left = list(it)
    assert not left, f"{len(left)} syllables left over: {left}"
    return bars

# ---- refrain (bars 20-59, again as 80-119). Each row: Carmen, S, A, T, B, RH, LH-kind
PG = "r:8. {}:16@f{{Prends}} {}:8{{garde}} {}:8{{à}}"     # "Prends garde à"
def pg(s, a, t, b):
    return [PG.format(*s), PG.format(*a), PG.format(*t), PG.format(*b)]
def toi(s, a, t, b):
    return [f"{x}:8{{toi!}} r:8 r:q" for x in (s, a, t, b)]
CHOIR_REST = [REST] * 4

REFRAIN = [
 # 20
 ["D4:q~{plaît.} D4:8 r:8",
  "r:q D5:8@pp{L'a-} C#5:8{mour}", "r:q D5:8@pp{L'a-} C#5:8{mour}", "r:q F#4:8@pp{L'a-} F#4:8{mour}", "r:q D4:8@pp{L'a-} D4:8{mour}",
  "D4:8!st r:8 F#4+D5:8!st F#4+C#5:8!st", "AF"],
 # 21
 ["r:q F#4:q{L'a-}",
  "C5:8t3{est} C5:8t3{un} C5:8t3{oi-} B4:8{seau} Bb4:8{re-}", "C5:8t3{est} C5:8t3{un} C5:8t3{oi-} B4:8{seau} Bb4:8{re-}",
  "F#4:8t3{est} F#4:8t3{un} F#4:8t3{oi-} F#4:8{seau} F#4:8{re-}", "D4:8t3{est} D4:8t3{un} D4:8t3{oi-} D4:8{seau} D4:8{re-}",
  "E4+C5:8t3!st C5:8t3!st C5:8t3!st E4+B4:8!st E4+Bb4:8!st", "AF"],
 # 22
 ["A4:q~{mour!} A4:8 r:8",
  "A4:8{bel-} A4:16{le} A4:16{Que} G#4:8{nul} G4:8{ne}", "A4:8{bel-} A4:16{le} A4:16{Que} G#4:8{nul} G4:8{ne}",
  "F#4:8{bel-} F#4:16{le} F#4:16{Que} D4:8{nul} D4:8{ne}", "D4:8{bel-} D4:16{le} D4:16{Que} A3:8{nul} A3:8{ne}",
  "F#4+A4:8!st r:16 A4:16( D4+G#4:8!st) D4+G4:8!st", "AF"],
 # 23
 ["r:q D5:q{l'a-}",
  "F#4:8{peut} E4:16{ap-}( F#4:16) G4:8{pri-} F#4:8{voi-}", "F#4:8{peut} E4:16{ap-}( F#4:16) G4:8{pri-} F#4:8{voi-}",
  "D4:8{peut} D4:8{ap-} D4:8{pri-} D4:8{voi-}", "A3:8{peut} A3:8{ap-} A3:8{pri-} A3:8{voi-}",
  "D4+F#4:16t3( G4:16t3 F#4:16t3 E4:16 F#4:16) D4+G4:8!st D4+F#4:8!st", "AF"],
 # 24
 ["B4:q~{mour!} B4:8 r:8",
  "E4:8{ser,} r:8 D5:8{Et} C#5:8{c'est}", "E4:8{ser,} r:8 D5:8{Et} C#5:8{c'est}",
  "B3:8{ser,} r:8 G4:8{Et} G4:8{c'est}", "G3:8{ser,} r:8 E4:8{Et} E4:8{c'est}",
  "D4+E4:8!st r:8 E4+D5:8!st E4+C#5:8!st", "BG"],
 # 25
 ["r:q E4:q{l'a-}!cr",
  "C5:8t3{bien} C5:8t3{en} C5:8t3{vain} B4:8{qu'on} Bb4:8{l'ap-}", "C5:8t3{bien} C5:8t3{en} C5:8t3{vain} B4:8{qu'on} Bb4:8{l'ap-}",
  "G4:8t3{bien} G4:8t3{en} G4:8t3{vain} G4:8{qu'on} G4:8{l'ap-}", "E4:8t3{bien} E4:8t3{en} E4:8t3{vain} E4:8{qu'on} E4:8{l'ap-}",
  "E4+C5:8t3!st C5:8t3!st C5:8t3!st E4+B4:8!st E4+Bb4:8!st", "BG"],
 # 26
 ["E5:q~{mour!}!he E5:8 r:8",
  "A4:8{pel-} A4:16{le} A4:16{S'il} G4:8{lui} F#4:8{con-}", "A4:8{pel-} A4:16{le} A4:16{S'il} G4:8{lui} F#4:8{con-}",
  "E4:8{pel-} E4:16{le} E4:16{S'il} E4:8{lui} B3:8{con-}", "B3:8{pel-} B3:16{le} B3:16{S'il} B3:8{lui} G3:8{con-}",
  "E4+A4:8!st r:16 A4:16( D4+G4:8!st) D4+F#4:8!st", "BG"],
 # 27
 ["r:q A4:q{l'a-}!dim",
  "E4:8{vient} D4:16{de}( E4:16) F#4:8{re-} E4:8{fu-}", "E4:8{vient} D4:16{de}( E4:16) F#4:8{re-} E4:8{fu-}",
  "C#4:8{vient} A3:8{de} A3:8{re-} C#4:8{fu-}", "G3:8{vient} G3:8{de} G3:8{re-} G3:8{fu-}",
  "C#4+E4:16t3( F#4:16t3 E4:16t3 D4:16 E4:16) C#4+E4:8!st C#4+E4:8!st", "AG"],
 # 28
 ["D5:8{mour!}!he r:16 A4:16@p{l'a-} D4:8{mour} E4:8{est}",
  "D4:8{ser!} r:8 r:q", "D4:8{ser!} r:8 r:q", "D4:8{ser!} r:8 r:q", "F#3:8{ser!} r:8 r:q",
  "D4:8!st r:8 D4:8!st A3+C#4:8!st", "AF"],
 # 29-35: Carmen alone
 ["F#4:8.{en-} A4:16{fant} F#4:8{de} E4:8{Bo-}", *CHOIR_REST, "D4+F#4:8!st r:8 D4+F#4:8!st A3+E4:8!st", "AF"],
 ["D4:8.{hême,} E4:16{Il} F#4:8{n'a} G4:8{ja-}", *CHOIR_REST, "A3+D4:8!st r:8 D4+F#4:8!st E4+G4:8!st", "AF"],
 ["A4:16{mais,} A4:16{ja-} A4:16{mais} A4:16{con-} B4:8{nu} A4:8{de}", *CHOIR_REST, "F#4+A4:8!st r:8 G4+B4:8!st F#4+A4:8!st", "AF"],
 ["G4:8{loi,} r:16 B4:16{Si} E4:8{tu} F#4:8{ne}", *CHOIR_REST, "E4+G4:8!st r:8 E4:8!st B3+F#4:8!st", "BG"],
 ["G4:8.{m'ai-} B4:16{mes} G4:8{pas,} F#4:8{je}", *CHOIR_REST, "E4+G4:8!st r:8 E4+G4:8!st B3+F#4:8!st", "BG"],
 ["E4:8.{t'ai-}( F#4:16) G4:16{me;} r:16 A4:8{Si}", *CHOIR_REST, "G3+E4:8!st r:8 E4+G4:8!st F#4+A4:8!st", "BG"],
 ["B4:16{je} B4:16{t'ai-} B4:16{me} B4:16{prends} C#5:8{garde} B4:8{à}", *CHOIR_REST, "G4+B4:8!st r:8 A4+C#5:8!st G4+B4:8!st", "CA"],
 # 36-37
 ["A4:q~{toi!} A4:8 r:8", *pg(("A4", "D5", "E5"), ("A4", "F#4", "A4"), ("A3", "D4", "E4"), ("A3", "F#3", "A3")),
  "F#4+A4:8!st r:16 A4:16@f( F#4+D5:8!st) A4+E5:8!st", "AF"],
 ["r:8. A4:16{Si} F#4:8{tu} E4:8{ne}", *toi("F#5", "D5", "F#4", "D4"), "D5+F#5:8!st r:8 D4+F#4:8!st@pp A3+C#4:8!st", "AF"],
 # 38-39
 ["D4:8.{m'ai-} E4:16{mes} F#4:8{pas,} G4:8{si}", *CHOIR_REST, "A3+D4:8!st r:8 D4+F#4:8!st E4+G4:8!st", "AF"],
 ["A4:16{tu} A4:16{ne} A4:16{m'ai-} A4:16{mes} D5:8{pas,} C#5:8{je}", *CHOIR_REST, "F#4+A4:8!st r:8 B4+D5:8!st A4+C#5:8!st", "AF"],
 # 40-41
 ["G4:q{t'ai-}( G4:8{me!}) r:8", *pg(("B4", "E5", "F#5"), ("B4", "G4", "B4"), ("B3", "E4", "F#4"), ("B3", "G3", "B3")),
  "E4+G4:8!st r:16 B4:16@f( G4+E5:8!st) B4+F#5:8!st", "BG"],
 ["r:8. B4:16{Mais} G4:8{si} F#4:8{je}", *toi("G5", "E5", "G4", "E4"), "E5+G5:8!st r:8 E4+G4:8!st@pp B3+F#4:8!st", "BG"],
 # 42-43
 ["E4:8{t'ai-}!cr F#4:16{me,} r:16 G4:8{si} A4:8{je}!he", *CHOIR_REST, "G3+E4:8!st r:8 E4+G4:8!st F#4+A4:8!st", "BG"],
 ["C#5:8t3{t'ai-}!fe B4:8t3{me,} A4:8t3{prends} G4:8t3{garde}( F#4:8t3!fe) E4:8t3{à}", *(["r:h!fe"] * 4),
  "E4+G4+C#5:8!st@mf r:8 r:q!fe", "A1+A2:8!st r:8 r:q!fe"],
 # 44-51: the choir's "L'amour est enfant de Bohême"
 ["D4:q~{toi!} D4:8 r:8",
  "r:8. A4:16@mf{L'a-} D4:8{mour} E4:8{est}", "r:8. A4:16@mf{L'a-} D4:8{mour} E4:8{est}",
  "r:8. A3:16@mf{L'a-} F#3:8{mour} A3:8{est}", REST,
  "r:8. A4:16@mf( F#4+D5:8!st) A4+E5:8!st", "AF"],
 [REST,
  "F#4:8.{en-} A4:16{fant} F#4:8{de} E4:8{Bo-}", "F#4:8.{en-} A4:16{fant} F#4:8{de} E4:8{Bo-}",
  "D4:8.{en-} F#4:16{fant} D4:8{de} A3:8{Bo-}", "D3+A3:h@p{L'a-}",
  "D5+F#5:8!st r:16 A5:16( D5+F#5:8!st) A4+E5:8!st", "AF"],
 [REST,
  "D4:8.{hême,} E4:16{Il} F#4:8{n'a} G4:8{ja-}", "D4:8.{hême,} E4:16{Il} F#4:8{n'a} G4:8{ja-}",
  "F#3:8.{hême,} A3:16{Il} D4:8{n'a} E4:8{ja-}", "D3+A3:h{mour}",
  "F#4+D5:8!st r:16 E5:16( D5+F#5:8!st) E5+G5:8!st", "AF"],
 [REST,
  "A4:16{mais,} A4:16{ja-} A4:16{mais} A4:16{con-} B4:8{nu} A4:8{de}", "A4:16{mais,} A4:16{ja-} A4:16{mais} A4:16{con-} B4:8{nu} A4:8{de}",
  "F#4:16{mais,} F#4:16{ja-} F#4:16{mais} F#4:16{con-} G4:8{nu} F#4:8{de}", "D3+A3:q{est} D3+A3:q{en-}",
  "F#5+A5:16!st F#5+A5:16!st F#5+A5:16!st F#5+A5:16!st G5+B5:8!st F#5+A5:8!st", "AF"],
 [REST,
  "G4:8{loi,} r:16 B4:16{Si} E4:8{tu} F#4:8{ne}", "G4:8{loi,} r:16 B4:16{Si} E4:8{tu} F#4:8{ne}",
  "E4:8{loi,} r:16 B3:16{Si} G3:8{tu} B3:8{ne}", "D3+B3:q~{fant} D3+B3:8 r:8",
  "E5+G5:8!st r:16 B4:16( G4+E5:8!st) B4+F#5:8!st", "BG"],
 [REST,
  "G4:8.{m'ai-} B4:16{mes} G4:8{pas,} F#4:8{je}", "G4:8.{m'ai-} B4:16{mes} G4:8{pas,} F#4:8{je}",
  "E4:8.{m'ai-} G4:16{mes} E4:8{pas,} B3:8{je}", "D3+B3:h{de}",
  "E5+G5:8!st r:16 B5:16( E5+G5:8!st) B4+F#5:8!st", "BG"],
 [REST,
  "E4:8.{t'ai-}( F#4:16) G4:16{me;} r:16 A4:8{Si}", "E4:8.{t'ai-}( F#4:16) G4:16{me;} r:16 A4:8{Si}",
  "G3:8.{t'ai-}( B3:16) E4:16{me;} r:16 F#4:8{Si}", "D3+B3:h{Bo-}",
  "G4+E5:8!st r:16 F#5:16( E5+G5:8!st) F#5+A5:8!st", "BG"],
 [REST,
  "B4:16{je} B4:16{t'ai-} B4:16{me,} B4:16{prends} C#5:8{garde} B4:8{à}", "B4:16{je} B4:16{t'ai-} B4:16{me,} B4:16{prends} C#5:8{garde} B4:8{à}",
  "G4:16{je} G4:16{t'ai-} G4:16{me,} G4:16{prends} A4:8{garde} G4:8{à}", "D3+C#4:h{hê-}",
  "G5+B5:16!st G5+B5:16!st G5+B5:16!st G5+B5:16!st A5+C#6:8!st G5+B5:8!st", "AG"],
 # 52-53
 [REST,
  "A4:8{toi!} r:16 A4:16@f{Prends} D5:8{garde} E5:8{à}", "A4:8{toi!} r:16 A4:16@f{Prends} F#4:8{garde} A4:8{à}",
  "F#4:8{toi!} r:16 A3:16@f{Prends} D4:8{garde} E4:8{à}", "D3+D4:8{me!} r:16 A3:16@f{Prends} F#3:8{garde} A3:8{à}",
  "F#5+A5:8!st r:16 A4:16@f( F#4+D5:8!st) A4+E5:8!st", "AF"],
 ["r:8. A4:16@p{Si} F#4:8{tu} E4:8{ne}", *toi("F#5", "D5", "F#4", "D4"), "D5+F#5:8!st r:16 A4:16@pp( D4+F#4:8 A3+E4:8", "AF"],
 # 54-55
 ["D4:8.{m'ai-} E4:16{mes} F#4:8{pas,} G4:8{si}", *CHOIR_REST, "A3+D4:8. A3+E4:16 D4+F#4:8 E4+G4:8", "AF"],
 ["A4:16{tu} A4:16{ne} A4:16{m'ai-} A4:16{mes} D5:8{pas} C#5:16t3{je}( D5:16t3 C#5:16t3)", *CHOIR_REST, "F#4+A4:q B4+D5:8 A4+C#5:8)", "AF"],
 # 56-57
 ["G4:q{t'ai-}( G4:8{me!}) r:8", *pg(("B4", "E5", "F#5"), ("B4", "G4", "B4"), ("B3", "E4", "F#4"), ("B3", "G3", "B3")),
  "E4+G4:8!st r:16 B4:16@f( G4+E5:8!st) B4+F#5:8!st", "BG"],
 ["r:8. B4:16{Mais} G4:8{si} F#4:8{je}", *toi("G5", "E5", "G4", "E4"), "E5+G5:8!st r:16 B4:16@pp( E4+G4:8 B3+F#4:8", "BG"],
 # 58-59
 ["E4:8{t'ai-}!cr F#4:16{me,} r:16 G4:8{si} A4:8{je}", *CHOIR_REST, "G3+E4:8. B3+F#4:16 E4+G4:8 F#4+A4:8)", "BG"],
 ["C#5:16@f{t'ai-}!he( B4:16) G#4:16{me,} A4:16{prends} F#5:8.!fe{garde} E5:32t3{à}( F#5:32t3 E5:32t3)",
  "C#5:h!fe@p{à}!cr", "G4:h!fe@p{à}!cr", "A3:h!fe@p{à}!cr", "D3:h!fe@p{à}!cr",
  "E4+G4+C#5:q.@f r:8!fe", "D2+A2:q. r:8!fe"],
]
REFRAIN_END = [   # 60-63, the end of the first refrain
 ["D5:h~{toi!}", "D5:h~@f{toi!}!he", "F#4:h~@f{toi!}!he", "A3:h~@f{toi!}!he", "D3:h~@f{toi!}!he",
  "D5:8!st@ff r:16 A5:16( F#6:8!st) A5:8!st", "AF"],
 ["D5:8 r:8 r:q", "D5:8 r:8 r:q", "F#4:8 r:8 r:q", "A3:8 r:8 r:q", "D3:8 r:8 r:q",
  "D5:8!st r:16 A4:16( F#5:8!st) A4:8!st", "AF"],
 [REST, *CHOIR_REST, "D4:8!st r:16 A3:16( F#4:8!st) A3:8!st", "AF"],
 [REST, *CHOIR_REST, REST, "D2+D3:8!st r:16 A2:16( F#3:8!st) A2:8!st"],
]
FINAL = ["D5:q.{toi!} r:8", "D5:q.@f{toi!}!he r:8", "F#4:q.@f{toi!}!he r:8", "A3:q.@f{toi!}!he r:8", "D3:q.@f{toi!}!he r:8",
         "D4+F#4+A4+D5:8!st@f r:16 A5:16@ff( D6+F#6:q!st)", "D3:8!st r:16 A2:16( D2:q!st)"]

def refrain_bars(rows):
    out = []
    for row in rows:
        c, s, a, t, b, rh, left = row
        out.append({"P1": fill(c), "P2": fill(s), "P3": fill(a), "P4": fill(t), "P5": fill(b), "P6.1": rh,
                    "P6.2": left if " " in left else lh(left, False)})
    return out

def silent_choir(bars):
    for b in bars:
        for k in ("P2", "P3", "P4", "P5"): b.setdefault(k, REST)
        b.setdefault("P1", REST)
    return bars

bars = []                                   # (options, {staff: text})
intro = [{"P1": REST, "P6.1": REST, "P6.2": lh("AF", True).replace("D2:8!st", "D2:8!st@pp", 1)}] + \
        [{"P1": REST, "P6.1": REST, "P6.2": lh("AF", True)} for _ in range(2)]
for b in silent_choir(intro): bars.append(("", b))
v1 = silent_choir(verse(V1, None))
for b in v1: bars.append(("", b))
r1 = refrain_bars(REFRAIN) + refrain_bars(REFRAIN_END)
for i, b in enumerate(r1): bars.append(("key=2 major" if i == 0 else "", b))
v2 = silent_choir(verse(V2, "pp"))
for i, b in enumerate(v2): bars.append(("key=-1 minor" if i == 0 else "", b))
r2 = refrain_bars(REFRAIN) + [dict(zip(STAVES, [fill(x) for x in FINAL[:5]] + FINAL[5:]))]
for i, b in enumerate(r2): bars.append(("key=2 major" if i == 0 else "", b))
assert len(bars) == 120, len(bars)

head = """TITLE: Habanera (L'amour est un oiseau rebelle)
COMPOSER: Georges Bizet · Carmen (1875) · Words: Henri Meilhac and Ludovic Halévy
TEMPO: 72 Allegretto quasi Andantino
KEY: -1 minor
TIME: 2/4
PART P1 | Carmen | vocal | treble
PART P2 | Soprano | vocal | treble
PART P3 | Alto | vocal | treble
PART P4 | Tenor | vocal | treble8
PART P5 | Bass | vocal | bass
PART P6 | Piano | accompaniment | treble bass
"""
lines = [head.rstrip()]
for n, (opt, b) in enumerate(bars, 1):
    lines.append(f"M {n}" + (f" | {opt}" if opt else ""))
    for k in STAVES: lines.append(f"{k}: {b[k]}")
text = "\n".join(lines) + "\n"
assert "`" not in text and "${" not in text
open(sys.argv[1], "w").write(
    "/* Example score: Habanera from Carmen by Georges Bizet (1875, public domain), for solo voice, SATB choir\n"
    "   and piano, in the app's text notation. Generated by scripts/habanera.py; edit that, not this. */\n"
    "export const DEMO = `" + text + "`;\n")
print("bars", len(bars))
