<div align="center">

# Pentesterflow

### Agentic offensive-security in your terminal — powered by your own local LLMs.

Turn a one-line goal — *"find IDORs on this host"*, *"set up a recon pass on $TARGET"* —
into a real tool-using agent loop: recon, vulnerability discovery, exploitation, and
report-grade findings. Open source, free, and unrestricted for authorized work.

<br/>

[![build](https://img.shields.io/github/actions/workflow/status/pentesterflow/agent/ci.yml?branch=main&label=build&logo=github)](https://github.com/pentesterflow/agent/actions)
[![release](https://img.shields.io/github/v/release/pentesterflow/agent?include_prereleases&logo=github)](https://github.com/pentesterflow/agent/releases)
[![npm](https://img.shields.io/npm/v/@pentesterflow/agent?logo=npm&color=cb3837)](https://www.npmjs.com/package/@pentesterflow/agent)
[![node](https://img.shields.io/badge/node-20%2B-339933?logo=node.js&logoColor=white)](https://nodejs.org)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen)](#contributing)
[![stars](https://img.shields.io/github/stars/pentesterflow/agent?style=social)](https://github.com/pentesterflow/agent/stargazers)

**[Install](#install) · [Quickstart](#quickstart) · [Usage](#usage) · [Skills](#skills) · [Security](#security-model) · [Contributing](#contributing)**

</div>

---

```console
$ pentesterflow
╭───────────────────────────────────────────────╮
│  ❯❯  pentesterflow      ollama (local)          │
│      qwen2.5-coder:32b  tools ✓  ·  ready       │
╰───────────────────────────────────────────────╯

❯ /target https://app.example.com
  target set to https://app.example.com

❯ find IDORs on the orders API
◆ skill:webvuln loaded · planning access-control sweep
⚙ http  GET /api/v1/orders/1043        (as user A)      → 200 OK
⚙ http  GET /api/v1/orders/1043        (Bearer user B)  → 200 OK   cross-tenant read
✔ P2 · IDOR on /orders/{id}  →  written to ./findings/idor-orders.md
  (copy-paste curl PoC + impact + remediation included)
```

<!-- Tip: drop a recorded demo at docs/demo.gif and embed it here for the hero. -->

## Table of contents

- [Overview](#overview)
- [Highlights](#highlights)
- [Install](#install)
- [Quickstart](#quickstart)
- [Usage](#usage)
  - [Command-line flags](#command-line-flags)
  - [Slash commands](#slash-commands)
- [How it works](#how-it-works)
- [Skills](#skills)
- [Browser capture](#browser-capture)
- [Security model](#security-model)
- [Configuration & data](#configuration--data)
- [Develop](#develop)
- [Contributing](#contributing)
- [License](#license)

## Overview

Pentesterflow is a terminal agent for penetration testers, security engineers, and bug
hunters. It runs entirely against models **you** control — Ollama, LM Studio, or any
OpenAI-compatible endpoint — so nothing leaves your machine unless you point it at a
remote provider yourself.

It is **curl-first** by design: the agent reaches for `curl` and a built-in HTTP tool
before it ever pulls in a heavy scanner, and it writes every confirmed bug to disk as a
reproducible, report-grade finding. The system prompt is hard-locked to offensive-security
work and calibrated against OWASP Top 10, the Bugcrowd VRT (P1–P5), and PortSwigger research.

> [!WARNING]
> **Authorized engagements only.** Pentesterflow runs arbitrary shell, edits files, makes
> arbitrary HTTP requests, and — with `--browser` — drives a real browser. The model
> proposes; **you** approve. Read the [Security model](#security-model) before pointing it at
> anything you do not own.

## Highlights

- **Local by default** — Ollama, LM Studio, vLLM, llama.cpp, or any OpenAI-compatible API. No telemetry, no accounts, no usage caps.
- **A real agent loop** — plan → act → observe → verify → report, not a chatbot. You stay in the loop via a per-call permission prompt.
- **Curl-first** — the agent prefers `curl` + the built-in `http` tool; scanners like `ffuf`, `nuclei`, and `sqlmap` run only when you ask.
- **Ten offensive skills** — versioned markdown playbooks for `recon`, `webvuln`, `ssrf`, `ssti`, `jwt`, `graphql`, `race`, `takeover`, `supabase`, and `deserialize`. Write your own with `/skills new`.
- **Report-grade findings** — verified bugs are persisted to `./findings/<slug>.md` with a copy-pasteable PoC, concrete impact, and remediation. No theoretical findings.
- **Built-in safety rails** — shell denylist, sensitive-path gating (`~/.ssh`, `~/.aws`, `/etc/shadow`, shell histories), and credential redaction on `/compact` and `/export`.
- **MCP, including Browser MCP** — register any MCP server; one flag wires up live browser capture so the agent can query real traffic, cookies, and session snapshots.

## Install

The online installer downloads the standalone binary for your OS/arch and verifies its
SHA-256. No Node required:

```sh
# macOS / Linux
curl -fsSL https://raw.githubusercontent.com/pentesterflow/agent/main/install.sh | sh
```

```powershell
# Windows (PowerShell)
irm https://raw.githubusercontent.com/pentesterflow/agent/main/install.ps1 | iex
```

Pin a version or change the install directory with environment variables —
`PENTESTERFLOW_VERSION=v0.1.0`, `PENTESTERFLOW_INSTALL_DIR=/usr/local/bin`
(`$env:...` on Windows).

Via npm (requires Node 20+):

```sh
npm install -g @pentesterflow/agent
pentesterflow --version
```

Or grab a single-file binary directly from the [releases page](https://github.com/pentesterflow/agent/releases).

## Quickstart

```sh
# 1. Pull a capable tool-calling model
ollama pull qwen2.5-coder:32b

# 2. Launch (defaults to a local Ollama backend)
pentesterflow

# 3. Pin the engagement scope, then describe the goal in plain English
#    /target https://app.example.com
#    find IDORs and broken access control on the orders API
```

## Usage

```sh
# Default: local Ollama
pentesterflow

# LM Studio
pentesterflow --backend lmstudio --model qwen2.5-coder-32b-instruct

# Any OpenAI-compatible endpoint (vLLM, llama.cpp server, remote provider)
pentesterflow --backend openai-compat --base-url https://api.example.com/v1 --api-key sk-...

# Enable Browser MCP for this session
pentesterflow --browser

# Start the local browser-capture ingest server (127.0.0.1:9999)
pentesterflow --browser-ingest

# YOLO — auto-approve every tool call (throwaway VMs / lab targets only)
pentesterflow --dangerously-skip-permissions
```

### Command-line flags

| Flag | Description |
|---|---|
| `--backend ollama\|lmstudio\|openai-compat` | Select the LLM backend (default: `ollama`). |
| `--model <id>` | Model id (e.g. `qwen2.5-coder:32b`). |
| `--base-url <url>` / `--api-key <key>` | Endpoint + key for `openai-compat`. |
| `--skills <dirs>` | Comma-separated extra skill directories. |
| `--resume <session-id>` | Resume a saved session. |
| `--browser` | Enable Browser MCP for this session (not persisted). |
| `--browser-ingest [port]` | Start the local capture ingest server (default `:9999`). |
| `--no-stream` | Disable streaming chat (fallback for backends that drop `tool_calls` over SSE). |
| `--dangerously-skip-permissions` | YOLO mode — auto-approve every tool call. |
| `--list-tools` / `--list-skills` | Print the registered tools / discovered skills and exit. |
| `--log <path>` | Override the log file path. |
| `--version` / `--help` | Print version / usage and exit. |

### Slash commands

| Command | Description |
|---|---|
| `/help` | Keybindings and the full slash-command reference. |
| `/provider` | Interactive picker: choose a backend, then a model from its catalog. |
| `/model <id>` | Switch model directly; validated against the live backend catalog. |
| `/target <url>` | Pin an engagement base URL (the `http` tool resolves paths against it). No argument clears it. |
| `/skills [enable\|disable\|new <name>]` | List and toggle skills, or scaffold a new one. |
| `/maxsteps <n>` | Per-turn tool-call cap (default 20). |
| `/thinking on\|off` | Toggle the show-thinking directive. |
| `/yolo [on\|off]` | Toggle auto-approval for tool calls. |
| `/reset` | Clear the conversation and the saved session. |
| `/clear` | Clear the on-screen transcript only. |
| `/<skill-name>` | Load a skill into context for your next turn. |
| `/exit` | Quit. |

## How it works

Each turn runs an autonomous reason-and-act loop against your target:

1. **Plan** — decompose the goal into a recon → discovery → exploit → report chain.
2. **Act** — call tools (`http`, `shell`, the browser, MCP servers) to probe the target.
3. **Observe** — read responses, diff behavior across accounts, reason about anomalies.
4. **Verify** — reproduce the bug with a clean PoC before it is ever called a finding.
5. **Report** — write `./findings/<slug>.md` with a curl PoC, impact, and remediation.

A live health probe (15s interval, 5s timeout) keeps the status bar honest about whether
the backend is `ready` or `disconnected`, and `Esc` cancels an in-flight turn at any point.

### Built-in tools

| Tool | Purpose |
|---|---|
| `shell` / `BashTool` | Run a command via `/bin/sh` or `/bin/bash` (per-call permission + denylist). |
| `file_read` / `file_write` / `file_edit` | Read, write, and patch files (PascalCase aliases also registered). |
| `GlobTool` / `GrepTool` | Find files by glob; search file contents by regex. |
| `http` | Send a single HTTP/HTTPS request; resolves paths against the active `/target`. |
| `web_fetch` / `web_search` | Fetch a URL or run a web search. |
| `ask_user` | Ask a multiple-choice question to disambiguate a branch. |
| `confirm_finding` | Persist a verified finding to `./findings/<slug>.md`. |
| `coverage` | Track tested `(endpoint, parameter, vuln-class)` tuples across the session. |
| `load_skill` | Load a skill playbook into context on demand. |
| `browser_capture_*` | Query traffic, endpoints, requests, and session snapshots from the browser extension. |

## Skills

Skills are versioned markdown playbooks — methodology, payloads, and decision logic for one
vulnerability class. The agent sees each skill's name and description, and loads the full
body on demand with `load_skill`.

| Skill | Focus |
|---|---|
| `recon` | Attack-surface mapping: subdomains, fingerprinting, content discovery. |
| `webvuln` | Core web sweep: IDOR / BAC, injection, auth and session logic. |
| `ssrf` | Filter bypass, cloud metadata, internal reach, blind SSRF. |
| `ssti` | Template-engine fingerprinting and escalation to RCE. |
| `jwt` | `alg` confusion, `kid` abuse, weak-secret cracking. |
| `graphql` | Introspection, authorization gaps, batching and depth abuse. |
| `race` | TOCTOU windows, limit-overrun, single-packet attacks. |
| `takeover` | Dangling DNS / unclaimed cloud resource takeover. |
| `supabase` | Row-Level-Security and anonymous read/write abuse. |
| `deserialize` | Untrusted-deserialization sinks and gadget chains. |

Discovery order (later wins on a name collision): the built-in `skills/` directory →
project-local `./.pentesterflow/skills/` → personal `~/.pentesterflow/skills/` → any
directory passed via `--skills`. Scaffold a new one with `/skills new <name>`.

## Browser capture

`pentesterflow --browser-ingest` starts a local HTTP ingest server on `127.0.0.1:9999`
(`POST /ingest`, `POST /snapshot`) and registers the `browser_capture_*` tools, so the agent
can query whatever a producer (the Chrome extension, a `curl` script, a mitmproxy plugin)
feeds it.

The package also ships a second binary, `pentesterflow-browser-mcp`, that runs as a
**stdio MCP server** hosting the same ingest endpoint and re-exposing captures as MCP tools —
register it in any MCP-aware client:

```json
{
  "mcpServers": {
    "pentesterflow-browser": {
      "command": "pentesterflow-browser-mcp",
      "args": []
    }
  }
}
```

Exposed tools: `browser_capture_status`, `_endpoints`, `_requests`, `_get`, `_snapshot`,
`_clear`. Flags: `--port <n>`, `--max-entries <n>`, `--log <path>`.

## Security model

- **Scope lock** — the system prompt only assists with penetration testing, bug bounty, code review, and coding. Out-of-scope chatter is refused.
- **Human-in-the-loop** — every permission-gated tool call prompts `allow once` / `allow session` / `deny`. YOLO can skip prompts, but **never** for sensitive-path operations.
- **Shell denylist** — catastrophic commands (`rm -rf /`, fork bombs, `mkfs`, disk overwrites, `find -delete`) are blocked before they reach an approval prompt.
- **Sensitive-path gating** — reads and writes under `~/.ssh`, `~/.aws`, `/etc/shadow`, shell histories, and similar always require an explicit prompt, even in YOLO.
- **Credential redaction** — bearer tokens, AWS keys, GitHub PATs, Slack tokens, JWTs, and PEM blocks are scrubbed on `/compact` and `/export` before the conversation crosses a trust boundary.

## Configuration & data

| Path | Contents |
|---|---|
| `~/.pentesterflow/config.json` | Backend, model, endpoint, disabled skills. |
| `~/.pentesterflow/sessions/*.json` | Saved sessions (resume with `--resume`). |
| `~/.pentesterflow/skills/<name>/SKILL.md` | Personal skills. |
| `./.pentesterflow/skills/<name>/SKILL.md` | Project-local skills. |
| `./findings/<slug>.md` | Confirmed findings for the current engagement. |
| `~/.pentesterflow/logs/pentesterflow.log` | Structured JSON-lines logs. |

## Develop

```sh
npm install
npm run dev -- --version     # run from source via tsx
npm run test                 # vitest — 300+ unit & integration tests
npm run typecheck
npm run lint
npm run build                # produces dist/cli.js + dist/browser-mcp.js
node dist/cli.js             # launch the TUI
```

## Contributing

Issues and pull requests are welcome. A change is ready when `npm run ci`
(typecheck → lint → test → build) passes. New skills should ship with their
`SKILL.md` and pass the conformance test in `src/skills/conformance.test.ts`.

## License

[MIT](LICENSE). Use responsibly, and only with authorization.

<div align="center">
<br/>

If Pentesterflow saves you time on an engagement, consider leaving a star.

**[Report an issue](https://github.com/pentesterflow/agent/issues)** · **[Request a feature](https://github.com/pentesterflow/agent/issues/new)** · **[Releases](https://github.com/pentesterflow/agent/releases)**

</div>
