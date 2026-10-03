# EduAI

EduAI is a modern AI learning workspace that turns questions, notes, and study goals into clear explanations and focused practice.

## Highlights

- Streaming AI tutoring powered by the OpenAI Responses API
- Conversation history with search, rename, delete, import, and export
- Focused learning tools for explanations, quizzes, summaries, flashcards, and study plans
- JWT authentication with PostgreSQL support and an in-memory development fallback
- Study-material upload support
- Responsive dark and light interfaces for desktop and mobile
- Accessible keyboard shortcuts, focus states, and reduced-motion support

## Run locally

### 1. Configure the server

```bash
cd server
cp .env.example .env
```

Add your `OPENAI_API_KEY` and replace the example `JWT_SECRET`. PostgreSQL is optional for local development; when `DATABASE_URL` is empty, EduAI uses its in-memory store.

### 2. Install and start

```bash
npm install
npm start
```

Open [http://localhost:5000](http://localhost:5000).

## PostgreSQL

To use persistent database storage:

```bash
docker compose up -d
```

Then set `DATABASE_URL` in `server/.env` to the connection string defined in `docker-compose.yml`.

## Keyboard shortcuts

- `Ctrl/Cmd + N`: start a new conversation
- `Ctrl/Cmd + K`: search conversation history
- `Ctrl/Cmd + /`: focus the message composer
- `Escape`: close the active modal or mobile sidebar

## Project structure

```text
client/
  index.html
  css/style.css
  js/app.js
server/
  app.js
  controllers/
  middleware/
  routes/
  utils/
```

## Security

Never commit `server/.env` or expose API keys in frontend code. Use `server/.env.example` as the configuration template.