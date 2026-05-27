# RoleFit AI

Desktop-first React app for polishing a resume against a job description.

## Framework Choice

This project uses Vite, React, and TypeScript. It runs as a fast local desktop browser app today and can later be wrapped with Electron or Tauri if a native desktop installer is needed.

## Features

- Paste a job link and job description.
- Upload a text-based resume file or paste resume content directly.
- Score the resume for job keyword fit, bullet quality, action verbs, metrics, and section structure.
- Keep role bullet groups to five bullets.
- Generate a polished resume draft without inventing achievements or metrics.
- Use OpenAI, Claude, Gemini, OpenRouter, Groq, Together AI, Mistral AI, or a local/custom provider.
- Save a local base resume in `job-search-workspace/` and auto-load it on startup.
- Copy the polished draft for editing.

## Run

```bash
npm install
npm run dev
```

Open the local URL Vite prints in the terminal.

## Local Workspace

The app creates `job-search-workspace/` for private local job-search files. Put
personal resumes, application trackers, exported drafts, rendered tracker
previews, notes, and job-specific files in that folder rather than in the repo
root.

Save your generic/base resume there through the Resume Source panel. On startup,
the server loads `base-resume.docx` first when it exists, then text fallbacks
such as `base-resume.txt`.

The folder is ignored by git except for its README, and also holds the in-app
pipeline tracker (`applications.json`). Root-level resume files, PDFs, and
DOCX files are also ignored by `.gitignore` as a privacy guard.

## AI Setup

Create a local `.env` file and set an API key. The local Node server calls AI providers from `/api/polish`, so saved keys are never exposed in browser code. You can also paste a one-time key in the app's AI Settings panel.

```bash
printf 'OPENAI_API_KEY=your-key-here\n' > .env
npm run dev
```

The default provider is OpenAI Responses API with model `gpt-5.5`. Override it with `OPENAI_MODEL` or `AI_MODEL`.

For other providers, choose Claude, Gemini, OpenRouter, Groq, Together AI,
Mistral AI, or Local/custom in AI Settings. Claude and Gemini use their native
APIs. The other provider choices use compatible chat-completions endpoints and
fill a starter base URL/model name that you can edit.

The Model control changes with the selected provider. Pick a common model from
the dropdown, or choose **Custom model** when a provider releases a newer model
ID that is not listed yet.

You can also set values in `.env`:

```bash
AI_PROVIDER=openai-compatible
AI_API_KEY=your-provider-key
AI_BASE_URL=https://provider.example/v1
AI_MODEL=provider/model-name
```

Use `AI_PROVIDER=anthropic` for Claude, `AI_PROVIDER=gemini` for Gemini, or
the named provider value shown in the app for the other presets. Keep
`openai-compatible` only for a custom chat-completions endpoint that is not one
of the named presets.

Native provider keys use provider-specific env names such as
`ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `GROQ_API_KEY`, `OPENROUTER_API_KEY`,
`TOGETHER_API_KEY`, or `MISTRAL_API_KEY`.
