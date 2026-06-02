> [!NOTE]
> This repository is a fork of
> [PentesterFlow/agent](https://github.com/PentesterFlow/agent).
> This fork adds new features such as Codex CLI and Gemini CLI backend
> support, plus `--cli` and `--cli-mod` terminal shortcuts.

<div align="center">

<img src="assets/logo.png" alt="PentesterFlow" width="520" />

### Agentic offensive-security in your terminal, powered by models you control.

PentesterFlow turns a scoped security objective into a tool-using workflow for
recon, vulnerability testing, verification, and report-ready findings.

<br/>

[![build](https://img.shields.io/github/actions/workflow/status/PentesterFlow/agent/ci.yml?branch=main&label=build&logo=github)](https://github.com/PentesterFlow/agent/actions)
[![release](https://img.shields.io/github/v/release/PentesterFlow/agent?include_prereleases&logo=github)](https://github.com/PentesterFlow/agent/releases)
[![node](https://img.shields.io/badge/node-20%2B-339933?logo=node.js&logoColor=white)](https://nodejs.org)
[![license: Apache--2.0](https://img.shields.io/badge/license-Apache--2.0-blue)](LICENSE)
[![stars](https://img.shields.io/github/stars/PentesterFlow/agent?style=social)](https://github.com/PentesterFlow/agent/stargazers)

**[Install](#install) · [Quickstart](#quickstart) · [Core](#core) · [Usage](#usage) · [Skills](#skills) · [Security](#security-model)**

</div>

---

```console
$ pentesterflow
╭────────────────────────────────────────────────╮
│  PentesterFlow                                 │
│  local agent · tools ready · human approved     │
╰────────────────────────────────────────────────╯

› /target https://app.example.com
  target set to https://app.example.com

› test the orders API for broken access control
⏺ Skill webvuln
  ⎿ loaded skill: webvuln
⏺ http GET https://app.example.com/api/v1/orders/1043
  ⎿ 200 OK
⏺ Shell(curl -s -H "Authorization: Bearer $USER_B" https://app.example.com/api/v1/orders/1043)
  ⎿ cross-account response confirmed
⏺ Confirmed Finding (high) IDOR on /api/v1/orders/{id}
  ⎿ written to ./findings/idor-orders.md
```

## Overview

PentesterFlow is an open-source terminal agent for professional penetration
testing, bug bounty work, and security engineering. It connects to local or
OpenAI-compatible LLM backends, plans against a scoped target, asks for approval
before sensitive actions, runs tools, verifies behavior, and writes findings you
can use in a report.

The project is intentionally **local-first** and **curl-first**. It works well
with Ollama, LM Studio, vLLM, llama.cpp servers, and compatible hosted APIs. It
prefers transparent HTTP and shell commands before heavier scanners, so every
step is visible, reproducible, and easy to audit.

> [!WARNING]
> Use PentesterFlow only on systems where you have explicit authorization. The
> agent can run shell commands, make HTTP requests, edit files, and drive browser
> capture tools after approval.

## Fork Notes

- Upstream project: [PentesterFlow/agent](https://github.com/PentesterFlow/agent)
- Fork repository: [everythingBlackkk/agent](https://github.com/everythingBlackkk/agent)
- Fork-specific additions:
  - Codex CLI backend support
  - Gemini CLI backend support
  - `--cli` and `--cli-mod` shortcuts for local agent CLIs
  - Extra help text and terminal run examples for CLI-backed models

## Core

| Area | What PentesterFlow provides |
|---|---|
| Agent loop | Plan, act, observe, verify, and report across one scoped task. |
| Model backends | Ollama, LM Studio, OpenAI-compatible APIs, and experimental Codex / Gemini CLI execution. |
| Tooling | Shell/Bash, HTTP, file tools, search, browser capture, MCP, and finding confirmation. |
| Skills | Markdown playbooks for recon, web vulnerabilities, SSRF, SSTI, JWT, GraphQL, race testing, takeover checks, Supabase, and deserialization. |
| Human control | Permission prompts with allow once, allow session, deny, and explicit YOLO mode for labs. |
| Reporting | Confirmed findings saved as Markdown with evidence, impact, PoC, and remediation. |
| Releases | Standalone binaries for macOS, Linux, and Windows published through GitHub Actions. |

## Highlights

- **Local by default**: run against your own model backend with no required cloud account.
- **Modern terminal UI**: compact tool calls, readable shell transcripts, skill summaries, and finding-focused output.
- **Permission-aware execution**: approve each risky action once or for the session.
- **Decision planner**: each normal turn gets lightweight skill selection, risk labeling, and coverage guidance before tool use.
- **Verified findings only**: the agent should reproduce a bug before using `confirm_finding`.
- **Portable shell guidance**: tool prompts and preflight checks steer commands away from GNU-only flags when they can break on macOS or Linux.
- **Extensible workflows**: add custom skills, MCP servers, and browser-capture producers.

## Install

For this fork, the simplest install path is cloning the fork, building it
locally, and either running the built CLI directly or linking `pentesterflow`
into your shell `PATH`.

### Install This Fork From GitHub

```sh
git clone https://github.com/everythingBlackkk/agent.git
cd agent
npm install
npm run build
```

### Run In Terminal Without Global Install

```sh
cd /path/to/agent
node dist/cli.js --help
node dist/cli.js --cli codex
node dist/cli.js --cli gemini --cli-mod gemini-3-flash-preview
```

### Install `pentesterflow` Command Globally

```sh
cd /path/to/agent
npm link
pentesterflow --help
```

The original upstream installers download the latest standalone binary for the
upstream project and verify the published SHA-256 checksum when available.

### Upstream Installer Reference

```sh
# macOS / Linux
curl -fsSL https://raw.githubusercontent.com/PentesterFlow/agent/main/install.sh | sh
```

```powershell
# Windows PowerShell
irm https://raw.githubusercontent.com/PentesterFlow/agent/main/install.ps1 | iex
```

Pin a release or choose an install directory:

```sh
PENTESTERFLOW_VERSION=v0.1.0 PENTESTERFLOW_INSTALL_DIR="$HOME/.local/bin" \
  sh -c "$(curl -fsSL https://raw.githubusercontent.com/PentesterFlow/agent/main/install.sh)"
```

You can also download binaries directly from
[GitHub Releases](https://github.com/PentesterFlow/agent/releases):

| OS | Assets |
|---|---|
| macOS | `pentesterflow-darwin-arm64`, `pentesterflow-darwin-x64` |
| Linux | `pentesterflow-linux-arm64`, `pentesterflow-linux-x64` |
| Windows | `pentesterflow-windows-x64.exe` |

## Quickstart

```sh
# 1. Build or link this fork
git clone https://github.com/everythingBlackkk/agent.git
cd agent
npm install
npm run build

# 2. Launch PentesterFlow from the build
node dist/cli.js --cli codex

# 3. Or after npm link, launch it directly
#    pentesterflow --cli codex

# 4. Set scope, then describe the task
#    /target https://app.example.com
#    test the orders API for IDOR and broken access control
```

## Usage

```sh
# Default: local Ollama
pentesterflow

# LM Studio
pentesterflow --backend lmstudio --model qwen2.5-coder-32b-instruct

# OpenAI-compatible endpoint
pentesterflow --backend openai-compat \
  --base-url https://api.example.com/v1 \
  --api-key sk-...

# Experimental: Codex CLI backend
pentesterflow --backend codex-cli
pentesterflow --backend codex-cli --model gpt-5.4-mini

# Experimental: CLI aliases
pentesterflow --cli codex
pentesterflow --cli codex --cli-mod gpt-5.4-mini
pentesterflow --cli gemini --cli-mod gemini-3-flash-preview
pentesterflow --cli gemini --cli-mod gemini-3.1-pro-preview

# Enable browser-capture tools for this session
pentesterflow --browser

# Start the local browser-capture ingest server
pentesterflow --browser-ingest

# Auto-approve tool calls for disposable lab environments only
pentesterflow --dangerously-skip-permissions
```

### Command-Line Flags

| Flag | Description |
|---|---|
| `--backend ollama\|lmstudio\|openai-compat\|codex-cli\|gemini-cli` | Select the LLM backend. |
| `--cli codex\|gemini` | Alias for the supported local agent CLIs. |
| `--cli-mod <id>` / `--model <id>` | Set the model id for the active backend or CLI. |
| `--base-url <url>` / `--api-key <key>` | Configure an OpenAI-compatible backend. |
| `--skills <dirs>` | Load extra skill directories. |
| `--resume <session-id>` | Resume a saved session. |
| `--browser` | Enable Browser MCP tools for the current session. |
| `--browser-ingest [port]` | Start the local capture ingest server. |
| `--no-stream` | Disable streaming chat for providers with SSE/tool-call issues. |
| `--dangerously-skip-permissions` | Auto-approve non-sensitive tool calls. |
| `--list-tools` / `--list-skills` | Print registered tools or discovered skills. |
| `--log <path>` | Override the JSON-lines log path. |
| `--debug-session` | Write a complete JSON-lines debug log for the interactive session. |
| `--debug-session-path <path>` | Write the debug session log to a custom path. |
| `--version` / `--help` | Print version or help. |

### Slash Commands

| Command | Description |
|---|---|
| `/help` | Show keybindings and command reference. |
| `/provider` | Pick a backend and model interactively. |
| `/model <id>` / `/model list` | Switch model or list available backend models when the backend exposes a catalog. |
| `/plan [objective]` | Start a plan-only turn without tool execution. |
| `/target <url>` | Set or clear the engagement base URL. |
| `/skills [enable\|disable\|new <name>]` | Manage skills or scaffold a new skill. |
| `/maxsteps <n>` | Set the per-turn tool-call cap. |
| `/thinking on\|off` | Toggle visible reasoning guidance. |
| `/update [version]` | Fetch the GitHub release installer and install the latest or pinned version. |
| `/yolo [on\|off]` | Toggle auto-approval mode. |
| `/reset` | Clear conversation and saved session state. |
| `/clear` | Clear only the on-screen transcript. |
| `/<skill-name>` | Load a skill into the next turn. |
| `/exit` | Quit. |

## How It Works

1. **Scope**: set a target and constraints before testing.
2. **Plan**: select the relevant methodology, risk level, and skill playbook.
3. **Act**: call approved tools such as `http`, `shell`, file tools, browser capture, or MCP servers.
4. **Observe**: compare responses, status codes, headers, timing, and account boundaries.
5. **Verify**: reproduce the issue with a clean command or request.
6. **Report**: persist confirmed issues through `confirm_finding`.

## Tools

| Tool | Purpose |
|---|---|
| `shell` / `BashTool` | Run shell commands with approval and safety checks. |
| `http` | Send HTTP/HTTPS requests against full URLs or the active `/target`. |
| `file_read` / `file_write` / `file_edit` | Read, create, and patch files. |
| `GlobTool` / `GrepTool` | Discover files and search content. |
| `web_fetch` / `web_search` | Fetch pages or run web searches. |
| `ask_user` | Ask for a decision when scope or testing direction is ambiguous. |
| `confirm_finding` | Save a verified finding to `./findings/<slug>.md`. |
| `coverage` | Track tested endpoints, parameters, and vulnerability classes. |
| `load_skill` | Load a methodology playbook into context. |
| `browser_capture_*` | Query captured browser traffic, requests, endpoints, and snapshots. |

## Skills

Skills are versioned Markdown playbooks that package methodology, payloads, and
decision logic. Built-in skills include:

| Skill | Focus |
|---|---|
| `recon` | Subdomains, fingerprinting, content discovery, and attack-surface mapping. |
| `webvuln` | IDOR, broken access control, injection, auth, and session logic. |
| `ssrf` | Filter bypasses, metadata access, internal reachability, and blind SSRF. |
| `ssti` | Template-engine fingerprinting and escalation paths. |
| `jwt` | Algorithm confusion, `kid` abuse, weak secrets, and token validation flaws. |
| `graphql` | Introspection, authorization gaps, batching, and depth abuse. |
| `race` | TOCTOU issues, limit bypasses, and race-condition verification. |
| `takeover` | Dangling DNS and unclaimed cloud resources. |
| `supabase` | Row-Level Security and anonymous access mistakes. |
| `deserialize` | Unsafe deserialization sinks and gadget-chain testing. |

Discovery order is built-in `skills/`, project-local
`./.pentesterflow/skills/`, personal `~/.pentesterflow/skills/`, then any
directory passed with `--skills`. Later entries win on name collisions.

## Browser Capture

`pentesterflow --browser-ingest` starts a local ingest server on
`127.0.0.1:9999` for captured requests and snapshots. The companion
`pentesterflow-browser-mcp` binary exposes the same capture data as an MCP
server for compatible clients.

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

## Security Model

- **Authorized use only**: PentesterFlow is built for permitted security work.
- **Human approval**: permission-gated tools require allow once, allow session, or deny.
- **Sensitive path protection**: secrets and high-risk local paths stay gated even in YOLO mode.
- **Shell safeguards**: catastrophic commands are blocked before execution.
- **Transcript control**: compacting and export paths redact common credential formats.
- **Transparent evidence**: findings should include the request, response signal, impact, and remediation.

## Configuration And Data

| Path | Contents |
|---|---|
| `~/.pentesterflow/config.json` | Backend, model, endpoint, and disabled-skill settings. |
| `~/.pentesterflow/sessions/*.json` | Saved sessions for `--resume`. |
| `~/.pentesterflow/builtin-skills/<name>/SKILL.md` | Installer-managed shipped skills. |
| `~/.pentesterflow/skills/<name>/SKILL.md` | Personal skills. |
| `./.pentesterflow/skills/<name>/SKILL.md` | Project-local skills. |
| `./findings/<slug>.md` | Confirmed findings for the current engagement. |
| `~/.pentesterflow/logs/pentesterflow.log` | Structured JSON-lines logs. |
| `~/.pentesterflow/debug/session-*.jsonl` | Opt-in complete session debug logs from `--debug-session`. |

Enable a complete debug log when reproducing usage issues:

```sh
pentesterflow --debug-session
PENTESTERFLOW_DEBUG_SESSION=1 pentesterflow
PENTESTERFLOW_DEBUG_SESSION=1 PENTESTERFLOW_DEBUG_SESSION_PATH=/tmp/pf-debug.jsonl pentesterflow
```

Debug session logs include prompts, assistant events, tool calls, tool results,
errors, and shutdown markers. Treat them as sensitive because they can contain
target data, command output, and copied request material.

### CLI Backends

PentesterFlow can use these local agent CLIs as experimental model backends:

- `codex-cli` via `codex exec`
- `gemini-cli` via `gemini --prompt`

Example config:

```json
{
  "backend": "codex-cli",
  "model": "gpt-5.4-mini",
  "codexCli": {
    "command": "codex",
    "extraArgs": [],
    "timeoutMs": 120000,
    "workingDirectory": ""
  },
  "geminiCli": {
    "command": "gemini",
    "extraArgs": [],
    "timeoutMs": 120000,
    "workingDirectory": ""
  }
}
```

- Codex CLI must already be installed and authenticated.
- Gemini CLI must already be installed and authenticated.
- PentesterFlow currently uses these validated CLI model ids:
  - `codex-cli`: `gpt-5.4-mini`
  - `gemini-cli`: `gemini-3-flash-preview`, `gemini-3.1-pro-preview`
- PentesterFlow still owns testing scope, approvals, shell execution, HTTP requests, and file edits.
- These backends wrap the CLIs with a strict prompt contract and read-only or no-tool modes, but the CLIs are themselves agentic, so treat this integration as experimental.
- Do not enable Codex or Gemini dangerous / YOLO modes outside isolated labs.

### Cli Support now

```sh
pentesterflow --cli codex
pentesterflow --cli codex --cli-mod gpt-5.4-mini
pentesterflow --cli gemini --cli-mod gemini-3-flash-preview
pentesterflow --cli gemini --cli-mod gemini-3.1-pro-preview
```

Direct built-entry form:

```sh
node dist/cli.js --cli codex
node dist/cli.js --cli codex --cli-mod gpt-5.4-mini
node dist/cli.js --cli gemini --cli-mod gemini-3-flash-preview
node dist/cli.js --cli gemini --cli-mod gemini-3.1-pro-preview
```

### Troubleshooting

- `Codex CLI was not found in PATH. Install and sign in to Codex CLI first.`: install Codex CLI and ensure `codex` resolves in your shell `PATH`.
- `Gemini CLI was not found in PATH. Install and sign in to Gemini CLI first.`: install Gemini CLI and ensure `gemini` resolves in your shell `PATH`.
- `codex-cli exited non-zero`: run `codex login` or `codex doctor`, then retry.
- `gemini-cli timed out`: raise `geminiCli.timeoutMs` in `~/.pentesterflow/config.json`.
- `model not supported`: use one of the validated CLI model ids listed above.

## Develop

```sh
npm install
npm run dev -- --version
npm run typecheck
npm run lint
npm run test
npm run build
node dist/cli.js
```

`npm run ci` runs typecheck, lint, tests, and build.

## Contributing

Issues and pull requests are welcome. Keep changes focused, include tests for
behavioral updates, and run `npm run ci` before opening a pull request. New
skills should include a `SKILL.md` and pass the skill conformance tests.

## License

[Apache-2.0](LICENSE). Use responsibly and only with authorization.

<div align="center">
<br/>

**[Report an issue](https://github.com/PentesterFlow/agent/issues)** ·
**[Request a feature](https://github.com/PentesterFlow/agent/issues/new)** ·
**[Releases](https://github.com/PentesterFlow/agent/releases)**

</div>
