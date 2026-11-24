"""Free 简谱 (numbered notation) reader.

Reads a page of jianpu - printed, scanned or photographed - into the app's text notation:
the notes (pitch from the key "1=...", octave dots, accidentals), their lengths (underlines,
dashes, dots), bar lines, the title/key/time/tempo, and the Chinese lyrics under the notes.

How it works:
  1. RapidOCR (already in the image for homr) finds every line of text with each character's
     position. Lines with Chinese characters are lyrics (or the title and credits); the header
     line gives the key ("1=bB"), the time ("4/4") and the tempo ("=68").
  2. The music rows are found by image analysis: the page is split into shapes, and shapes the
     size of a digit that line up horizontally form a row.
  3. Each digit-sized shape is identified by RapidOCR's recogniser, one shape at a time.
  4. Small shapes around each digit give it its meaning: dots above (higher octave), dots below
     (lower octave), lines underneath (shorter), dashes after it (longer), a dot after it
     (dotted), "#"/"b" before it (sharp/flat). Tall thin lines are bar lines.
  5. The lyric characters under a row are matched to the notes above them by position.
"""
import math
import re

import cv2
import numpy as np

DIGITS = set("01234567")
# what the recogniser sometimes says for a lone digit
OCR_FIX = {"l": "1", "I": "1", "i": "1", "|": "1", "!": "1", "]": "1", "[": "1", "O": "0", "o": "0", "D": "0", "Q": "0",
           "S": "5", "s": "5", "Z": "2", "z": "2", "G": "6", "b": "6", "T": "7", "?": "7", "x": "X", "×": "X", "χ": "X", "K": "X"}
CJK = re.compile(r"[㐀-鿿]")
LETTERS = "CDEFGAB"
STEP_SEMI = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}
MAJOR = [0, 2, 4, 5, 7, 9, 11]
KEY_FIFTHS = {"C": 0, "G": 1, "D": 2, "A": 3, "E": 4, "B": 5, "F#": 6, "C#": 7, "F": -1, "Bb": -2, "Eb": -3, "Ab": -4,
              "Db": -5, "Gb": -6, "Cb": -7, "A#": -2, "D#": -3, "G#": -4}


# ----------------------------------------------------------------------------- image helpers
def binarize(gray):
    # Otsu, but never so light that a pale watermark becomes ink
    t, _ = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
    t = min(t, 185)
    return (gray < t).astype(np.uint8) * 255


def components(binary):
    n, lab, st, cen = cv2.connectedComponentsWithStats(binary, 8)
    out = []
    for i in range(1, n):
        x, y, w, h, a = st[i]
        out.append({"i": i, "x": int(x), "y": int(y), "w": int(w), "h": int(h), "a": int(a),
                    "cx": x + w / 2, "cy": y + h / 2})
    return out, lab


def digit_height(comps):
    """The usual height of a digit on this page: the most common height of upright, solid shapes."""
    hs = [c["h"] for c in comps if 7 <= c["h"] <= 120 and 0.3 <= c["w"] / c["h"] <= 0.95 and c["a"] >= 0.18 * c["w"] * c["h"]]
    if not hs:
        return 0
    hist = np.bincount(hs)
    # smooth a little: digits of one font vary by a pixel or two
    sm = np.convolve(hist, [1, 2, 3, 2, 1], mode="same")
    return int(np.argmax(sm))


# ----------------------------------------------------------------------------- OCR
class Ocr:
    def __init__(self):
        from rapidocr import RapidOCR
        self.engine = RapidOCR(params={"Global.log_level": "critical"})

    def lines(self, img):
        # say every option each time: RapidOCR remembers the last call's settings
        r = self.engine(img, use_det=True, use_cls=True, use_rec=True, return_word_box=True)
        out = []
        if r.boxes is None:
            return out
        words = r.word_results or [()] * len(r.txts)
        for box, txt, sc, wr in zip(r.boxes, r.txts, r.scores, words):
            xs, ys = box[:, 0], box[:, 1]
            chars = []
            for w in wr or ():
                ch, s, b = w[0], w[1], np.array(w[2])
                chars.append({"ch": ch, "x0": float(b[:, 0].min()), "x1": float(b[:, 0].max()),
                              "y0": float(b[:, 1].min()), "y1": float(b[:, 1].max())})
            out.append({"text": txt, "score": float(sc), "x0": float(xs.min()), "x1": float(xs.max()),
                        "y0": float(ys.min()), "y1": float(ys.max()), "chars": chars})
        return out

    def read_glyphs(self, crops):
        """Recognise many small single-glyph images at once. Returns [(text, score)]."""
        if not crops:
            return []
        out = []
        for c in crops:
            res = self.engine(c, use_det=False, use_cls=False, use_rec=True)
            txt = (res.txts[0] if res.txts else "") if res is not None else ""
            sc = float(res.scores[0]) if res is not None and res.scores else 0.0
            out.append((txt.strip(), sc))
        return out


