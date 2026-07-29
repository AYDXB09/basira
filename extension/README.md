# Basira Chrome Extension — install (unpacked)

## Why an extension?
A normal website **cannot** control Chrome tabs you already have open.
An extension **can** — it runs in *your* Chrome with *your* Google login.
No closing tabs. No remote-debugging restart.

## Install (1 minute)
1. Start the Basira bridge: double-click `START.bat` (or `python bridge\bridge.py`)
2. Open Chrome → `chrome://extensions`
3. Turn on **Developer mode** (top right)
4. **Load unpacked** → select this folder:
   ```
   basira/extension
   ```
5. Pin “Basira Classroom Bridge”
6. Click the icon — should say **bridge online**

## Use
In Basira say: **“connect my classroom”** / **“check my latest assignment”**

The extension will:
- Prefer a Classroom tab you already have open
- Or open Classroom in a new tab if needed
- Scrape courses / classwork text and send it to Basira

## First-time Google login
If you’re not signed into Classroom in this Chrome profile, sign جهود in normally, then ask again.

## Troubleshooting
| Popup says | Fix |
|---|---|
| bridge offline | Run the Basira bridge / START.bat |
| wake the worker | Click the extension icon once |
| login-required | Sign into Google Classroom in Chrome, retry |
