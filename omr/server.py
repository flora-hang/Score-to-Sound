"""Free note reading: a small web service around homr (https://github.com/liebharc/homr, AGPL-3.0).

It runs in a Cloudflare Container next to the app. The app's Worker sends it one page image at a
time and gets MusicXML back. homr is loaded once and kept in memory, so pages after the first are
faster. One page is read at a time; Cloudflare starts more containers when more people are reading.

  GET  /health        -> 200 "ok" once the readers are ready
  POST /read          -> staff notation. Body: a JPEG or PNG page; reply: MusicXML (200)
  POST /read-jianpu   -> 简谱. Body: a JPEG or PNG page; reply: the app's own score text (200)
  Errors are JSON {"error": {"code", "message"}} with a 4xx/5xx status.
"""
import json
import os
import re
import sys
import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlsplit

MAX_BYTES = 15 * 1024 * 1024
PORT = int(os.environ.get("PORT", "8080"))

_ready = threading.Event()
_lock = threading.Lock()          # homr reads one page at a time
_homr = {}


def log(*args):
    print(time.strftime("%H:%M:%S"), *args, file=sys.stderr, flush=True)


def load():
    t = time.time()
    import onnxruntime as ort
    from homr.main import ProcessingConfig, download_weights, process_image
    from homr.music_xml_generator import XmlGeneratorArguments
    from homr.title_detection import download_ocr_weights

    ort.set_default_logger_severity(3)
    download_weights(False, False, False)   # already in the image; this only checks
    download_ocr_weights()
    # debug, cache, write/read staff positions, all staffs, no GPU (x2), no CoreML, detect the title
    _homr["config"] = ProcessingConfig(False, False, False, False, -1, False, False, False, True)
    _homr["xml_args"] = XmlGeneratorArguments(False, None, None)
    _homr["process"] = process_image
    from jianpu import JianpuReader
    _homr["jianpu"] = JianpuReader()
    _ready.set()
    log(f"homr ready in {time.time() - t:.1f}s")


def read_page(data: bytes, suffix: str) -> str:
    with _lock, tempfile.TemporaryDirectory() as tmp:
        path = os.path.join(tmp, "page" + suffix)
        with open(path, "wb") as f:
            f.write(data)
        t = time.time()
        xml_path = _homr["process"](path, _homr["config"], _homr["xml_args"])
        with open(xml_path, encoding="utf-8") as f:
            xml = f.read()
        log(f"read a page in {time.time() - t:.1f}s ({len(data) // 1024} KB)")
        return xml


def read_jianpu(data: bytes, query: dict) -> str:
    """query (all optional, from earlier pages): key=Bb, time=3/4, bar=17 (number of this page's first bar)."""
    import cv2
    import numpy as np
    hint = {}
    key = (query.get("key") or [""])[0]
    if re.fullmatch(r"[A-G][#b]?", key):
        hint["tonic"] = key
    m = re.fullmatch(r"([1-9]|1[0-2])/([248]|16)", (query.get("time") or [""])[0])
    if m:
        hint["time"] = (int(m.group(1)), int(m.group(2)))
    bar = (query.get("bar") or ["1"])[0]
    first_bar = int(bar) if bar.isdigit() and 0 < int(bar) < 10000 else 1
    img = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_COLOR)
    if img is None:
        raise ValueError("not an image")
    with _lock:
        t = time.time()
        text, info = _homr["jianpu"].to_score(img, hint=hint, first_bar=first_bar)
        log(f"read a jianpu page in {time.time() - t:.1f}s: {info}")
    if info["bars"] == 0:
        raise ValueError("no music")
    return text


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *args):   # keep the logs to our own lines
        pass

    def reply(self, status, body, ctype):
        raw = body.encode("utf-8")
        self.send_response(status)
        self.send_header("content-type", ctype)
        self.send_header("content-length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def error(self, status, code, message):
        self.reply(status, json.dumps({"error": {"code": code, "message": message}}), "application/json")

    def do_GET(self):
        if self.path == "/health":
            if _ready.is_set():
                self.reply(200, "ok", "text/plain")
            else:
                self.error(503, "starting", "The note reader is starting.")
        else:
            self.error(404, "not_found", "Not found.")

    def do_POST(self):
        url = urlsplit(self.path)
        if url.path not in ("/read", "/read-jianpu"):
            return self.error(404, "not_found", "Not found.")
        size = int(self.headers.get("content-length") or 0)
        if size <= 0 or size > MAX_BYTES:
            return self.error(413, "too_big", "Send one page image of up to 15 MB.")
        data = self.rfile.read(size)
        ctype = (self.headers.get("content-type") or "").lower()
        suffix = ".png" if "png" in ctype or data[:8] == b"\x89PNG\r\n\x1a\n" else ".jpg"
        if not _ready.wait(timeout=120):
            return self.error(503, "starting", "The note reader is still starting. Please try again.")
        try:
            if url.path == "/read-jianpu":
                return self.reply(200, read_jianpu(data, parse_qs(url.query)), "text/plain; charset=utf-8")
            xml = read_page(data, suffix)
        except Exception as err:   # the readers raise plain exceptions for pages they can't make sense of
            log("could not read page:", repr(err)[:300])
            return self.error(422, "unreadable", "No music could be found on this page.")
        self.reply(200, xml, "application/vnd.recordare.musicxml+xml; charset=utf-8")


if __name__ == "__main__":
    threading.Thread(target=load, daemon=True).start()
    log(f"listening on {PORT}")
    ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()
