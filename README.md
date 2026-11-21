# StudySMART

A dynamic educational web app. Paste your notes, upload an image, or type a topic — StudySMART uses Google Gemini (1.5 Flash) to generate a study guide, a practice quiz, and a Battle Arena trivia game, all on demand.

**No hardcoded examples or placeholders.** The app starts as a completely blank slate; all content is generated from what the user supplies. Format inspired by user-provided examples, content generated on demand.

## Features

- **Study Guide generation** — Markdown guide + key concepts, generated from user text and/or images (`/api/generate`). Gemini first classifies the topic from the input only, then chooses the format that fits it per module — rule/formula cards, vocabulary spotlight cards, a numbered core-ideas list, or a mixed layout. Each module has a title, an intro line, and concept cards (label, title, formula or definition, example) with a "Card X of N" counter, plus, when the format uses them, core ideas, a "Show your reasoning" worked example, and a section checkpoint mastery quiz. Targeted practice follows — exactly three problems per concept, a live "X of 3 correct" score per concept, explanations on wrong answers, and an "Ask AI Tutor" button that opens a step-by-step tutor breakdown. There is no fixed limit on the number of modules, concepts, or practice questions a guide can have.
- **Practice Quiz** — interactive multiple-choice quiz with explanations and an "Ask AI Tutor" button on wrong answers
- **AI Tutor & Editor** — context-aware chat (`/api/chat`) that answers questions, explains wrong answers, and rewrites study guide sections
- **Workspace sketchpad** — inline digital sketchpad (`react-sketch-canvas`) alongside the study guide, for stylus/touch notes
- **Battle Arena** — trivia game generator (`/api/generate-game`) with 1 Player, 2 Player Local, and Multiplayer modes, animated "Brainstorming…" loading screen, scoring, and results. Every generated study guide can also spawn its own subject-specific game from the guide's content — Gemini chooses the game type that fits the topic, with flashcards and matching when the game uses cards, and a timer when it is a timed drill. Games are 10 questions by default (up to 20 per game).
- **Pronunciation** — for language topics, each term carries a phonetic pronunciation guide generated on demand, with Speak (browser speech synthesis, in the language Gemini returns) and Say-it listening (browser speech recognition) that compares what you said to the target term. No server-side audio and no key needed; if speech recognition is unsupported, listening-only pronunciation still works.

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

Without an API key the API routes return a clear 500 error explaining that a key is needed — they never return fake content.

## Deploy (Vercel)

Push this repo to GitHub, import it in Vercel, and set the `GOOGLE_GENERATIVE_AI_API_KEY` environment variable in the Vercel project settings.
