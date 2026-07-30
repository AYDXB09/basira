# ============================================================================
# bridge.py — local bridge for Basira.
#   * Neural TTS                                          GET /tts
#   * Chrome EXTENSION long-poll                          GET /extension/wait
#                                                         POST /extension/result
#                                                         GET /extension/status
#   * Classroom live (= wait for extension, then CDP)     GET /classroom/live
#   * Demo sandbox                                        GET /classroom/summary|…
#   * health                                              GET /ping
# ============================================================================
import asyncio
import json
import os

import threading
import time
import uuid
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

import edge_tts

PORT = 8790
DEFAULT_VOICE = "en-US-EmmaMultilingualNeural"
HERE = os.path.dirname(os.path.abspath(__file__))
CLASSROOM_URL = "https://classroom.google.com/"

_lock = threading.Lock()
_jobs = {}          # id -> job dict
_pending = []       # job ids waiting for extension
_results = {}       # id -> result
_progress = {}      # id -> {status, url, screenshot, done}
_extension_state = {"last_seen": 0.0}



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


def create_job(action: str = "scrape-classroom") -> str:
    jid = uuid.uuid4().hex[:12]
    with _lock:
        _jobs[jid] = {"id": jid, "action": action, "created": time.time()}
        _pending.append(jid)
        _progress[jid] = {
            "status": "queued",
            "url": "https://classroom.google.com/",
            "screenshot": None,
            "done": False,
        }
    return jid


def take_job():
    with _lock:
        if not _pending:
            return None
        jid = _pending.pop(0)
        return _jobs.get(jid)


def put_progress(jid: str, **kwargs):
    with _lock:
        cur = dict(_progress.get(jid) or {})
        cur.update(kwargs)
        # keep last screenshot if new one omitted
        if "screenshot" in kwargs and not kwargs["screenshot"]:
            cur["screenshot"] = (_progress.get(jid) or {}).get("screenshot")
        _progress[jid] = cur


def put_result(jid: str, result: dict):
    with _lock:
        _results[jid] = result
        cur = dict(_progress.get(jid) or {})
        cur["done"] = True
        cur["result"] = {k: result.get(k) for k in (
            "ok", "reason", "hint", "mode", "course", "courses",
            "materials", "courseWork", "rawPreview", "announcements"
        ) if k in result}
        if result.get("screenshot"):
            cur["screenshot"] = result.get("screenshot")
        if result.get("url"):
            cur["url"] = result.get("url")
        cur["status"] = "done" if result.get("ok") else (result.get("reason") or "done")
        _progress[jid] = cur


def get_progress(jid: str):
    with _lock:
        return dict(_progress.get(jid) or {"done": True, "status": "unknown"})


def wait_result(jid: str, timeout: float = 55.0):
    end = time.time() + timeout
    while time.time() < end:
        with _lock:
            if jid in _results:
                return _results.pop(jid)
        time.sleep(0.25)
    return None


def classroom_via_extension(timeout: float = 50.0) -> dict:
    """Preferred path: Chrome extension scrapes the user's real tabs."""
    jid = create_job("scrape-classroom")
    result = wait_result(jid, timeout=timeout)
    if result is None:
        return {
            "ok": False,
            "reason": "extension-timeout",
            "hint": "Install/enable the Basira extension and keep Chrome open. Popup should show bridge online.",
            "jobId": jid,
        }
    result.setdefault("mode", "extension")
    result["jobId"] = jid
    return result



