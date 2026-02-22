# LLM Council

> Send one prompt to multiple AI models, then let a Judge model score and rank all responses objectively.

## Features

- **Council Broadcast** — Send your prompt to 2–4 AI models simultaneously (ChatGPT, Gemini, Perplexity, Grok)
- **Automatic Judge Evaluation** — A designated Judge model scores and ranks all council responses
- **Honest Scoring** — Judge evaluates on Accuracy, Depth, Clarity, Reasoning, and Relevance (1–10 each)
- **Session Isolation** — Judge can run in incognito or a separate window for different account support
- **Zero Data Collection** — Everything runs client-side. No servers, no telemetry, no cookies.

## How It Works

1. Enter your prompt
2. Select 2–4 council AI models
3. Click "Ask Council"
4. Wait for all council responses
5. Judge automatically evaluates and scores all responses
6. View structured rankings and justifications

## Supported Models

| Model | Role |
|-------|------|
| ChatGPT | Council / Judge |
| Gemini | Council / Judge (default Judge) |
| Perplexity | Council / Judge |
| Grok | Council / Judge |

## Installation

1. Clone this repository
2. Open `chrome://extensions/` in Chrome
3. Enable "Developer mode"
4. Click "Load unpacked" and select the `LLM Council` folder
5. Log into each AI service you want to use
6. Click the LLM Council icon in the toolbar

## Privacy

See [PRIVACY.md](PRIVACY.md) for full details. TL;DR: No data collected, no cookies manipulated, no external servers.

## License

MIT
