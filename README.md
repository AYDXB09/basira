# Basira — hands-free voice tutor for blind learners

**Live (UI):** https://aydxb09.github.io/basira/  
**Repo:** https://github.com/AYDXB09/basira  

Voice-first study companion: GPT Live audio (`gpt-audio-mini`), captions from the same transcript stream, camera/upload, classroom agent via **Chrome extension**.

---

## Can my teammates just use GitHub Pages + the extension?

| Feature | GitHub Pages only | Pages **+ extension** **+ local bridge** | Full local (`START.bat`) |
|---|---|---|---|
| Orb + voice chat (GPT Live) | ✅ (needs OpenRouter key) | ✅ | ✅ |
| Captions | ✅ | ✅ | ✅ |
| Camera / upload | ✅ | ✅ | ✅ |
| **Read THEIR Google Classroom** | ❌ | ✅ | ✅ |
| Neural edge-tts fallback | ❌ (browser voice backup) | ✅ via bridge | ✅ |

**Why Classroom needs the bridge:**  
The extension talks to `http://127.0.0.1:8790` on **that person’s machine**. A static GitHub Pages site cannot receive data from someone else’s Chrome. So:

- **Quick voice-only test** → open Pages, paste OpenRouter key, talk.  
- **Classroom test** → each person runs the **bridge** + installs the **extension** (1–2 minutes). They can still open the **Pages** UI or local `localhost:8124`.

They do **not** need Cursor or to understand the whole repo — just Pages (or local server) + bridge + extension.

---

## Teammate setup (recommended for full demo)

### A. Voice only (30 seconds)
1. Open https://aydxb09.github.io/basira/
2. Paste OpenRouter key in the box → Save  
3. Allow mic → talk  

### B. Voice + Google Classroom (what the demo needs)
1. **Clone or download** this repo (Code → Download ZIP).  
2. Install Python 3 + deps once:
   ```bat
   pip install edge-tts playwright
   python -m playwright install chromium
   ```
3. Double-click **`START.bat`** (starts bridge + web server).  
   - Or only: `python bridge\bridge.py` and open **Pages** for the UI.
4. **Install the extension** (see below).  
5. Say: *“connect my classroom”*.

### Install the Chrome extension (required for Classroom)
Folder in repo: **`extension/`**

1. Chrome → `chrome://extensions`  
2. **Developer mode** ON  
3. **Load unpacked** → select the `extension` folder inside this repo  
4. Pin **Basira Classroom Bridge**  
5. Click icon → should say **bridge online** (bridge must be running)

Full notes: [`extension/README.md`](extension/README.md)

---

## What “connect my classroom” does
1. Basira asks the local bridge for a live scrape.  
2. Bridge asks the **extension** (running in *your* Chrome, *your* login, open tabs OK).  
3. Extension opens/uses Classroom and sends class text back.  
4. GPT Live summarizes audibly + captions.

No need to close all tabs. No need for remote-debugging Chrome (that path is optional fallback).

---

## Voice commands (short)
- *connect my classroom* / *check my latest assignment*  
- *open Google Classroom*  
- *classroom mode* · *end class*  
- *quiz mode* · *assignment mode* (only with loaded class data)  
- *upload* · free conversation anytime · interrupt by talking  
- **D** or **Data** button → export session JSON (for debugging)

---

## Privacy
- Camera/mic processed in-browser where possible.  
- OpenRouter receives conversation text (and audio for GPT Live).  
- Extension only activates Classroom scrape when you ask.  
- API key stays in browser `localStorage` / `js/config.local.js` (gitignored) — **never commit keys**.

---

## Stack
- **Chat+voice:** `openai/gpt-audio-mini` (stream, audio+transcript) via OpenRouter  
- **Fallback text:** Qwen via OpenRouter + edge-tts / system voice  
- **Classroom:** Chrome extension → local bridge · Playwright fallback  
- **Telemetry:** `js/telemetry.js` session export  
