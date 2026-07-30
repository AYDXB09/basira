# Basira Edge/Chrome Extension — install (unpacked)

## Why an extension?
A normal website **cannot** control Chrome tabs you already have open.
An extension **can** — it runs in *your* Chrome with *your* Google login.
No closing tabs. No remote-debugging restart.

## Install (1 minute)
1. Start the Basira bridge: double-click `START.bat` (or `py bridge\bridge.py`)
2. Open Edge → `edge://extensions` (or Chrome → `chrome://extensions`)
3. Turn on **Developer mode** (top right)
4. **Load unpacked** → select this folder:
   ```
   basira/extension
   ```
5. Pin “Basira Classroom Bridge”
6. Click the icon — should say **bridge online**

## Demo tip
Keep **Google Classroom open and signed in** in this browser profile.
Assignment links to **Google Docs** (`docs.google.com/document/...`) will be opened and their body text read into materials (`type: gdoc`).  
A JPEG screenshot of the active page is included in the scrape result when possible.

## Use
In Basira say: **“connect my classroom”** / **“check my latest assignment”**

The extension will:
- Prefer and focus the Classroom tab you already have open
- Or open Classroom in a new tab if needed
- Scrape courses / classwork text
- Open linked Google Docs, pull document text (first ~12k chars), and leave the final Doc selected
- Capture a JPEG screenshot and send everything to Basira

## First-time Google login
If you’re not signed into Classroom in this browser profile, sign in normally, then ask again.

## Troubleshooting
| Popup says | Fix |
|---|---|
| bridge offline | Run the Basira bridge / START.bat |
| wake the worker | Click the extension icon once |
| login-required | Sign into Google Classroom in Chrome, retry |
