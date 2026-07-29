# ============================================================================
# bridge.py — local bridge for the Voice Tutor.
#   * Neural TTS (Microsoft edge-tts)                 GET /tts?text&voice
#   * Google Classroom sandbox                        GET /classroom/summary|materials|coursework
#   * Open Google Classroom in the OS browser         GET /classroom/open
#   * Live scrape hook (optional Playwright later)    GET /classroom/live
#   * health                                          GET /ping
# Run:  python bridge\bridge.py
# ============================================================================
import asyncio
import json
import os
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

import edge_tts

PORT = 8790
DEFAULT_VOICE = "en-US-EmmaMultilingualNeural"
HERE = os.path.dirname(os.path.abspath(__file__))
CLASSROOM_URL = "https://classroom.google.com/"


def load_classroom() -> dict:
    with open(os.path.join(HERE, "classroom_data.json"), encoding="utf-8") as f:
        return json.load(f)


def synth(text: str, voice: str) -> bytes:
    async def run() -> bytes:
        buf = bytearray()
        communicate = edge_tts.Communicate(text, voice)
        async for chunk in communicate.stream():
            if chunk["type"] == "audio":
                buf.extend(chunk["data"])
        return bytes(buf)
    return asyncio.run(run())


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def _send(self, code: int, ctype: str, body: bytes):
        self.send_response(code)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _json(self, obj, code: int = 200):
        self._send(code, "application/json", json.dumps(obj).encode())

    def do_GET(self):
        url = urlparse(self.path)
        q = parse_qs(url.query)

        if url.path == "/ping":
            return self._json({"ok": True})

        if url.path == "/tts":
            text = (q.get("text") or [""])[0].strip()
            voice = (q.get("voice") or [DEFAULT_VOICE])[0]
            if not text:
                return self._json({"error": "no text"}, 400)
            try:
                return self._send(200, "audio/mpeg", synth(text, voice))
            except Exception as exc:  # noqa: BLE001
                print("TTS error:", exc)
                return self._json({"error": str(exc)}, 500)

        if url.path == "/classroom/open":
            try:
                webbrowser.open(CLASSROOM_URL)
                return self._json({"ok": True, "opened": CLASSROOM_URL})
            except Exception as exc:  # noqa: BLE001
                return self._json({"ok": False, "error": str(exc)}, 500)

        if url.path == "/classroom/live":
            # Hook for future Playwright / Google Classroom OAuth live pull.
            return self._json({
                "ok": False,
                "reason": "live-not-configured",
                "hint": "Use /classroom/open then upload files, or say 'load demo class'."
            })

        if url.path == "/classroom/summary":
            data = load_classroom()
            course = data["course"]
            return self._json({
                "course": course["name"],
                "teacher": course["teacher"],
                "materialCount": len(data["materials"]),
                "materials": [m["title"] for m in data["materials"]],
                "courseworkCount": len(data["courseWork"]),
                "coursework": [
                    {"title": w["title"], "due": w["due"]} for w in data["courseWork"]
                ],
                "announcements": data["announcements"],
            })

        if url.path == "/classroom/materials":
            return self._json(load_classroom()["materials"])

        if url.path == "/classroom/coursework":
            return self._json(load_classroom()["courseWork"])

        return self._json({"error": "not found"}, 404)


if __name__ == "__main__":
    print(f"Bridge on http://127.0.0.1:{PORT}  (TTS + Classroom open/demo)")
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
