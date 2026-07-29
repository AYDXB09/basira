# ============================================================================
# classroom_live.py — control Google Classroom via browser agent.
#
# Priority:
#   1) Attach to YOUR already-running Chrome if it was started with
#      remote debugging (port 9222) — see START-CHROME-DEBUG.bat
#   2) Else open a dedicated persistent Chrome profile (login once there)
# ============================================================================
from __future__ import annotations

import base64
import os
import re
import time
import urllib.request
from typing import Any, Optional

HERE = os.path.dirname(os.path.abspath(__file__))
PROFILE = os.path.join(HERE, "chrome-profile")
CLASSROOM_HOME = "https://classroom.google.com/"
CDP = os.environ.get("BASIRA_CDP", "http://127.0.0.1:9222")


def _try_import_playwright():
    try:
        from playwright.sync_api import sync_playwright  # type: ignore
        return sync_playwright
    except Exception:
        return None


def cdp_available(url: str = CDP) -> bool:
    try:
        with urllib.request.urlopen(url + "/json/version", timeout=1.2) as r:
            return r.status == 200
    except Exception:
        return False


def scrape_classroom(timeout_ms: int = 50000) -> dict[str, Any]:
    sync_playwright = _try_import_playwright()
    if not sync_playwright:
        return {
            "ok": False,
            "reason": "playwright-missing",
            "hint": "pip install playwright && python -m playwright install chromium",
        }

    started = time.time()
    mode = "profile"

    try:
        with sync_playwright() as p:
            context = None
            browser = None

            # --- 1) Prefer the browser YOU already use (CDP) ---
            if cdp_available():
                try:
                    browser = p.chromium.connect_over_cdp(CDP)
                    # Use default context (your real tabs/cookies)
                    context = browser.contexts[0] if browser.contexts else None
                    if context is None:
                        raise RuntimeError("no context on CDP")
                    mode = "cdp"
                except Exception as exc:
                    browser = None
                    context = None
                    mode = "profile-fallback:" + str(exc)[:80]

            # --- 2) Dedicated profile ---
            if context is None:
                os.makedirs(PROFILE, exist_ok=True)
                try:
                    context = p.chromium.launch_persistent_context(
                        user_data_dir=PROFILE,
                        headless=False,
                        channel="chrome",
                        args=["--disable-blink-features=AutomationControlled"],
                        viewport={"width": 1280, "height": 900},
                    )
                except Exception:
                    context = p.chromium.launch_persistent_context(
                        user_data_dir=PROFILE,
                        headless=False,
                        viewport={"width": 1280, "height": 900},
                    )
                mode = "profile"

            page = _pick_classroom_page(context)
            page.goto(CLASSROOM_HOME, wait_until="domcontentloaded", timeout=timeout_ms)
            page.wait_for_timeout(2500)

            url = page.url or ""
            title = page.title() or ""
            body_text = _safe_text(page)
            lower = (body_text + " " + title + " " + url).lower()

            if any(x in lower for x in (
                "sign in", "accounts.google.com", "identifierid",
                "to continue to google", "choose an account"
            )):
                shot = _shot(page)
                # Keep CDP browser alive; only close dedicated profile context lightly
                _maybe_close(context, mode)
                return {
                    "ok": False,
                    "reason": "login-required",
                    "mode": mode,
                    "hint": "Sign in in the Chrome window, then say connect classroom again.",
                    "url": url,
                    "screenshot": shot,
                    "elapsedMs": int((time.time() - started) * 1000),
                }

            courses = _collect_courses(page)
            assignment_bits: list[str] = []
            course_name = courses[0]["title"] if courses else ""

            if courses:
                try:
                    href = courses[0]["href"]
                    if href.startswith("/"):
                        href = "https://classroom.google.com" + href
                    page.goto(href, wait_until="domcontentloaded", timeout=timeout_ms)
                    page.wait_for_timeout(2000)
                    course_name = course_name or (page.title() or "your class")
                    for label in ("Classwork", "Stream", "Course work"):
                        try:
                            page.get_by_role("link", name=re.compile(label, re.I)).first.click(timeout=1500)
                            page.wait_for_timeout(1500)
                            break
                        except Exception:
                            pass
                    body2 = _safe_text(page)
                    for line in body2.splitlines():
                        line = line.strip()
                        if 8 <= len(line) <= 140:
                            assignment_bits.append(line)
                    assignment_bits = list(dict.fromkeys(assignment_bits))[:40]
                except Exception as exc:
                    assignment_bits = [f"(opened class but read failed: {exc})"]

            shot = _shot(page)
            _maybe_close(context, mode)

            materials = []
            works = []
            if assignment_bits:
                works.append({
                    "title": assignment_bits[0][:80],
                    "due": next((b for b in assignment_bits if "due" in b.lower()), ""),
                    "questions": assignment_bits[:12],
                })
                materials.append({
                    "title": "Pulled from Google Classroom",
                    "type": "scrape",
                    "text": "\n".join(assignment_bits[:30]),
                })

            return {
                "ok": True,
                "mode": mode,
                "course": {"name": course_name or (courses[0]["title"] if courses else "Google Classroom"), "teacher": ""},
                "courses": courses,
                "materials": materials,
                "courseWork": works,
                "announcements": [],
                "rawPreview": body_text[:1500],
                "screenshot": shot,
                "elapsedMs": int((time.time() - started) * 1000),
            }
    except Exception as exc:
        return {
            "ok": False,
            "reason": "scrape-error",
            "hint": str(exc)[:300],
            "elapsedMs": int((time.time() - started) * 1000),
        }


def _pick_classroom_page(context):
    # Prefer an existing Classroom tab if present
    for pg in context.pages:
        try:
            if "classroom.google.com" in (pg.url or ""):
                return pg
        except Exception:
            pass
    return context.pages[0] if context.pages else context.new_page()


def _collect_courses(page) -> list[dict[str, str]]:
    courses: list[dict[str, str]] = []
    try:
        for a in page.query_selector_all("a"):
            href = (a.get_attribute("href") or "")
            text = (a.inner_text() or "").strip()
            if not text or len(text) > 80:
                continue
            if "/c/" in href or "classroom.google.com/c/" in href:
                courses.append({"title": re.sub(r"\s+", " ", text), "href": href})
        seen = set()
        uniq = []
        for c in courses:
            k = c["title"].lower()
            if k in seen:
                continue
            seen.add(k)
            uniq.append(c)
        return uniq[:12]
    except Exception:
        return []


def _safe_text(page) -> str:
    try:
        return page.inner_text("body", timeout=5000)
    except Exception:
        return ""


def _shot(page) -> Optional[str]:
    try:
        raw = page.screenshot(full_page=False, type="jpeg", quality=55)
        return "data:image/jpeg;base64," + base64.b64encode(raw).decode("ascii")
    except Exception:
        return None


def _maybe_close(context, mode: str) -> None:
    # Never close the user's real Chrome (CDP). Only close our dedicated profile.
    if mode == "cdp":
        return
    try:
        context.close()
    except Exception:
        pass


if __name__ == "__main__":
    import json
    print(json.dumps({"cdp": cdp_available(), **{k: scrape_classroom().get(k) for k in ("ok", "mode", "reason", "hint", "elapsedMs")}}, indent=2))