# ----------------------------------------------------------------------------- header
def parse_header(lines, page_h, H=30):
    head = {"tonic": "C", "time": (4, 4), "tempo": None, "title": ""}
    # The header sits in the top part of a page. On a short page (a screenshot, half a page) that part is
    # better measured in digit heights than as a share of the page.
    top = [l for l in lines if l["y1"] < max(page_h * 0.3, 16 * H)]
    for l in top:
        t = l["text"].replace(" ", "").replace("＝", "=").replace("♭", "b").replace("♯", "#")
        m = re.search(r"1=([#b]?)([A-Ga-g])([#b]?)", t)
        if m:
            acc = m.group(1) or m.group(3)
            head["tonic"] = m.group(2).upper() + acc
            head["_key_line"] = l
            rest = t[m.end():]
            m2 = re.match(r"([1-9])/?([248])", rest)
            if m2:
                head["time"] = (int(m2.group(1)), int(m2.group(2)))
        m = re.search(r"=\s*(\d{2,3})\b", t)
        if m and "1=" not in t[:m.start() + 1] and 30 <= int(m.group(1)) <= 240:
            head["tempo"] = int(m.group(1))
    # the time signature is often its own little line right after "1=..": two stacked digits read as "44"
    kl = head.get("_key_line")
    if kl:
        for l in top:
            t = l["text"].replace(" ", "")
            if l is kl or l["x0"] < kl["x0"] or l["x0"] > kl["x1"] + 3 * (kl["y1"] - kl["y0"]):
                continue
            if abs((l["y0"] + l["y1"]) / 2 - (kl["y0"] + kl["y1"]) / 2) > (kl["y1"] - kl["y0"]):
                continue
            m = re.fullmatch(r"([1-9])/?([248])", t)
            if m:
                head["time"] = (int(m.group(1)), int(m.group(2)))
    # title: the biggest Chinese text near the top
    cands = [l for l in top if CJK.search(l["text"]) and "作" not in l["text"] and "演唱" not in l["text"] and "记谱" not in l["text"]]
    if cands:
        big = max(cands, key=lambda l: l["y1"] - l["y0"])
        same = [l for l in cands if abs(l["y0"] - big["y0"]) < 0.3 * (big["y1"] - big["y0"]) and (l["y1"] - l["y0"]) > 0.8 * (big["y1"] - big["y0"])]
        head["title"] = "".join(l["text"] for l in sorted(same, key=lambda l: l["x0"])).strip()
        head["_title_y"] = big["y1"]
    return head


# ----------------------------------------------------------------------------- pitch spelling
def tonic_pitch(tonic):
    letter, acc = tonic[0], tonic[1:]
    semi = STEP_SEMI[letter] + (1 if acc == "#" else -1 if acc == "b" else 0)
    octave = 4 if (semi % 12) <= 6 and not (letter == "C" and acc == "b") else 3
    return letter, semi % 12, octave


def note_name(tonic, degree, octave_shift, acc):
    """Scale degree (1-7) in the key of `tonic` -> app pitch like 'Bb3' or 'F#4'."""
    t_letter, t_semi, t_oct = tonic_pitch(tonic)
    li = (LETTERS.index(t_letter) + degree - 1)
    letter = LETTERS[li % 7]
    midi = 12 * (t_oct + 1) + t_semi + MAJOR[degree - 1] + 12 * octave_shift + acc
    octave = midi // 12 - 1
    # the letter may sit in the next octave up (e.g. degree 7 of key A is G#, below A? no: above)
    natural = STEP_SEMI[letter]
    diff = (midi % 12) - natural
    if diff > 6:
        diff -= 12
    if diff < -6:
        diff += 12
    octave = (midi - diff) // 12 - 1
    alt = {0: "", 1: "#", 2: "##", -1: "b", -2: "bb"}.get(diff)
    if alt is None:
        return None
    return f"{letter}{alt}{octave}"


