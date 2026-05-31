// App-wide TUI state. Kept as a useReducer-friendly shape so each
// component subscribes to only the slice it needs. The agent loop runs
// outside React and pushes events via dispatch().

import type { AgentEvent } from '../agent/events.js';
import { displayToolName, formatToolResult, primaryToolArg } from '../tools/toolDisplay.js';
import type { BannerData } from './Banner.js';
import type { AskRequest } from './askBridge.js';
import type { PermissionRequest } from './permBridge.js';
import { buildToolResultView } from './toolResultFormat.js';

export interface TranscriptEntry {
  kind: 'user' | 'assistant' | 'tool-call' | 'tool-result' | 'system' | 'error' | 'finding';
  text: string;
  /** Set on streaming assistant text so deltas can append in place. While
   *  true and at the tail, this entry renders in the live frame rather
   *  than the committed scrollback log. */
  streaming?: boolean;
  /** Tool-results whose body was truncated keep the full text so Ctrl-O
   *  can reprint it as a NEW log entry — committed scrollback output can't
   *  be toggled in place. `text` always holds the short preview. */
  collapsible?: boolean;
  fullText?: string;
  /** Set once the full body has been reprinted so Ctrl-O won't duplicate it. */
  expanded?: boolean;
}

export interface AppState {
  banner: string;
  bannerData: BannerData;
  transcript: TranscriptEntry[];
  busy: boolean;
  /** Bumped by `clear` so the Static scrollback log remounts and stops
   *  reprinting the old (now-cleared) items. */
  clearGen: number;
  apiReady: boolean;
  activeSkill: string | null;
  pendingPerm: PermissionRequest | null;
  pendingAsk: AskRequest | null;
  /** When true, the interactive /skills picker is mounted. The picker
   *  reads live registry state on every render, so we don't keep any
   *  snapshot in this slot — a boolean is enough. */
  pendingSkills: boolean;
  yolo: boolean;
}

export function initialState(banner: string, bannerData: BannerData): AppState {
  return {
    banner,
    bannerData,
    transcript: [],
    busy: false,
    clearGen: 0,
    apiReady: true,
    activeSkill: null,
    pendingPerm: null,
    pendingAsk: null,
    pendingSkills: false,
    yolo: false,
  };
}

export type Action =
  | { type: 'set-banner'; banner: string }
  | { type: 'merge-banner-data'; patch: Partial<BannerData> }
  | { type: 'append'; entry: TranscriptEntry }
  | { type: 'append-delta'; text: string }
  | { type: 'set-busy'; busy: boolean }
  | { type: 'set-api-ready'; ready: boolean }
  | { type: 'set-active-skill'; name: string | null }
  | { type: 'set-yolo'; on: boolean }
  | { type: 'set-perm'; req: PermissionRequest | null }
  | { type: 'set-ask'; req: AskRequest | null }
  | { type: 'set-skills-picker'; open: boolean }
  | { type: 'expand-tool-output' }
  | { type: 'clear' }
  | { type: 'agent-event'; event: AgentEvent };

export function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'set-banner':
      return { ...state, banner: action.banner };
    case 'merge-banner-data':
      return { ...state, bannerData: { ...state.bannerData, ...action.patch } };
    case 'append':
      return { ...state, transcript: [...state.transcript, action.entry] };
    case 'append-delta': {
      const last = state.transcript[state.transcript.length - 1];
      if (last && last.kind === 'assistant' && last.streaming) {
        const updated = { ...last, text: last.text + action.text };
        return {
          ...state,
          transcript: [...state.transcript.slice(0, -1), updated],
        };
      }
      return {
        ...state,
        transcript: [
          ...state.transcript,
          { kind: 'assistant', text: action.text, streaming: true },
        ],
      };
    }
    case 'set-busy':
      return { ...state, busy: action.busy };
    case 'set-api-ready':
      return { ...state, apiReady: action.ready };
    case 'set-active-skill':
      return { ...state, activeSkill: action.name };
    case 'set-yolo':
      return { ...state, yolo: action.on };
    case 'set-perm':
      return { ...state, pendingPerm: action.req };
    case 'set-ask':
      return { ...state, pendingAsk: action.req };
    case 'set-skills-picker':
      return { ...state, pendingSkills: action.open };
    case 'expand-tool-output': {
      // Reprint the most recent not-yet-expanded collapsible tool-result's
      // full body as a NEW log entry. Committed scrollback can't be toggled
      // in place, so "expand" means append. Mark the source `expanded` so a
      // second Ctrl-O doesn't duplicate it; walk from the tail so Ctrl-O
      // acts on "the thing I just ran".
      let idx = -1;
      for (let i = state.transcript.length - 1; i >= 0; i -= 1) {
        const e = state.transcript[i];
        if (e?.collapsible && !e.expanded) {
          idx = i;
          break;
        }
      }
      if (idx === -1) return state;
      const entry = state.transcript[idx];
      if (!entry) return state;
      const transcript = [...state.transcript];
      transcript[idx] = { ...entry, expanded: true };
      transcript.push({ kind: 'tool-result', text: entry.fullText ?? entry.text });
      return { ...state, transcript };
    }
    case 'clear':
      // Reset the log and bump clearGen so the Static viewport remounts and
      // stops reprinting the cleared items. Prior output stays in the
      // terminal's native scrollback, like a real shell.
      return { ...state, transcript: [], clearGen: state.clearGen + 1 };
    case 'agent-event':
      return applyAgentEvent(state, action.event);
    default: {
      const _exhaustive: never = action;
      void _exhaustive;
      return state;
    }
  }
}

