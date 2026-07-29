# Basira — hands-free voice tutor for blind learners

Pure black voice UI (REPLICATE-style orb). Opens as a conversation: speaks on load, always listens, interrupt by talking. Built for the MBZUAI-style accessibility hackathon track.

## Live demo (GitHub Pages)

After Pages is enabled (this push configures it):

**https://aydxb09.github.io/basira/**

### Will it fully work on GitHub Pages?

| Feature | On Pages (static HTTPS) | Local + `START.bat` / bridge |
|---|---|---|
| Orb + UI | Yes | Yes |
| Mic + Web Speech (Chrome) | Yes (HTTPS) — allow mic once | Yes |
| Camera | Yes | Yes |
| Upload files → teach | Yes (needs OpenRouter key) | Yes |
| Free conversation / quiz / pedagogy | Yes (needs OpenRouter key) | Yes |
| Google Classroom sandbox data | Yes (`data/classroom.json`) | Yes (bridge or static) |
| Neural Emma/Ava TTS (edge-tts) | **No** — falls back to **browser voice** | **Yes** (`bridge/bridge.py`) |
| Real Google Classroom OAuth | No (sandbox fixture only) | No (same; OAuth is future) |

**You must set an OpenRouter key in the browser** (key is **not** in the public repo):

```js
localStorage.setItem('basira.openRouterKey', 'sk-or-v1-...');
location.reload();
```

Local full quality: create `js/config.local.js` (gitignored) with  
`window.B_CONFIG.openRouterKey = 'sk-or-v1-...';` then double-click `START.bat`.

## Voice commands

- `connect my classroom` · `classroom mode` · `end class`
- `quiz mode` · `assignment mode`
- `change voice` · `repeat` · `stop` · `what can you do`
- free questions any time; barge-in by speaking

## Pedagogy sources

Research-backed rules in `js/pedagogy.js`. Citations: `data/SOURCES.md`.

## Local run

```bat
START.bat
```

Or: `python bridge/bridge.py` + `python -m http.server 8124` → http://localhost:8124

## Stack

- Browser: Web Speech STT, canvas camera, multimodal chat via OpenRouter (`qwen/qwen3.7-plus`)
- Optional bridge: Microsoft Edge neural TTS + Classroom JSON API
