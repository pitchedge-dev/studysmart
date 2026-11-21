# StudySMART

A dynamic educational web app. Paste your notes, upload an image, or type a topic — StudySMART uses Google Gemini (1.5 Flash) to generate a study guide, a practice quiz, and a Battle Arena trivia game, all on demand.

**No hardcoded examples, mock data, or placeholders.** The app starts as a completely blank slate; all content is generated from what the user supplies.

## Features

- **Study Guide generation** — Markdown guide + key concepts, generated from user text and/or images (`/api/generate`)
- **Practice Quiz** — interactive multiple-choice quiz with explanations and an "Ask AI Tutor" button on wrong answers
- **AI Tutor & Editor** — context-aware chat (`/api/chat`) that answers questions, explains wrong answers, and rewrites study guide sections
- **Workspace sketchpad** — inline digital sketchpad (`react-sketch-canvas`) alongside the study guide, for stylus/touch notes
- **Battle Arena** — trivia game generator (`/api/generate-game`) with 1 Player, 2 Player Local, and Multiplayer modes, animated "Brainstorming…" loading screen, scoring, and results

## Tech

Next.js 14 (App Router) · TypeScript · Tailwind CSS · lucide-react · Vercel AI SDK (`@ai-sdk/google`, `ai`) · Gemini 1.5 Flash · `react-markdown` · `react-sketch-canvas`

## Setup

```bash
npm install
```

Create a `.env.local` file (see `.env.example`):

```
GOOGLE_GENERATIVE_AI_API_KEY=your-free-key-from-google-ai-studio
```

Get a free key at https://aistudio.google.com/app/apikey

Then run:

```bash
npm run dev     # development server
npm run build   # production build
npm run start   # serve the production build
```

Without an API key the API routes return a clear 500 error explaining that a key is needed — they never return fake or mock content.

## Deploy (Vercel)

Push this repo to GitHub, import it in Vercel, and set the `GOOGLE_GENERATIVE_AI_API_KEY` environment variable in the Vercel project settings.
