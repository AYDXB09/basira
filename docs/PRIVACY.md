# Privacy Policy

**Last updated: October 8, 2026**

Basira is a voice study tutor for blind learners. It is a small, independently built open-source
project with **no accounts, no backend, and no analytics**. This policy describes exactly where
your data goes, because with a voice, camera and school-content tool that matters more than usual.

## The short version

- **The developer receives nothing.** There is no Basira server, database, or user account. Nothing
  you say, show, or upload is sent to, or stored by, the project's author.
- **Your data does leave your device** to reach the AI and speech services that make Basira work —
  listed below. Those services are chosen by how the app is built, and you are the one sending the
  data to them using your own browser and your own API key.
- **Everything Basira stores locally stays in your browser** (`localStorage`) and can be cleared at
  any time.

## 1. What Basira handles, and where it goes

| What | Why | Where it goes |
|---|---|---|
| **Your voice (microphone)** | To hear what you ask | Speech-to-text uses your **browser's built-in speech recognition** (the Web Speech API). In Chrome and Edge this sends audio to the browser vendor's speech service (Google / Microsoft) — that is controlled by the browser, not by Basira. |
| **Your questions and the tutor's replies** | The conversation itself | Sent to **OpenRouter** (`openrouter.ai`), which routes them to the model provider (currently OpenAI models: `gpt-audio-mini` for voice and `gpt-4o-mini` for text, with `gpt-4o` and, as a last resort, Qwen as fallbacks). With GPT Live voice, your **audio** is also sent to OpenRouter. |
| **Camera frames** | To describe what is on a board, screen, or object | A resized JPEG of a single frame is captured in your browser and sent to OpenRouter. No video is stored. **In class mode, a frame is captured automatically about every 45 seconds** (and when the teacher says something like "look at this diagram"), and a frame can include people in the room. |
| **Other people's voices** | In class mode, the microphone transcribes the teacher and anyone speaking nearby | The transcript is built in your browser; the most recent part (up to ~6,000 characters) is sent to OpenRouter at the end of class for a recap. Anyone speaking is included, not just you. |
| **Files you upload** | Images, short videos, and plain-text files for Basira to read | Images are resized in your browser; videos are sampled into a few frames; text files are cut to the first 16,000 characters. The result is sent to OpenRouter. |
| **Google Classroom content** *(optional, only when you ask)* | To read your next assignment aloud | The Basira Chrome extension reads Classroom page text, text of linked Google Docs (first ~12,000 characters), and a low-quality screenshot of the page — **only when you say "connect my classroom"**. It hands that to a **local bridge on your own computer** (`127.0.0.1:8790`), and the app then sends the content to OpenRouter so the tutor can summarize it. See section 3. |
| **Spoken fallback voice** | If the primary voice path fails | Either your system's built-in voice (stays on your device) or `edge-tts` via the local bridge, which sends **the text to be spoken** to Microsoft's online text-to-speech service. |
| **Sample mode** | A fictional demo | Uses invented Grade 5 science data. A topic you ask about may be looked up on Wikipedia's public API. |

## 2. What stays on your device

Stored in your browser's `localStorage` on the device you use:

- Your **OpenRouter API key** (`basira.openRouterKey`) — never sent anywhere except to OpenRouter as
  your own credential.
- Your **settings** — language and profile (`basira.profile`), and any custom system prompt you saved
  (`basira.systemPrompt`).
- **Short memory notes** (`basira.memories`) used to personalize later sessions — for example the last
  ~500 characters of a class conversation. These are included in later prompts, which means they are
  sent to OpenRouter again in a future session.

**Session export.** The **Data** button (or pressing D) downloads a JSON file of the session — what
was said, what the tutor replied, timings, and your browser's user-agent string. It is saved to your
Downloads folder; **Basira does not upload it**. The first full reply of a session also triggers this
download automatically, so delete the file if you do not want to keep it.

To erase everything Basira stored, use **Clear saved key** in the key dialog, or clear this site's
data in your browser settings.

## 3. The Classroom extension and local bridge

Because a website cannot read your other tabs, Basira uses an optional Chrome/Edge extension plus a
small program that runs **only on your own computer**:

- The bridge listens on `127.0.0.1` only (not reachable from other devices on your network).
- The bridge accepts requests only from the hosted app, `localhost`, and the Basira extension, and
  refuses any other website's request. (Earlier versions accepted requests from any website; this was
  fixed on October 8, 2026.)
- The extension requests access only to `classroom.google.com`, `docs.google.com`, and your local
  bridge, plus the browser's `tabs` permission so it can find and focus your Classroom tab. It checks
  the local bridge for a job, and only reads a Classroom page when you ask Basira to connect.
- Classroom content may include **other people's information** (classmates' names, a teacher's
  comments). It is only read from the tab *you* are signed into, and sent to OpenRouter as described
  above. Only use this with a class and account you are entitled to use this way, and check your
  school's rules on AI tools first.

## 4. Third parties

| Service | Role | Their terms |
|---|---|---|
| **OpenRouter** and the model provider it routes to | Language and voice models | openrouter.ai/terms and openrouter.ai/privacy — and the underlying provider's own terms. Retention and training policies are theirs, not Basira's. |
| **Your browser vendor** (Google, Microsoft) | Speech recognition | Governed by your browser's own privacy settings. |
| **Microsoft** | Online text-to-speech (only the `edge-tts` fallback) | Microsoft's terms. |
| **GitHub** | Hosts the website (GitHub Pages) | GitHub receives normal web-request data (such as your IP address) when you open the page. |
| **Wikipedia** | Sample mode topic lookup only | Wikimedia's privacy policy. |

## 5. Children, classmates, and teachers

Class mode can capture **other people** — a teacher's voice and, in a camera frame, faces. Only use it
where the teacher and school are aware and agree, and follow your school's rules on recording and AI
tools. Basira does not detect or blur faces.

**Learners and minors.** Basira is intended for learners and the educators and family who support them. Because learners may be
minors, **a parent, guardian, or teacher should set it up and supply the API key**. Basira does not
collect any information about a learner on its own servers because it has none, but the services in
section 4 do receive what is spoken, shown, or uploaded. Do not use Basira to process sensitive
personal information about a child that you would not be comfortable sending to those services.

## 6. Your choices

- Do not click Camera, Upload, or connect Classroom, and none of that is sent. Do not start class
  mode, and no room audio or periodic camera frames are captured.
- Mute the microphone at any time (Mute button).
- Use a **limited OpenRouter key with a spending cap**, and revoke it at openrouter.ai/keys whenever
  you like.
- Clear your saved key, memories, and prompt from your browser at any time.

## 7. Changes

If this policy changes in a meaningful way, the "Last updated" date above will change.

## 8. Contact

Questions or concerns: open an issue at
[github.com/AYDXB09/basira/issues](https://github.com/AYDXB09/basira/issues).
