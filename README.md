# EduAI

EduAI is a personal AI tutor. It explains concepts at the student's level, guides them with hints instead of handing over answers, quizzes them with marked feedback, and works from their own notes and documents.

## Features

- **Tutor**: streamed answers with Markdown, syntax-highlighted code, copy, regenerate, stop, and "save to notes". Each conversation has tutor settings:
  - **Level**: primary school through adult learner.
  - **Style**: Explain, Guided (Socratic), Practice, Check my work, Exam revision.
  - **Subject**: optional.
- **Study materials**: upload PDF, DOCX, text, Markdown or code (up to 10 MB). EduAI extracts the text, and students can view exactly what was extracted. Attach a material to a conversation to ask about it or summarize it. The tutor is told when only part of a document was provided, and that it must never claim to have read anything it wasn't given.
- **Quizzes**: generated from a topic, a material or a note.
  - Answers stay on the server until the student submits.
  - Multiple choice is marked by the server; short answers are marked by the AI with specific feedback.
  - Results include an explanation for every question, plus "Explain my mistakes" (opens a tutoring session) and "Save review to notes".
- **Notes**: saved explanations, quiz reviews and personal notes, with search, editing, "Quiz me on this" and "Study with the tutor".
- **Progress**: activity totals, average quiz score, recent results, and topics scoring under 70% to review.
- Conversations, notes, materials and quizzes are stored on the server per account. Chats saved in the browser by older versions can be imported with one click.

## Run locally

Requires Node.js 20 or later.

```bash
cd server
cp .env.example .env      # then edit .env (see below)
npm install
npm start
```

Open http://localhost:5000. The server also serves the client.

### Configure the AI provider

In `server/.env`, either:

- **OpenAI**: set `OPENAI_API_KEY` (and optionally `OPENAI_MODEL`, default `gpt-4.1-mini`), or
- **A local or OpenAI-compatible model**: set `OPENAI_BASE_URL`, e.g. for [Ollama](https://ollama.com):

  ```
  OPENAI_BASE_URL=http://localhost:11434/v1
  OPENAI_MODEL=llama3.1:8b
  ```

At startup the server checks the provider and logs the result, for example `AI provider unavailable [ai_auth]: ...`. If the AI can't respond (invalid key, no credits, rate limit, network failure, unknown model), students see a clear explanation, the app shows a banner with a "Check again" button, and their question is kept so they can retry.

### Storage

- **PostgreSQL** (recommended): set `DATABASE_URL`. `docker compose up -d` starts one matching `.env.example`. Tables are created and upgraded automatically; upgrades only add tables and columns and never delete data.
- **No database**: leave `DATABASE_URL` empty and data is saved to `server/data/eduai-data.json`.

### Security settings

- Set `JWT_SECRET` to a long random value: `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`. In production (`NODE_ENV=production`) the server refuses to start with a weak secret.
- API keys stay on the server. Every data and AI endpoint requires a signed-in user and only returns that user's own data.
- Rate limits apply per IP and per user for AI calls (configurable in `.env`). The server sends a strict Content Security Policy, and all AI or user content is sanitized before display.

## Tests

```bash
cd server
npm test                                           # file storage
TEST_DATABASE_URL=postgresql://.../eduai_test npm test   # same suite on PostgreSQL (use an empty database)
```

The suite runs the real server against a mock OpenAI-compatible provider. It covers:

- auth;
- streaming, stopping, regeneration and conversation context;
- isolation between users;
- provider error mapping (invalid key, no credits, unknown model, unreachable);
- PDF extraction;
- quizzes, notes and import.

## Keyboard shortcuts

- `Enter`: send · `Shift+Enter`: new line
- `Ctrl/Cmd + K`: search conversations
- `Ctrl/Cmd + N` (or `Ctrl+Alt+N` where the browser reserves Ctrl+N): new conversation
- `Ctrl/Cmd + /`: focus the message box
- `Escape`: close the open panel, menu or dialog

## Project structure

```text
client/
  index.html
  css/style.css
  js/
    app.js        app shell: auth, navigation, theme, status
    api.js        API client and streaming (SSE) parser
    chat.js       tutor conversations
    quizzes.js    quiz builder, player and results
    notes.js      notes
    materials.js  study material uploads
    progress.js   progress overview
    ui.js         shared helpers, sanitized Markdown rendering
server/
  app.js                 Express app and startup
  controllers/           chat streaming
  routes/                auth, conversations, chat, quizzes, notes, materials, users, status, study
  services/ai/           AI provider layer (OpenAI-compatible) and error mapping
  services/tutor.js      tutoring prompts, context building, quiz parsing
  services/extractText.js PDF/DOCX/text extraction
  store/                 PostgreSQL and JSON-file storage behind one interface
  test/                  automated tests
```

### Adding another AI provider

Implement an object with `{ name, model, configured, streamChat, complete, checkConnection }` (see `server/services/ai/openaiCompatibleProvider.js`), register it in `server/services/ai/index.js`, and select it with `AI_PROVIDER`.