DUR_NAMES = [(4, "w"), (3, "h."), (2, "h"), (1.5, "q."), (1, "q"), (0.75, "8."), (0.5, "8"), (0.375, "16."), (0.25, "16"), (0.125, "32")]


def split_beats(beats):
    """A length in beats as app durations, e.g. 2.5 -> ['h', '8'] (tied)."""
    out, left = [], beats
    while left > 1e-6:
        for b, name in DUR_NAMES:
            if b <= left + 1e-6:
                out.append(name)
                left -= b
                break
        else:
            break
    return out


# ----------------------------------------------------------------------------- the reader
class JianpuReader:
    def __init__(self):
        self.ocr = Ocr()

    def read(self, img):
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY) if img.ndim == 3 else img
        # 1. normalise size: digits about 30 px tall
        comps, _ = components(binarize(gray))
        H = digit_height(comps)
        if H and H < 26:
            f = 30 / H
            gray = cv2.resize(gray, None, fx=f, fy=f, interpolation=cv2.INTER_CUBIC)
            img = cv2.resize(img, None, fx=f, fy=f, interpolation=cv2.INTER_CUBIC) if img.ndim == 3 else gray
        binary = binarize(gray)
        comps, lab = components(binary)
        self._lab_cur = lab
        H = digit_height(comps) or 30
        page_h, page_w = gray.shape

        # 2. text lines
        lines = self.ocr.lines(img if img.ndim == 3 else cv2.cvtColor(gray, cv2.COLOR_GRAY2BGR))
        head = parse_header(lines, page_h, H)
        # Lines of Chinese text (lyrics, title, credits). A dash "-" reads as the character 一, so a line
        # of notes and dashes isn't text: only count characters other than 一.
        def is_text(l):
            t = l["text"].replace(" ", "")
            n = len([ch for ch in CJK.findall(t) if ch != "一"])
            return n >= 1 and n >= 0.3 * len(t)
        cjk_lines = [l for l in lines if is_text(l)]
        # lines with several Latin letters (a web address, "JP-Word", "solan sister") aren't music either
        latin_lines = [l for l in lines if len(re.findall(r"[A-Za-z]", l["text"])) >= 4]

        def in_text(c):
            for l in cjk_lines:
                if l["x0"] - 2 <= c["cx"] <= l["x1"] + 2 and l["y0"] - 2 <= c["cy"] <= l["y1"] + 2:
                    return True
            return False

        # 3. rows of digit-sized shapes
        cand = [c for c in comps if 0.75 * H <= c["h"] <= 1.3 * H and 0.18 * H <= c["w"] <= 1.0 * H and not in_text(c)]
        cand.sort(key=lambda c: c["cy"])
        rows = []
        for c in cand:
            if rows and abs(c["cy"] - rows[-1]["cy"]) < 0.45 * H:
                r = rows[-1]
                r["items"].append(c)
                r["cy"] = float(np.median([d["cy"] for d in r["items"]]))
            else:
                rows.append({"cy": c["cy"], "items": [c]})
        rows = [r for r in rows if len(r["items"]) >= 4]

        def texty(r):
            # most of the row's shapes sit inside lines of ordinary text (a footer, a credits line)
            inside = sum(1 for c in r["items"] if any(l["x0"] - 2 <= c["cx"] <= l["x1"] + 2 and l["y0"] - 2 <= c["cy"] <= l["y1"] + 2 for l in latin_lines))
            return inside >= 0.5 * len(r["items"])
        rows = [r for r in rows if not texty(r)]
        # skip rows that are really the header (key/time) line
        kl = head.get("_key_line")
        if kl:
            rows = [r for r in rows if not (kl["y0"] - H <= r["cy"] <= kl["y1"] + H)]

        # 4. identify each digit
        crops, owners = [], []
        for r in rows:
            for c in r["items"]:
                pad = int(0.35 * H)
                y0, y1 = max(0, c["y"] - pad), min(page_h, c["y"] + c["h"] + pad)
                x0, x1 = max(0, c["x"] - pad), min(page_w, c["x"] + c["w"] + pad)
                mask = (lab[y0:y1, x0:x1] == c["i"])
                crop = np.full(mask.shape, 255, np.uint8)
                crop[mask] = 0
                crop = cv2.copyMakeBorder(crop, 6, 6, 10, 10, cv2.BORDER_CONSTANT, value=255)
                crops.append(cv2.cvtColor(crop, cv2.COLOR_GRAY2BGR))
                owners.append(c)
        for c, (txt, sc) in zip(owners, self.ocr.read_glyphs(crops)):
            t = txt[:1] if txt else ""
            t = OCR_FIX.get(t, t)
            c["glyph"] = t if (t in DIGITS or t == "X") else None
            c["score"] = sc
            # a "1" is a thin upright stroke: guard against bar lines and parentheses read as "1"
            if c["glyph"] == "1" and c["w"] < 0.14 * H:
                c["glyph"] = None
        used = set()
        music_rows = []
        for r in rows:
            notes = sorted([c for c in r["items"] if c.get("glyph")], key=lambda c: c["x"])
            if len(notes) < 3:
                continue
            top = float(np.median([c["y"] for c in notes]))
            bottom = float(np.median([c["y"] + c["h"] for c in notes]))
            music_rows.append({"notes": notes, "top": top, "bottom": bottom, "mid": (top + bottom) / 2})
            used.update(c["i"] for c in notes)

        # 5. the small marks around each row
        # Small marks inside a lyric line's box are lyric punctuation, unless they're dots hugging a music row
        # (the box of the lyric line often reaches up over the octave dots of the notes above it).
        row_bottoms = [r["bottom"] for r in music_rows]
        row_tops = [r["top"] for r in music_rows]

        def near_row_below(c):
            # (and a dot just above a row: the box of the lyric line above can reach down over it too)
            dot = max(c["w"], c["h"]) <= 0.42 * H and (any(b <= c["cy"] <= b + 0.6 * H for b in row_bottoms)
                                                      or any(t - 0.6 * H <= c["cy"] <= t for t in row_tops))
            underline = c["w"] >= 0.3 * H and c["h"] <= 0.65 * H and any(b - 0.1 * H <= c["y"] <= b + 0.6 * H for b in row_bottoms)
            return dot or underline

        small = [c for c in comps if c["i"] not in used and (not in_text(c) or near_row_below(c))]
        # A lyric character the text reader missed falls apart into strokes, and a short stroke inside it looks
        # like a dot. No real dot sits inside the outline of a character-sized shape, so drop those.
        chars = [c for c in comps if c["i"] not in used and 0.8 * H <= c["h"] <= 1.6 * H and 0.6 * H <= c["w"] <= 1.6 * H]
        def inside_char(c):
            if max(c["w"], c["h"]) > 0.42 * H:
                return False
            return any(o["x"] < c["x"] and c["x"] + c["w"] < o["x"] + o["w"] and o["y"] < c["y"] and c["y"] + c["h"] < o["y"] + o["h"]
                       for o in chars if o is not c)
        small = [c for c in small if not inside_char(c)]
        for k, r in enumerate(music_rows):
            top, bottom, mid = r["top"], r["bottom"], r["mid"]
            prev_bottom = music_rows[k - 1]["bottom"] if k else -1e9
            next_top = music_rows[k + 1]["top"] if k + 1 < len(music_rows) else 1e9
            for n in r["notes"]:
                n.update(up=0, down=0, lines=0, dot=0, dashes=0, acc=0)
            r["bars"] = []
            r["dashes"] = []
            notes = r["notes"]
            # grace notes: digit-shaped but small, sitting high (top half of the row or above it)
            graces = [c for c in small if 0.3 * H <= c["h"] <= 0.72 * H and 0.25 * H <= c["w"] <= 0.6 * H
                      and top - 1.0 * H <= c["y"] and c["cy"] <= mid and c["a"] >= 0.2 * c["w"] * c["h"]]

            def owner(x, slack=0.25):
                best = None
                for n in notes:
                    if n["x"] - slack * H <= x <= n["x"] + n["w"] + slack * H:
                        d = abs(n["cx"] - x)
                        if best is None or d < abs(best["cx"] - x):
                            best = n
                return best

            for c in small:
                if c["cy"] < top - 1.8 * H or c["cy"] > bottom + 1.8 * H:
                    continue
                if c["cy"] < (prev_bottom + top) / 2 or c["cy"] > (bottom + next_top) / 2:
                    continue
                w, h = c["w"], c["h"]
                fill = c["a"] / max(1, w * h)
                # dots: small and solid, but not a crumb (the tip of a slur can break off as a few pixels)
                roundish = 0.55 <= w / max(h, 1) <= 1.8 and max(w, h) <= 0.42 * H and max(w, h) >= 0.17 * H and fill >= 0.45
                tall = h >= 1.05 * H and w <= 0.22 * H and c["y"] <= top + 0.1 * H and c["y"] + h >= bottom - 0.1 * H
                if tall:
                    r["bars"].append(c["cx"])
                elif roundish and c["cy"] < top:
                    n = owner(c["cx"])
                    if n is not None:
                        n["up"] += 1
                elif roundish and c["cy"] > bottom:
                    n = owner(c["cx"])
                    if n is not None:
                        n["down"] += 1
                elif roundish and abs(c["cy"] - mid) <= 0.2 * H and fill >= 0.65:
                    # (solid: a slide or glissando squiggle breaks into hollow little pieces)
                    # a dot after a note (dotted rhythm), at mid height to its right
                    left = [n for n in notes if n["x"] + n["w"] <= c["cx"] <= n["x"] + n["w"] + 0.9 * H]
                    if left:
                        max(left, key=lambda n: n["x"])["dot"] += 1
                elif c["y"] >= bottom - 0.1 * H and c["y"] < bottom + 0.9 * H and w >= 0.3 * H:
                    # underlines, possibly touching the octave dots hanging below them
                    self._underlines_and_dots(c, notes, owner, H)
                elif (0.4 * H <= w <= 1.4 * H and h <= 0.3 * H and fill >= 0.6
                      and abs(c["cy"] - mid) <= 0.25 * H):
                    # a dash: a solid level bar at mid height, clear of the next note (a grace note's slash isn't)
                    nxt = [n for n in notes if n["x"] >= c["x"] + w]
                    grace = any(g["x"] - 0.4 * H <= c["cx"] <= g["x"] + g["w"] + 0.4 * H and g["cy"] < c["cy"] for g in graces)
                    if not grace and (not nxt or nxt[0]["x"] - (c["x"] + w) >= 0.12 * H):
                        r["dashes"].append(c["cx"])
                elif 0.4 * H <= h <= 1.0 * H and w <= 0.75 * H and c["y"] < mid and c["y"] + h > top:
                    # "#"/"b" just before a digit, raised a little
                    right = [n for n in notes if -0.05 * H <= n["x"] - (c["x"] + w) <= 0.45 * H]
                    if right:
                        r.setdefault("accs", []).append((c, right[0]))
                elif c["y"] + h <= top + 0.15 * H and w >= 0.9 * H and w >= 2.2 * h and fill <= 0.4:
                    # an arc above the notes: a tie (same note) or a slur
                    r.setdefault("arcs", []).append(c)
            self._ties(r, H)
        self._accidentals(music_rows, lab, gray, H)
        self._cross_row_ties(music_rows, H)
        self._lab, self._H = lab, H
        # for lyrics, any Chinese text between music rows counts, 一 included (it's only a dash inside a row)
        lyric_lines = [l for l in lines if CJK.search(l["text"])
                       and not any(r["top"] - 0.2 * H <= (l["y0"] + l["y1"]) / 2 <= r["bottom"] + 0.2 * H for r in music_rows)]
        return head, music_rows, lyric_lines, H

    def _underlines_and_dots(self, c, notes, owner, H):
        """A shape under the notes: one or more underlines, and octave dots that may touch them."""
        mask = (self._lab_cur[c["y"]:c["y"] + c["h"], c["x"]:c["x"] + c["w"]] == c["i"]).astype(np.uint8)
        counts = mask.sum(axis=1)
        # a pixel row belongs to an underline if it runs most of the shape's width, and is clearly wider
        # than a dot (under a single short note, a dot can fill most of the width too)
        line_rows = (counts >= 0.6 * c["w"]) & (counts >= 0.45 * H)
        # each run of full rows is one underline
        runs, prev = 0, False
        for v in line_rows:
            if v and not prev:
                runs += 1
            prev = v
        # a real underline shape starts with a line at its top (dots hang below it); a shape that
        # starts with short strokes is the top of a lyric character sitting close under the notes
        if runs == 0 or not line_rows[:3].any():
            return
        for n in notes:
            if c["x"] - 0.1 * H <= n["cx"] <= c["x"] + c["w"] + 0.1 * H:
                n["lines"] += runs
        # what's left after removing the lines: dots hanging below them
        rest = mask.copy()
        rest[line_rows] = 0
        k, _, st, _ = cv2.connectedComponentsWithStats(rest, 8)
        last_line = int(np.nonzero(line_rows)[0].max())
        for j in range(1, k):
            x, y, w, h, a = st[j]
            if y > last_line and 0.08 * H <= max(w, h) <= 0.42 * H and 0.5 <= w / max(h, 1) <= 2:
                n = owner(c["x"] + x + w / 2)
                if n is not None:
                    n["down"] += 1

    def _ties(self, r, H):
        """Arcs joining two notes of the same pitch are ties: the second note continues the first."""
        notes = r["notes"]
        for a in r.get("arcs", []):
            x0, x1 = a["x"], a["x"] + a["w"]
            start = min(notes, key=lambda n: abs(n["cx"] - x0))
            end = min(notes, key=lambda n: abs(n["cx"] - x1))
            si = notes.index(start)
            if abs(start["cx"] - x0) > 0.8 * H:
                continue
            if x1 > notes[-1]["cx"] + 0.6 * H and start is notes[-1]:
                start["tie_next_row"] = True        # continues on the next row
                continue
            if abs(end["cx"] - x1) > 0.8 * H or notes.index(end) != si + 1:
                continue
            if all(start[k] == end[k] for k in ("glyph", "up", "down")) and start["glyph"] not in ("0", "X"):
                start["tie"] = True

    def _cross_row_ties(self, rows, H):
        for a, b in zip(rows, rows[1:]):
            s = a["notes"][-1]
            if s.get("tie_next_row") and b["notes"]:
                e = b["notes"][0]
                if all(s[k] == e[k] for k in ("glyph", "up", "down")):
                    s["tie"] = True

    def _accidentals(self, rows, lab, gray, H):
        crops, owners = [], []
        for r in rows:
            for c, n in r.get("accs", []):
                pad = int(0.25 * H)
                y0, y1 = max(0, c["y"] - pad), c["y"] + c["h"] + pad
                x0, x1 = max(0, c["x"] - pad), c["x"] + c["w"] + pad
                m = (lab[y0:y1, x0:x1] == c["i"])
                crop = np.full(m.shape, 255, np.uint8)
                crop[m] = 0
                crop = cv2.copyMakeBorder(crop, 6, 6, 10, 10, cv2.BORDER_CONSTANT, value=255)
                crops.append(cv2.cvtColor(crop, cv2.COLOR_GRAY2BGR))
                owners.append(n)
        for n, (txt, sc) in zip(owners, self.ocr.read_glyphs(crops)):
            t = txt[:1]
            if t in ("#", "♯", "井", "#"):
                n["acc"] = 1
            elif t in ("b", "♭", "þ", "h"):
                n["acc"] = -1

    # ------------------------------------------------------------------ to app notation
    def to_score(self, img, title_hint="", hint=None, first_bar=1):
        """hint: {"tonic": "Bb", "time": (3, 4)} from an earlier page, used when this page doesn't print "1=..".
        first_bar: the number of this page's first bar, so pages after the first carry on counting."""
        head, rows, cjk_lines, H = self.read(img)
        # A "title" below the first row of music is a lyric line on a page that has no title of its own.
        if rows and head.get("_title_y", 0) > rows[0]["top"]:
            head["title"] = ""
        if hint and "_key_line" not in head:
            head["tonic"] = hint.get("tonic") or head["tonic"]
            head["time"] = hint.get("time") or head["time"]
        tonic = head["tonic"]
        num, den = head["time"]
        bar_beats = num * 4 / den
        events = []   # (kind, x-order) per row: notes, dashes, bars
        for r in rows:
            seq = [("n", n["cx"], n) for n in r["notes"]] + [("-", x, None) for x in r["dashes"]] + [("|", x, None) for x in r["bars"]]
            seq.sort(key=lambda t: t[1])
            events.append((r, seq))

        # lyrics: Chinese lines between this row and the next
        def lyric_lines(k):
            r = rows[k]
            lo = r["bottom"]
            # under the last row, only a few lines of verses; further down is the page's footer
            hi = rows[k + 1]["top"] if k + 1 < len(rows) else lo + 6 * H
            # Lyrics are Chinese words: lines with Latin letters or long numbers are credits, web
            # addresses or QQ numbers.
            ls = [l for l in cjk_lines if lo < (l["y0"] + l["y1"]) / 2 < hi
                  and len(re.findall(r"[A-Za-z]", l["text"])) < 2 and not re.search(r"\d{4}", l["text"])]
            # group into visual lines by y
            ls.sort(key=lambda l: l["y0"])
            groups = []
            for l in ls:
                if groups and abs(l["y0"] - groups[-1][0]["y0"]) < 0.5 * (l["y1"] - l["y0"]):
                    groups[-1].append(l)
                else:
                    groups.append([l])
            return [[ch for l in g for ch in l["chars"]] for g in groups]

        measures, cur, cur_beats = [], [], 0.0
        n_verses = 1
        for k, (r, seq) in enumerate(events):
            verses = lyric_lines(k)
            n_verses = max(n_verses, len(verses))
            pitched = [n for n in r["notes"] if n["glyph"] not in ("0", "X")]
            for vi, chars in enumerate(verses):
                for ch in chars:
                    c = ch["ch"]
                    if not CJK.search(c):
                        continue
                    x = (ch["x0"] + ch["x1"]) / 2
                    best = min(pitched, key=lambda n: abs(n["cx"] - x), default=None)
                    if best is not None and abs(best["cx"] - x) < 0.9 * H:
                        best.setdefault("lyr", {})[vi] = best.get("lyr", {}).get(vi, "") + c
            for kind, x, n in seq:
                if kind == "|":
                    if cur:
                        measures.append(cur)
                    cur, cur_beats = [], 0.0
                elif kind == "-":
                    if cur and cur[-1]["kind"] == "note":
                        cur[-1]["beats"] += 1
                    elif cur:
                        cur[-1]["beats"] += 1
                else:
                    beats = 1.0 / (2 ** n["lines"])
                    if n["dot"]:
                        beats *= 1.5
                    if n["glyph"] in ("0", "X"):
                        cur.append({"kind": "rest", "beats": beats})
                    else:
                        cur.append({"kind": "note", "beats": beats, "deg": int(n["glyph"]), "oct": n["up"] - n["down"],
                                    "acc": n["acc"], "lyr": n.get("lyr", {}), "tie": bool(n.get("tie"))})
        if cur:
            measures.append(cur)

        title = head["title"] or title_hint or "简谱"
        fifths = KEY_FIFTHS.get(tonic, 0)
        out = [f"TITLE: {title}", f"TEMPO: {head['tempo'] or 80}", f"KEY: {fifths} major", f"TIME: {num}/{den}",
               "PART P1 | 演唱 | vocal | treble",
               f"# jianpu 1={tonic} {num}/{den}"]   # read back by the app to read the next page in the same key
        for i, m in enumerate(measures, first_bar):
            toks = []
            for e in m:
                durs = split_beats(e["beats"]) or ["q"]
                if e["kind"] == "rest":
                    toks += [f"r:{d}" for d in durs]
                    continue
                name = note_name(tonic, e["deg"], e["oct"], e["acc"]) if 1 <= e["deg"] <= 7 else None
                if not name:
                    toks += [f"r:{d}" for d in durs]
                    continue
                lyr = "".join(f'"{e["lyr"].get(v, "")}"' for v in range(n_verses)) if e["lyr"] else ""
                for j, d in enumerate(durs):
                    tie = "~" if (j < len(durs) - 1 or e.get("tie")) else ""
                    toks.append(f"{name}:{d}{tie}{lyr if j == 0 else ''}")
            out.append(f"M {i}")
            out.append("P1.1: " + (" ".join(toks) if toks else "R"))
        return "\n".join(out) + "\n", {"rows": len(rows), "bars": len(measures), "tonic": tonic, "time": f"{num}/{den}", "H": H}


if __name__ == "__main__":
    import sys
    rd = JianpuReader()
    for p in sys.argv[1:]:
        text, info = rd.to_score(cv2.imread(p))
        print("==", p, info)
        print(text[:1500])
