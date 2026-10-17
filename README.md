# Sarvam Codewalk

> Speak a small coding task in the language you are comfortable with. Review the Romanized transcript, send the English task to an agent, then understand the result in clear language.

Sarvam Codewalk is a Linux-first VS Code extension for developers learning by doing. It converts a short spoken task into a reviewed English instruction, runs an approved change in the folder currently open in VS Code, and returns a grounded explanation of what changed, why it changed, and how it was checked.

It is built with Sarvam's speech, translation, chat, and text-to-speech APIs, plus the local Codex CLI. It is an independent project built on these tools, not an official Sarvam product.

## The problem

AI coding tools are excellent at producing code, but many developers still face friction before and after the change:

- Formulating a precise prompt in English can be harder than explaining the same idea aloud.
- A generated diff does not automatically explain the design decision or the verification behind it.
- Generic chat interfaces often mix planning, edits, raw tool output, and reasoning into a noisy surface.
- Developers learning a new language, framework, or codebase need a short feedback loop that turns a change into understanding.

Codewalk focuses on that loop. The user speaks a small task, reviews each interpretation step, explicitly sends the English version to the agent, and receives an evidence-aware lesson after the run.

## Use case

Codewalk is designed for small, bounded implementation tasks such as:

- "Add a Fibonacci function and a focused test."
- "Create a simple Hello World script and explain how to run it."
- "Add validation for an email field and test the invalid cases."

It is useful when a developer wants to work in Hindi, Tamil, Telugu, Bengali, Marathi, or another supported spoken language, while still giving the coding agent a consistent English task.

It is not intended to replace code review, long-running autonomous engineering workflows, or a full desktop voice assistant.

## What makes it different

Codewalk has a narrower job than Kivi or Sarvam Code. That is intentional.