const TOOL_CALL_PREVIEW_CAP = 120;

/**
 * Collapse a tool-call's raw JSON args into a single-line preview for
 * the transcript: convert escaped \n / \t (from the LLM's JSON
 * encoding) and any raw control chars to single spaces, collapse runs,
 * truncate to TOOL_CALL_PREVIEW_CAP. Full args still go to the log.
 *
 * Without this, multi-line heredocs (`{"command":"python3 -c \"\nports = [\n  80,..."}`)
 * spill across the transcript with awkward terminal wrapping.
 */
function previewArgs(raw: string): string {
  const oneLine = raw
    .replace(/\\[nrt]/g, ' ')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (oneLine.length <= TOOL_CALL_PREVIEW_CAP) return oneLine;
  return `${oneLine.slice(0, TOOL_CALL_PREVIEW_CAP)}…`;
}

// Renders tool-call args for display. Some tools have a single, obvious
// argument worth showing bare instead of as raw JSON — e.g. the browser
// tool's `url`. Falls back to the one-line JSON preview otherwise.
function previewToolArgs(name: string, raw: string): string {
  try {
    const primary = primaryToolArg(name, JSON.parse(raw) as Record<string, unknown>);
    if (primary !== null) return previewArgs(primary);
  } catch {
    // Malformed/partial JSON — fall through to the raw preview.
  }
  return previewArgs(raw);
}

function applyAgentEvent(state: AppState, ev: AgentEvent): AppState {
  switch (ev.type) {
    case 'assistant-text': {
      // Finalize any active stream entry, or append a fresh one.
      const last = state.transcript[state.transcript.length - 1];
      if (last && last.kind === 'assistant' && last.streaming) {
        const finalized: TranscriptEntry = { ...last, streaming: false };
        return { ...state, transcript: [...state.transcript.slice(0, -1), finalized] };
      }
      return {
        ...state,
        transcript: [...state.transcript, { kind: 'assistant', text: ev.text }],
      };
    }
    case 'assistant-delta':
      return reducer(state, { type: 'append-delta', text: ev.text });
    case 'tool-call':
      return {
        ...state,
        transcript: [
          ...state.transcript,
          {
            kind: 'tool-call',
            text: `${displayToolName(ev.name)} ${previewToolArgs(ev.name, ev.argsJSON)}`,
          },
        ],
      };
    case 'tool-result': {
      const prefix = ev.err
        ? `[error] ${displayToolName(ev.name)}: ${ev.err}`
        : `[ok] ${displayToolName(ev.name)} (${ev.durationMs}ms)`;
      // Some tools have a compact one-line display form for their JSON
      // result (e.g. browser_capture_status). Use it when present; the
      // model still receives the raw JSON via the tool message.
      if (!ev.err) {
        const friendly = formatToolResult(ev.name, ev.result);
        if (friendly !== null) {
          return {
            ...state,
            transcript: [
              ...state.transcript,
              { kind: 'tool-result', text: `${prefix}\n${friendly}` },
            ],
          };
        }
      }
      // buildToolResultView pulls readable text out of MCP JSON envelopes,
      // colorizes shell-shaped output, and — for anything long — returns a
      // head-only preview plus the full body. Short results show a single
      // view (not collapsible). Collapsible ones keep `fullText` so Ctrl-O
      // can reprint the full body as a new log entry ('expand-tool-output').
      const view = buildToolResultView(ev.result);
      const collapsedText = `${prefix}\n${view.preview}`;
      if (!view.collapsible) {
        return {
          ...state,
          transcript: [...state.transcript, { kind: 'tool-result', text: collapsedText }],
        };
      }
      return {
        ...state,
        transcript: [
          ...state.transcript,
          {
            kind: 'tool-result',
            text: collapsedText,
            collapsible: true,
            fullText: `${prefix}\n${view.full}`,
          },
        ],
      };
    }
    case 'error':
      return {
        ...state,
        transcript: [...state.transcript, { kind: 'error', text: ev.err.message }],
      };
    case 'compact':
      return {
        ...state,
        transcript: [...state.transcript, { kind: 'system', text: `compacted: ${ev.summary}` }],
      };
    case 'skill-active':
      return { ...state, activeSkill: ev.name };
    case 'done': {
      // End of turn: finalize a trailing streaming assistant entry so it
      // moves out of the live frame and into the committed scrollback log.
      const last = state.transcript[state.transcript.length - 1];
      if (last && last.kind === 'assistant' && last.streaming) {
        const finalized: TranscriptEntry = { ...last, streaming: false };
        return {
          ...state,
          busy: false,
          transcript: [...state.transcript.slice(0, -1), finalized],
        };
      }
      return { ...state, busy: false };
    }
    default: {
      const _exhaustive: never = ev;
      void _exhaustive;
      return state;
    }
  }
}