def classroom_via_playwright() -> dict:
    try:
        from classroom_live import scrape_classroom
        return scrape_classroom()
    except Exception as exc:
        return {"ok": False, "reason": "playwright-error", "hint": str(exc)[:300]}


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def _send(self, code: int, ctype: str, body: bytes):
        self.send_response(code)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _json(self, obj, code: int = 200):
        # Keep extension JPEG screenshots (quality~50) under ~900KB string length
        if isinstance(obj, dict) and obj.get("screenshot") and len(str(obj["screenshot"])) > 900_000:
            obj = dict(obj)
            obj["screenshot"] = None
        self._send(code, "application/json", json.dumps(obj).encode())

    def do_OPTIONS(self):
        self._send(204, "text/plain", b"")

    def do_POST(self):
        url = urlparse(self.path)
        length = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(length) if length else b"{}"
        try:
            body = json.loads(raw.decode("utf-8") or "{}")
        except Exception:
            body = {}

        if url.path == "/extension/result":
            jid = body.get("id")
            if not jid:
                return self._json({"ok": False, "error": "missing id"}, 400)
            put_result(jid, body)
            return self._json({"ok": True})

        if url.path == "/extension/progress":
            jid = body.get("id")
            if not jid:
                return self._json({"ok": False, "error": "missing id"}, 400)
            put_progress(
                jid,
                status=body.get("status"),
                url=body.get("url"),
                screenshot=body.get("screenshot"),
                cursor=body.get("cursor"),
            )
            return self._json({"ok": True})

        return self._json({"error": "not found"}, 404)

    def do_GET(self):
        url = urlparse(self.path)
        q = parse_qs(url.query)

        if url.path == "/ping":
            return self._json({"ok": True, "extensionPending": len(_pending)})

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

        if url.path == "/extension/status":
            with _lock:
                pending = len(_pending)
                last_seen = _extension_state["last_seen"]
            age = (time.time() - last_seen) if last_seen else None
            return self._json({
                "ok": True,
                "pending": pending,
                "online": bool(age is not None and age < 32),
                "lastSeenSeconds": round(age, 1) if age is not None else None,
            })

        # Extension long-poll: holds until a job appears or timeout
        if url.path == "/extension/wait":
            _extension_state["last_seen"] = time.time()
            timeout = float((q.get("timeout") or ["25"])[0])
            end = time.time() + max(5.0, min(timeout, 28.0))
            while time.time() < end:
                job = take_job()
                if job:
                    return self._json(job)
                time.sleep(0.3)
            return self._json({"id": None})

        if url.path == "/classroom/live-start":
            jid = create_job("scrape-classroom")
            return self._json({"ok": True, "jobId": jid})

        if url.path == "/extension/progress" or url.path == "/classroom/live-status":
            jid = (q.get("id") or [""])[0]
            if not jid:
                return self._json({"ok": False, "error": "missing id"}, 400)
            prog = get_progress(jid)
            # Don't drop screenshots on progress (just shank empty)
            return self._json({"ok": True, **prog})

        if url.path == "/classroom/open":
            try:
                webbrowser.open(CLASSROOM_URL)
                return self._json({"ok": True, "opened": CLASSROOM_URL})
            except Exception as exc:  # noqa: BLE001
                return self._json({"ok": False, "error": str(exc)}, 500)

        if url.path == "/classroom/live":
            # Blocking path (still works). Prefer live-start + progress for UI.
            ext = classroom_via_extension(timeout=45.0)
            if ext.get("ok") or ext.get("reason") == "login-required":
                return self._json(ext)
            pw = classroom_via_playwright()
            if not pw.get("ok") and ext.get("reason"):
                pw = dict(pw)
                pw["extensionNote"] = ext
            return self._json(pw)

        if url.path == "/classroom/summary":
            data = load_classroom()
            course = data["course"]
            return self._json({
                "course": course["name"],
                "teacher": course["teacher"],
                "materialCount": len(data["materials"]),
                "materials": [m["title"] for m in data["materials"]],
                "courseworkCount": len(data["courseWork"]),
                "coursework": [{"title": w["title"], "due": w["due"]} for w in data["courseWork"]],
                "announcements": data["announcements"],
            })

        if url.path == "/classroom/materials":
            return self._json(load_classroom()["materials"])

        if url.path == "/classroom/coursework":
            return self._json(load_classroom()["courseWork"])

        return self._json({"error": "not found"}, 404)


if __name__ == "__main__":
    print(f"Bridge on http://127.0.0.1:{PORT}")
    print("  Install extension from basira/extension (Load unpacked)")
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
