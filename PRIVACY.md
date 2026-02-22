# LLM Council — Privacy Policy

**Last Updated:** February 2026

## Overview

LLM Council is a browser extension that helps users compare responses from multiple AI chatbots. It operates entirely client-side with no external servers.

## Data Collection

**We collect NO data.** Specifically:

- ❌ No personal information collected
- ❌ No browsing history tracked
- ❌ No cookies read or written
- ❌ No credentials stored
- ❌ No analytics or telemetry
- ❌ No data sent to external servers

## How It Works

- The extension injects text into AI chatbot input fields on behalf of the user
- All processing happens locally in the user's browser
- User configuration (selected models, preferences) is stored only in `chrome.storage.local`

## Session Isolation

- The extension optionally opens a separate incognito window for the Judge model
- This is solely to allow the user to log into a different account
- The extension does not read, write, or manipulate cookies in any context

## Permissions Explained

| Permission | Why |
|------------|-----|
| `tabs` | To open and manage AI chatbot tabs |
| `activeTab` | To interact with the current tab's content |
| `storage` | To save user preferences locally |
| `scripting` | To inject content scripts into AI chatbot pages |
| `incognito` | To optionally open the Judge model in an isolated session |

## Contact

For questions about this privacy policy, please open an issue on the GitHub repository.