| Product | Primary job | Interaction model | Where Codewalk differs |
| --- | --- | --- | --- |
| **Sarvam Codewalk** | Turn a short spoken task into a reviewed coding change and a learning recap | Voice, Romanized transcript, English translation, explicit agent handoff, lesson | Optimized for learning from a small change inside VS Code |
| **[Kivi](https://www.sarvam.ai/epoch/summary)** | Use voice to get work done across computer applications | General voice interface across apps | Codewalk does not control the desktop. It owns a focused coding and explanation flow in VS Code |
| **[Sarvam Coding Agents](https://www.sarvam.ai/products/coding-agents)** | Complete long-running engineering work across a codebase | Visible plans, checkpoints, steering, and multi-step execution | Codewalk is deliberately smaller in scope. It emphasizes task interpretation, review, and a concise learning artifact after the change |

Kivi is described by Sarvam as a voice interface for work across applications, including coding tools. Sarvam Coding Agents are designed for longer-running work across a codebase with visible plans and checkpoints. Codewalk complements both directions by making one short code change understandable to the person who requested it. The comparison is about product scope, not a performance benchmark. See Sarvam's [Kivi announcement](https://www.sarvam.ai/epoch/summary) and [Coding Agents overview](https://www.sarvam.ai/products/coding-agents).

## End-to-end experience

```text
Speak task
   |
   v
Saaras speech to text
   |
   v
Romanized transcript, editable by the user
   |
   v
Mayura translation to English
   |
   v
User sends task to Codex in the open VS Code workspace
   |
   v
Evidence reducer collects changed paths, test observations, and safe handoff data
   |
   v
Sarvam Chat creates an evidence-grounded lesson
   |
   +--> Optional: translate lesson back to the input language and speak it with Bulbul
```

### Interaction flow

1. Select **Start speaking** and state a task, up to 25 seconds.
2. Review and edit the Roman-script transcript.
3. Select **Send** to inspect the English task that will be given to the agent.
4. Select **Send to agent** to run Codex in the currently open VS Code folder.
5. Read the response: what changed, why, the key concept, verification, limitations, and a suggested next step.
6. Optionally select **Listen** for a spoken recap in the input language when a configured voice is available.
7. Select **Continue session** to start the next related task with the previous lesson as context.

## Technology used

| Layer | Technology | Purpose |
| --- | --- | --- |
| Extension shell | VS Code Extension API, TypeScript | Activity Bar view, commands, SecretStorage, workspace integration |
| Audio capture | ALSA `arecord` | Captures a mono 16 kHz WAV file on Linux |
| Speech to text | Sarvam Saaras v4, with v3 fallback | Detects speech and returns a Romanized transcript |
| Task translation | Sarvam Mayura v1 | Converts the reviewed transcript to English for the coding agent |
| Coding execution | Codex CLI | Makes the approved change inside the current workspace with `workspace-write` sandboxing |
| Evidence handling | JSONL reducer, Zod schemas | Retains only safe progress, changed paths, test observations, and validated final handoff data |
| Lesson generation | Sarvam-105B Conversations | Produces a concise explanation from the reduced evidence, with a deterministic fallback if generation fails |
| Spoken recap | Sarvam Translate and Bulbul | Translates the recap into native script and generates WAV audio on demand |
| Validation | TypeScript, ESLint, Mocha, VS Code Extension Test Runner | Compile, unit, and extension-host checks |

The Sarvam API surface is accessed through the official JavaScript SDK. Sarvam's [developer quickstart](https://docs.sarvam.ai/api/getting-started/quickstart) and [cookbook](https://github.com/sarvamai/sarvam-ai-cookbook) are the primary references for the underlying API capabilities.

## Safety, privacy, and trust boundaries

Codewalk is designed to keep the voice interaction useful without treating it as permission to make unrestricted changes.

- The Sarvam API key is stored in VS Code SecretStorage. The webview never receives it.
- Audio is captured in a temporary directory, sent to Sarvam only for transcription, and deleted locally after success, failure, cancellation, panel disposal, or extension deactivation.
- The webview does not receive raw microphone audio, raw Codex event streams, private reasoning, source snapshots, diffs, or credentials.
- The transcript remains editable before translation. The user sees the English task before choosing **Send to agent**.
- Codex is invoked only after that action and only in the first folder open in VS Code. The extension checks that the folder contains both `.git` and `package.json` before a run.
- Codex is launched with its `workspace-write` sandbox. Codewalk does not commit, push, or publish repository changes.
- The lesson is based on observed changed paths, observed test commands, and a validated agent handoff. If a handoff is missing or malformed, a deterministic partial lesson is shown instead of invented facts.
- Learning history stores only learner-facing task and lesson data, changed-file metadata, test summary, timestamp, and outcome. It does not store audio, generated speech audio, source snapshots, diffs, credentials, or raw agent events.
- Generated speech exists only in memory for the visible lesson and is discarded when the view is hidden or disposed.
- The extension does not read `.env` files.

Sarvam API processing is governed by the account and service terms that apply to the API key in use. Teams should review those terms before using Codewalk with proprietary repositories.

## Requirements

- VS Code `1.98` or newer
- Node.js `18` or newer
- Linux with ALSA `arecord` and a working microphone
- A Sarvam API key
- Codex CLI installed and authenticated with `codex login`
- A Git repository with a `package.json` in the folder you intend to change

The current microphone implementation is Linux-only. Windows and macOS are not yet supported for recording.

## Quick start

```bash
git clone https://github.com/Harizz076/sarvam-codewalk-extension.git
cd sarvam-codewalk-extension
npm ci
npm run compile
code .
```

Then:

1. Press `F5` to open an Extension Development Host.
2. Open the project folder you want Codewalk to edit in that host.
3. Run **Sarvam Codewalk: Set Sarvam API Key** from the Command Palette. The key is stored in VS Code SecretStorage, not in a file or environment variable.
4. Select the Sarvam Codewalk icon in the Activity Bar.
5. Follow the interaction flow above.

### Configure the microphone

List Linux capture devices:

```bash
arecord -l
```

If the default device is not the correct microphone, add a VS Code setting such as:

```json
{
  "sarvamCodewalk.audioDevice": "plughw:0,7"
}
```

Use the device address reported by `arecord -l` for your own machine. The extension captures mono, 16 kHz WAV audio and limits recordings to 25 seconds.

## Demo script for a submission

Use this sequence for a short live demo:

1. Open a small Git workspace containing `package.json` in an Extension Development Host.
2. Say: "Create a Fibonacci generator and add tests for zero, one, and invalid input."
3. Show the editable Romanized transcript.
4. Show the English translation that will be sent to the agent.
5. Send it to the agent and show the working status.
6. Open the finished response and point out **What changed**, **Verification**, and **Try next**.
7. Select **Listen** to demonstrate the language-aware recap, if the API key has TTS access.
8. Select **Continue session** and ask for a related improvement.

The strongest part of the demo is the transition from natural speech to a reviewable English task to an explanation grounded in the files and checks the agent reported.

## Development and validation

```bash
npm run compile
npm run lint
npm test
npm run test:extension
npm run package
```

| Command | Checks |
| --- | --- |
| `npm run compile` | TypeScript compilation |
| `npm run lint` | Extension source linting |
| `npm test` | Compile plus unit tests |
| `npm run test:extension` | Launches a VS Code Extension Development Host test run |
| `npm run package` | Produces a VSIX package |

## Current limitations and next steps

- Audio capture currently depends on Linux ALSA. Native Windows and macOS capture are the most important platform extensions.
- The assistant requires a network connection and valid Sarvam API access for speech, translation, lesson generation, and optional TTS.
- Codex must be installed and authenticated locally.
- The implementation intentionally targets small tasks. It does not expose a long-running agent plan editor, checkpoint management, or general desktop automation.
- TTS requests have bounded waits. If a native-language recap cannot be generated, Codewalk tries an English fallback and otherwise leaves the written lesson available.
- The user remains responsible for reviewing the diff, running project-specific checks, and deciding whether to commit a change.

## Repository layout

```text
src/
  extension.ts                    Extension activation and commands
  services/                       Audio, Sarvam, Codex, history, evidence, and lesson services
  webview/                        Sidebar provider and secure webview HTML
media/                            Webview JavaScript, CSS, and icons
test/                             Unit and extension-host tests
```

## License

Apache-2.0. See [LICENSE](LICENSE).
