// Top-level Ink component. Owns the input value + keymap so the slash
// and @file menus can intercept Tab / arrows before they reach the
// input.

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Chalk } from 'chalk';
import { Box, useApp, useInput, useStdout } from 'ink';
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import type { Agent } from '../agent/agent.js';
import { findActiveMention, listMentionDir, parseMentionPath } from '../agent/mentions.js';
import type { Backend } from '../config/config.js';
import { listModels } from '../llm/models.js';
import { renderSkillTemplate } from '../skills/template.js';
import { AskModal } from './AskModal.js';
import type { BannerData } from './Banner.js';
import { Input } from './Input.js';
import { MentionMenu } from './MentionMenu.js';
import { PermissionModal } from './PermissionModal.js';
import { SkillsModal } from './SkillsModal.js';
import { SlashMenu } from './SlashMenu.js';
import { StatusBar } from './StatusBar.js';
import { useTerminalSize } from './TerminalSize.js';
import { EntryView, Transcript } from './Transcript.js';
import type { AskRequest } from './askBridge.js';
import { SLASH_ITEMS, filterSlash } from './slashItems.js';
import type { Action } from './state.js';
import { initialState, reducer } from './state.js';
import { usePing } from './usePing.js';
import { looksLikePaste, stripPasteMarkers, useTextField } from './useTextField.js';

/** Mutate the live config + agent client + persist to disk. CLI wires this. */
export interface ProviderChange {
  backend: Backend;
  model: string;
  baseURL?: string;
  apiKey?: string;
}
export type ApplyProvider = (change: ProviderChange) => Promise<void>;
/** Persist a disabled-skills list change (writes ~/.pentesterflow/config.json). */
export type PersistDisabledSkills = (names: string[]) => Promise<void>;

const MENTION_LIMIT = 12;

// Clear screen (2J) + wipe the scrollback buffer (3J) + cursor home (H).
// Used by /clear and /reset so the conversation is truly gone, not just
// scrolled off — then Ink reprints the banner via the Static remount.
const CLEAR_SCREEN = '\x1b[2J\x1b[3J\x1b[H';

export interface AppProps {
  agent: Agent;
  bannerData: BannerData;
  parentSignal: AbortSignal;
  /** Wire bridge publishers into our dispatch so modals appear. Both
   *  fire from the agent goroutine; we mount them once on first render. */
  bindPermPublisher?: (
    publish: (req: import('./permBridge.js').PermissionRequest | null) => void,
  ) => void;
  bindAskPublisher?: (publish: (req: import('./askBridge.js').AskRequest | null) => void) => void;
  yoloInitial?: boolean;
  /** Read the live config so /provider picker knows current backend / URL / key. */
  readConfig: () => { backend: Backend; baseURL: string; apiKey: string; model: string };
  /** Mutate config + swap agent client + persist. Used by /provider and /model. */
  applyProvider: ApplyProvider;
  /** Flip live YOLO gating on the prompter. Wired by the CLI to
   *  prompter.setYolo so the displayed pill and the actual gate never
   *  drift. Optional so tests/headless can omit it. */
  setYolo?: (on: boolean) => void;
  /** Optional bridge: lets the CLI push BannerData patches (e.g. tool-support
   *  probe result, detected num_ctx) after the TUI has mounted. */
  bindBannerPublisher?: (publish: (patch: Partial<BannerData>) => void) => void;
  /** Persist /skills enable/disable to ~/.pentesterflow/config.json. */
  persistDisabledSkills?: PersistDisabledSkills;
  /** Notify the CLI that `/skills new` created a skill under this root dir,
   *  so it can start watching it for hot-reload. */
  onSkillCreated?: (skillRootDir: string) => void;
  /** Optional bridge for out-of-loop system notices — live-reload uses
   *  it to surface "skill reloaded" without a modal. */
  bindNoticePublisher?: (publish: (text: string) => void) => void;
}

export function App({
  agent,
  bannerData,
  parentSignal,
  bindPermPublisher,
  bindAskPublisher,
  yoloInitial,
  readConfig,
  applyProvider,
  setYolo,
  bindBannerPublisher,
  persistDisabledSkills,
  onSkillCreated,
  bindNoticePublisher,
}: AppProps): JSX.Element {
  const [state, dispatch] = useReducer(reducer, '', () => {
    const s = initialState('', bannerData);
    if (yoloInitial) s.yolo = true;
    return s;
  });
  // Input value + cursor live here so the slash / @file menus can
  // intercept keys (Tab/arrows) before they affect editing. useTextField
  // gives us multi-line, cursor-aware actions.
  const input = useTextField('');
  const inputValue = input.value;
  const [slashIdx, setSlashIdx] = useState(0);
  const [mentionIdx, setMentionIdx] = useState(0);
  const { exit } = useApp();
  const { stdout } = useStdout();
  const runCtl = useRef<AbortController | null>(null);

  // Physically clear the terminal (screen + scrollback) for /clear and
  // /reset. Ink reprints the banner afterwards via the Static remount that
  // the `clear` action triggers (clearGen bump).
  const clearScreen = useCallback(() => stdout.write(CLEAR_SCREEN), [stdout]);

  // Toggle YOLO in one place: flip the real gate (prompter) AND the
  // displayed pill together so they can never disagree.
  const applyYolo = useCallback(
    (on: boolean) => {
      setYolo?.(on);
      dispatch({ type: 'set-yolo', on });
    },
    [setYolo],
  );

  // ---- session-scoped prompt history (↑/↓ in the input). Most-recent
  // ---- last; duplicates of the immediately-previous entry are dropped
  // ---- to match bash's HISTCONTROL=ignoredups. `historyIdx === null`
  // ---- means the user is drafting (not navigating history). When the
  // ---- user moves into history mode, the in-progress text is stashed
  // ---- in `historyDraft` so Down-past-newest restores it.
  const historyRef = useRef<string[]>([]);
  const historyDraft = useRef<string>('');
  const [historyIdx, setHistoryIdx] = useState<number | null>(null);
  const HISTORY_CAP = 500;

  // Bridge publishers wired exactly once so prompts surface as modals.
  useEffect(() => {
    bindPermPublisher?.((req) => dispatch({ type: 'set-perm', req }));
    bindAskPublisher?.((req) => dispatch({ type: 'set-ask', req }));
    bindBannerPublisher?.((patch) => dispatch({ type: 'merge-banner-data', patch }));
    bindNoticePublisher?.((text) => dispatch({ type: 'append', entry: { kind: 'system', text } }));
  }, [bindPermPublisher, bindAskPublisher, bindBannerPublisher, bindNoticePublisher]);

  // Live terminal width via the TerminalSizeProvider mounted in
  // cli/index.ts. Subscribes to stdout `resize` so the layout reflows
  // whenever the user widens or narrows their window. Height is no longer
  // needed: the log lives in native scrollback, not a fixed viewport.
  const { columns: cols } = useTerminalSize();

  // The banner is printed once into scrollback, so freeze the launch-time
  // snapshot — and drop the fields that resolve asynchronously (the
  // tool-support pill, the detected context window). Those would otherwise
  // be frozen at their startup placeholder (e.g. "probing…") forever; the
  // live values are shown in the StatusBar instead.
  const bannerSnapshot = useRef<BannerData>({
    ...bannerData,
    toolSupport: undefined,
    contextWindow: undefined,
  }).current;

  // Live health probe.
  const clientGetter = useCallback(() => agent.client, [agent]);
  const setReady = useCallback((ok: boolean) => dispatch({ type: 'set-api-ready', ready: ok }), []);
  usePing(clientGetter, setReady);

  // SIGINT (and parent abort) tears down any in-flight run, then exits.
  useEffect(() => {
    const onAbort = () => {
      runCtl.current?.abort();
      exit();
    };
    if (parentSignal.aborted) onAbort();
    else parentSignal.addEventListener('abort', onAbort, { once: true });
    return () => parentSignal.removeEventListener('abort', onAbort);
  }, [parentSignal, exit]);

  // ---------- menu state ----------

  // Slash menu is shown when input starts with `/` and we haven't
  // crossed a space (so the user has selected a command but not yet
  // started typing args). Dynamic extras: one `/<skill-name>` entry per
  // enabled skill so the menu surfaces direct-invoke alongside the
  // built-in commands. Disabled skills are excluded — re-enabling from
  // /skills brings them back into the menu. Computed eagerly (no memo)
  // because the live-reload watcher mutates the registry in place and
  // we want every render to see the current set.
  const skillSlashItems = agent.skills.listEnabled().map((s) => ({
    name: `/${s.name}`,
    description: `[skill] ${s.description.slice(0, 70)}${s.description.length > 70 ? '…' : ''}`,
  }));
  const slashMatches = filterSlash(inputValue, skillSlashItems);

  // @file picker is shown when the active word starts with `@<partial>`.
  // Path-aware: `@src/ag` lists matches in src/; `@../` ascends; the
  // picker shows `..` so the user can step out without typing it.
  const mentionCtx = useMemo(() => findActiveMention(inputValue), [inputValue]);
  const mentionDirBase = useMemo(
    () => (mentionCtx ? parseMentionPath(mentionCtx.partial) : null),
    [mentionCtx],
  );
  const mentionMatches = useMemo(
    () =>
      mentionDirBase ? listMentionDir(mentionDirBase.dir, mentionDirBase.base, MENTION_LIMIT) : [],
    [mentionDirBase],
  );

  // Reset menu selection when the relevant menu (re)appears.
  useEffect(() => {
    if (slashMatches.length > 0) setSlashIdx(0);
  }, [slashMatches.length]);
  useEffect(() => {
    if (mentionMatches.length > 0) setMentionIdx(0);
  }, [mentionMatches.length]);

  // ---------- key handling ----------

  const submit = useCallback(
    (value: string) => {
      // Record the submission in session history before doing anything
      // else. Slash commands are included so /provider, /skills, etc.
      // are recallable too — that matches bash and zsh semantics. Drop
      // an immediate duplicate of the previous entry to avoid filling
      // history with repeated /clear or /help calls.
      const recorded = value.trim();
      if (recorded.length > 0) {
        const h = historyRef.current;
        if (h[h.length - 1] !== recorded) {
          h.push(recorded);
          if (h.length > HISTORY_CAP) h.shift();
        }
      }
      // Reset navigation state — submitting always exits history mode.
      setHistoryIdx(null);
      historyDraft.current = '';

      if (value.startsWith('/')) {
        const handled = handleSlash(
          agent,
          value,
          dispatch,
          exit,
          clearScreen,
          state.yolo,
          applyYolo,
          readConfig,
          applyProvider,
          persistDisabledSkills,
          onSkillCreated,
        );
        if (handled) return;
      }
      dispatch({ type: 'append', entry: { kind: 'user', text: value } });
      dispatch({ type: 'set-busy', busy: true });
      const ctl = new AbortController();
      runCtl.current = ctl;
      void agent
        .run(value, ctl.signal, (ev) => dispatch({ type: 'agent-event', event: ev }))
        .catch((err: unknown) => {
          dispatch({
            type: 'append',
            entry: { kind: 'error', text: err instanceof Error ? err.message : String(err) },
          });
        });
    },
    [
      agent,
      exit,
      clearScreen,
      state.yolo,
      applyYolo,
      readConfig,
      applyProvider,
      persistDisabledSkills,
      onSkillCreated,
    ],
  );

  useInput((rawInput, key) => {
    // 0. Always-on: Ctrl-C kills the app; Esc cancels an in-flight run.
    if (key.ctrl && rawInput === 'c') {
      runCtl.current?.abort();
      exit();
      return;
    }
    if (key.escape && state.busy) {
      runCtl.current?.abort();
      return;
    }

    // 1. Modal overlays consume keys before us.
    if (state.pendingPerm || state.pendingAsk || state.pendingSkills) return;

    // 2. History scrolling is the terminal's own job now — the transcript
    //    lives in native scrollback (Ink <Static>), so the mouse wheel and
    //    scrollbar reach the full conversation. No in-app scroll keys.
    //
    //    Ctrl-O ("output") reprints the most recent truncated tool-result's
    //    full body as a new log entry — e.g. the full browser accessibility
    //    snapshot behind a "… N more lines" notice. No-op when nothing is
    //    collapsible.
    if (key.ctrl && rawInput === 'o') {
      dispatch({ type: 'expand-tool-output' });
      return;
    }

    // 3. Active @file picker (takes priority over slash so /commands
    //    don't interfere when the user already engaged the @ menu).
    if (mentionMatches.length > 0) {
      if (key.upArrow) {
        setMentionIdx((i) => (i - 1 + mentionMatches.length) % mentionMatches.length);
        return;
      }
      if (key.downArrow) {
        setMentionIdx((i) => (i + 1) % mentionMatches.length);
        return;
      }
      if (key.tab || key.return) {
        const picked = mentionMatches[mentionIdx];
        if (picked && mentionCtx) {
          // Directories: descend by replacing the partial with the new
          // path and leave the picker engaged (no trailing space). The
          // path already ends in `/`, so the next render will list it.
          // Files: replace with `@<path> ` and close the picker.
          const head = inputValue.slice(0, mentionCtx.at);
          const suffix = picked.isDir ? '' : ' ';
          input.setValue(`${head}@${picked.insert}${suffix}`);
        }
        return;
      }
      if (key.escape) {
        // Strip the @<partial> back to the @ itself so the menu drops.
        if (mentionCtx) input.setValue(inputValue.slice(0, mentionCtx.at));
        return;
      }
    }

    // 4. Active slash menu.
    if (slashMatches.length > 0) {
      if (key.upArrow) {
        setSlashIdx((i) => (i - 1 + slashMatches.length) % slashMatches.length);
        return;
      }
      if (key.downArrow) {
        setSlashIdx((i) => (i + 1) % slashMatches.length);
        return;
      }
      if (key.tab) {
        const picked = slashMatches[slashIdx];
        if (picked) input.setValue(picked.args ? `${picked.name} ` : picked.name);
        return;
      }
      if (key.return) {
        // Enter on a menu: if the typed input is already a complete
        // command, submit it; otherwise complete the highlighted one.
        const picked = slashMatches[slashIdx];
        const typed = inputValue.trim();
        if (picked && typed === picked.name) {
          input.clear();
          submit(typed);
          return;
        }
        if (picked) {
          input.setValue(picked.args ? `${picked.name} ` : picked.name);
          return;
        }
      }
      if (key.escape) {
        input.clear();
        return;
      }
    }

    // 5. Normal multi-line input editing.
    if (state.busy) return;

    // 5a. Esc clears the input when there's text to clear. The
    //     "Esc = give up on this draft" gesture — at
    //     this point in the keymap the menu / modal Esc-handlers above
    //     have already returned, so we know the user wants to abandon
    //     a half-typed prompt, not dismiss a menu.
    if (key.escape) {
      if (inputValue.length > 0) input.clear();
      // Always exit history mode on Esc — the next ↑ should walk from
      // the newest entry, not from wherever we last were.
      if (historyIdx !== null) {
        setHistoryIdx(null);
        historyDraft.current = '';
      }
      return;
    }

    // 5b. Bracketed paste / multi-character chunks. Insert wholesale
    //     so an embedded newline doesn't auto-submit the half-typed
    //     prompt (and so heredocs / payloads land in one piece).
    if (looksLikePaste(rawInput, key)) {
      input.insertText(stripPasteMarkers(rawInput));
      return;
    }

    // 5b. Ctrl-N (or Ctrl-J on some terminals) → insert a newline
    //     instead of submitting (the Ctrl-J convention). Ink reports Ctrl-J as key.return + key.ctrl on most
    //     terminals; some report it as key.ctrl + input === 'j'.
    if (key.ctrl && (rawInput === 'n' || rawInput === 'j' || (key.return && rawInput === ''))) {
      input.insertText('\n');
      return;
    }

    if (key.return) {
      const v = inputValue.trim();
      if (v.length === 0) return;
      input.clear();
      submit(v);
      return;
    }

    // 5c. Cursor movement.
    if (key.leftArrow) {
      input.moveLeft();
      return;
    }
    if (key.rightArrow) {
      input.moveRight();
      return;
    }
    // ↑/↓ either move the cursor between lines of a multi-line input, or
    // — when the cursor is on the first/last line — walk session prompt
    // history (bash-style). The history navigation kicks in only when
    // moving up/down within the input wouldn't change anything useful:
    //
    //   - ↑ on the first line  → previous history entry (newer→older).
    //   - ↓ on the last line   → next history entry; past the newest,
    //     restore the draft the user had before entering history mode.
    if (key.upArrow) {
      if (cursorIsOnFirstLine(inputValue, input.cursor)) {
        const h = historyRef.current;
        if (h.length === 0) return;
        if (historyIdx === null) {
          // Entering history mode — stash the draft so Down can restore it.
          historyDraft.current = inputValue;
          const next = h.length - 1;
          setHistoryIdx(next);
          input.setValue(h[next] ?? '');
        } else if (historyIdx > 0) {
          const next = historyIdx - 1;
          setHistoryIdx(next);
          input.setValue(h[next] ?? '');
        }
        return;
      }
      input.moveUp();
      return;
    }
    if (key.downArrow) {
      if (cursorIsOnLastLine(inputValue, input.cursor)) {
        if (historyIdx === null) return; // not in history mode, nothing below
        const h = historyRef.current;
        const next = historyIdx + 1;
        if (next >= h.length) {
          // Past the newest entry → restore whatever draft we stashed.
          setHistoryIdx(null);
          input.setValue(historyDraft.current);
          historyDraft.current = '';
        } else {
          setHistoryIdx(next);
          input.setValue(h[next] ?? '');
        }
        return;
      }
      input.moveDown();
      return;
    }
    if (key.ctrl && rawInput === 'a') {
      input.moveLineStart();
      return;
    }
    if (key.ctrl && rawInput === 'e') {
      input.moveLineEnd();
      return;
    }

    // 5d. Deletion. macOS keyboards label the left-delete key "delete"
    // and many terminals report it as key.delete (not key.backspace).
    // Treat both as delete-left so the key matches user expectation; a
    // true forward-delete can be added via a chord later if anyone asks.
    // The behavior also matches our original single-line input which
    // collapsed both into a single setValue((v) => v.slice(0, -1)).
    if (key.backspace || key.delete) {
      input.backspace();
      return;
    }

    // 5e. Other chords reserved (Ctrl-L clear-transcript is handled
    //     elsewhere; Ctrl-K kill, Ctrl-Y yank could land later).
    if (key.ctrl || key.meta) return;

    // 5f. Plain printable character.
    if (rawInput && !key.escape) {
      input.insertText(rawInput);
    }
  });

  // ---------- layout ----------

  // The committed log goes to native scrollback (Ink <Static>); only the
  // actively-streaming assistant entry (tail entry still flagged
  // `streaming`) renders in the live frame below, until 'done' finalizes
  // it and it joins the committed log.
  const liveEntry = (() => {
    const last = state.transcript[state.transcript.length - 1];
    return last && last.kind === 'assistant' && last.streaming ? last : null;
  })();
  const committed = liveEntry ? state.transcript.slice(0, -1) : state.transcript;

  return (
    <Box flexDirection="column" width={cols}>
      <Transcript committed={committed} bannerData={bannerSnapshot} generation={state.clearGen} />
      {liveEntry ? (
        <Box flexDirection="column">
          <EntryView entry={liveEntry} />
        </Box>
      ) : null}
      {state.pendingAsk ? (
        <AskModal req={state.pendingAsk} />
      ) : state.pendingPerm ? (
        <PermissionModal req={state.pendingPerm} />
      ) : state.pendingSkills ? (
        <SkillsModal
          agent={agent}
          persistDisabledSkills={persistDisabledSkills}
          onClose={() => dispatch({ type: 'set-skills-picker', open: false })}
        />
      ) : (
        <>
          {mentionMatches.length > 0 ? (
            <MentionMenu
              cwd={mentionDirBase?.dir ?? ''}
              candidates={mentionMatches}
              selected={mentionIdx}
            />
          ) : slashMatches.length > 0 ? (
            <SlashMenu items={slashMatches} selected={slashIdx} />
          ) : null}
          <Input value={inputValue} cursor={input.cursor} disabled={state.busy} />
          <StatusBar
            busy={state.busy}
            apiReady={state.apiReady}
            activeSkill={state.activeSkill}
            yolo={state.yolo}
            ctxTokens={agent.approxTokens()}
            model={state.bannerData.model}
            toolSupport={state.bannerData.toolSupport}
            expandHint={state.transcript.some((e) => e.collapsible && !e.expanded)}
          />
        </>
      )}
    </Box>
  );
}

// ---------- helpers ----------

/**
 * True when the cursor sits on the first line of the input. We use it to
 * gate prompt-history nav: ↑ should walk history only when the user
 * isn't trying to move the cursor up within multi-line text. Single-line
 * inputs (no `\n` anywhere) trivially satisfy this.
 */
function cursorIsOnFirstLine(value: string, cursor: number): boolean {
  return value.lastIndexOf('\n', cursor - 1) === -1;
}

/** Symmetric helper for ↓: cursor is on the input's last line. */
function cursorIsOnLastLine(value: string, cursor: number): boolean {
  return value.indexOf('\n', cursor) === -1;
}

// ---------- slash command dispatcher ----------

function handleSlash(
  agent: Agent,
  raw: string,
  dispatch: React.Dispatch<Action>,
  exit: () => void,
  clearScreen: () => void,
  yolo: boolean,
  applyYolo: (on: boolean) => void,
  readConfig: () => { backend: Backend; baseURL: string; apiKey: string; model: string },
  applyProvider: ApplyProvider,
  persistDisabledSkills: PersistDisabledSkills | undefined,
  onSkillCreated: ((skillRootDir: string) => void) | undefined,
): boolean {
  const [cmd, ...rest] = raw.trim().split(/\s+/);
  switch (cmd) {
    case '/exit':
    case '/quit':
      exit();
      return true;
    case '/yolo': {
      // `/yolo` toggles; `/yolo on|off` sets explicitly. Flips the gate
      // and the pill together via applyYolo.
      const arg = rest[0]?.toLowerCase();
      const next = arg === 'on' ? true : arg === 'off' ? false : !yolo;
      applyYolo(next);
      dispatch({
        type: 'append',
        entry: {
          kind: 'system',
          text: next
            ? 'YOLO on — every tool call will auto-approve. Authorized / lab targets only.'
            : 'YOLO off — tool calls will prompt again.',
        },
      });
      return true;
    }
    case '/clear':
      clearScreen();
      dispatch({ type: 'clear' });
      return true;
    case '/reset':
      void agent.reset();
      clearScreen();
      dispatch({ type: 'clear' });
      dispatch({ type: 'append', entry: { kind: 'system', text: 'conversation reset' } });
      return true;
    case '/help':
      dispatch({
        type: 'append',
        entry: { kind: 'system', text: buildHelpText(agent, readConfig) },
      });
      return true;
    case '/provider':
      openProviderPicker(dispatch, readConfig, applyProvider);
      return true;
    case '/model': {
      const m = rest.join(' ').trim();
      if (!m) {
        const cur = readConfig();
        dispatch({
          type: 'append',
          entry: {
            kind: 'system',
            text: `current model: ${cur.model || '(unset)'}\nusage: /model <id>  ·  or run /provider for an interactive picker`,
          },
        });
        return true;
      }
      const cur = readConfig();
      // Validate the id against the live backend catalog before swapping
      // the client. A typo here used to persist into config.json and the
      // agent would fail on the next chat with a confusing 404; now the
      // user gets an immediate did-you-mean response.
      void (async () => {
        let known: string[] = [];
        try {
          known = await listModels(cur.backend, cur.baseURL, cur.apiKey);
        } catch (err) {
          // Soft fail: if listing isn't available we still proceed,
          // since some custom endpoints don't implement /models.
          dispatch({
            type: 'append',
            entry: {
              kind: 'system',
              text: `(could not list models from backend: ${(err as Error).message} — proceeding without validation)`,
            },
          });
        }
        if (known.length > 0 && !known.includes(m)) {
          const suggestion = suggestClosest(m, known);
          dispatch({
            type: 'append',
            entry: {
              kind: 'error',
              text: suggestion
                ? `model "${m}" not found on backend. did you mean: ${suggestion}?`
                : `model "${m}" not found on backend. available: ${known.slice(0, 8).join(', ')}${known.length > 8 ? ', …' : ''}`,
            },
          });
          return;
        }
        try {
          await applyProvider({ backend: cur.backend, model: m });
          dispatch({
            type: 'append',
            entry: { kind: 'system', text: `model set to ${m}` },
          });
        } catch (err: unknown) {
          dispatch({
            type: 'append',
            entry: { kind: 'error', text: `model: ${(err as Error).message}` },
          });
        }
      })();
      return true;
    }
    case '/target': {
      const u = rest.join(' ').trim();
      if (!u) {
        void agent.clearTarget();
        dispatch({ type: 'append', entry: { kind: 'system', text: 'target cleared' } });
      } else {
        void agent.setTargetBaseURL(u);
        dispatch({ type: 'append', entry: { kind: 'system', text: `target set to ${u}` } });
      }
      return true;
    }
    case '/maxsteps': {
      const n = Number.parseInt(rest[0] ?? '', 10);
      if (Number.isFinite(n) && n > 0) {
        agent.setMaxSteps(n);
        dispatch({ type: 'append', entry: { kind: 'system', text: `max steps set to ${n}` } });
      } else {
        dispatch({ type: 'append', entry: { kind: 'error', text: 'usage: /maxsteps <n>' } });
      }
      return true;
    }
    case '/thinking': {
      const v = (rest[0] ?? '').toLowerCase();
      if (v !== 'on' && v !== 'off') {
        dispatch({ type: 'append', entry: { kind: 'error', text: 'usage: /thinking on|off' } });
        return true;
      }
      void agent.setThinkingEnabled(v === 'on');
      dispatch({ type: 'append', entry: { kind: 'system', text: `thinking ${v}` } });
      return true;
    }
    case '/skills': {
      handleSkillsCommand(agent, rest, dispatch, persistDisabledSkills, onSkillCreated);
      return true;
    }
    default: {
      // Fallback: `/<skill-name>` is shorthand for "load this skill
      // explicitly, the next turn applies it." A direct-invoke
      // shorthand. Strip the leading slash and check the
      // registry; anything else is an unknown command.
      const skillName = cmd?.slice(1) ?? '';
      if (skillName && agent.skills.has(skillName)) {
        void agent
          .injectSkill(skillName)
          .then((n) =>
            dispatch({
              type: 'append',
              entry: {
                kind: 'system',
                text: `loaded /${n} — it'll apply to your next prompt.`,
              },
            }),
          )
          .catch((err: unknown) =>
            dispatch({
              type: 'append',
              entry: { kind: 'error', text: `/${skillName}: ${(err as Error).message}` },
            }),
          );
        return true;
      }
      return false;
    }
  }
}

/**
 * /skills — list / enable / disable. Without args, prints the loaded
 * skills with their on/off state. `/skills <name>` toggles. Explicit
 * `/skills enable <name>` and `/skills disable <name>` are also accepted.
 * Persistence to ~/.pentesterflow/config.json is delegated to the
 * persistDisabledSkills callback wired by the CLI.
 */
function handleSkillsCommand(
  agent: Agent,
  rest: string[],
  dispatch: React.Dispatch<Action>,
  persistDisabledSkills: PersistDisabledSkills | undefined,
  onSkillCreated: ((skillRootDir: string) => void) | undefined,
): void {
  const all = agent.skills.list();
  if (all.length === 0) {
    dispatch({
      type: 'append',
      entry: { kind: 'system', text: '/skills: no skills are loaded' },
    });
    return;
  }

  // No args → open the interactive picker. SkillsModal reads the live
  // registry and dispatches its own toggles through agent.setSkillEnabled
  // + persistDisabledSkills.
  if (rest.length === 0) {
    dispatch({ type: 'set-skills-picker', open: true });
    return;
  }

  // /skills new <name> — scaffold a skill under
  // ./.pentesterflow/skills/<name>/SKILL.md (an auto-discovered dir), then
  // hot-load it so it's usable immediately via /<name>.
  if (rest[0] === 'new') {
    const name = (rest[1] ?? '').trim();
    if (!/^[a-z0-9-]+$/.test(name)) {
      dispatch({
        type: 'append',
        entry: {
          kind: 'error',
          text: 'usage: /skills new <name>  (lowercase, letters/digits/hyphens)',
        },
      });
      return;
    }
    const skillsRoot = resolve(process.cwd(), '.pentesterflow', 'skills');
    const dir = join(skillsRoot, name);
    const file = join(dir, 'SKILL.md');
    if (existsSync(file)) {
      dispatch({
        type: 'append',
        entry: { kind: 'error', text: `/skills new: a skill already exists at ${file}` },
      });
      return;
    }
    try {
      mkdirSync(dir, { recursive: true });
      writeFileSync(file, renderSkillTemplate(name), 'utf8');
      // Load it now so the user doesn't have to restart; future edits
      // hot-reload via the dir watcher.
      agent.skills.loadDir(skillsRoot);
      agent.rebuildFromSkills();
      // Tell the CLI to start watching this dir so future edits hot-reload
      // even if .pentesterflow/skills didn't exist at startup.
      onSkillCreated?.(skillsRoot);
      dispatch({
        type: 'append',
        entry: {
          kind: 'system',
          text: `created skill "${name}" at ${file}\nedit it (hot-reloads on save), then invoke with /${name}.`,
        },
      });
    } catch (err) {
      dispatch({
        type: 'append',
        entry: { kind: 'error', text: `/skills new: ${(err as Error).message}` },
      });
    }
    return;
  }

  // Parse explicit/implicit verb.
  let verb: 'enable' | 'disable' | 'toggle';
  let name: string;
  if (rest[0] === 'enable' || rest[0] === 'disable') {
    verb = rest[0];
    name = rest.slice(1).join(' ').trim();
  } else {
    verb = 'toggle';
    name = rest.join(' ').trim();
  }
  if (!name) {
    dispatch({
      type: 'append',
      entry: { kind: 'error', text: 'usage: /skills <name>  ·  /skills enable|disable <name>' },
    });
    return;
  }
  if (!agent.skills.has(name)) {
    dispatch({
      type: 'append',
      entry: {
        kind: 'error',
        text: `/skills: unknown skill "${name}". Run /skills to list available skills.`,
      },
    });
    return;
  }
  const targetEnabled =
    verb === 'enable' ? true : verb === 'disable' ? false : agent.skills.isDisabled(name); // toggle → enable if disabled
  void agent
    .setSkillEnabled(name, targetEnabled)
    .then(async (changed) => {
      if (!changed) {
        dispatch({
          type: 'append',
          entry: {
            kind: 'system',
            text: `/skills: ${name} already ${targetEnabled ? 'enabled' : 'disabled'}`,
          },
        });
        return;
      }
      // Persist the new disabled set across restarts.
      if (persistDisabledSkills) {
        try {
          await persistDisabledSkills(agent.skills.disabledNames());
        } catch (err) {
          dispatch({
            type: 'append',
            entry: {
              kind: 'error',
              text: `/skills: state changed but could not persist: ${(err as Error).message}`,
            },
          });
          return;
        }
      }
      dispatch({
        type: 'append',
        entry: {
          kind: 'system',
          text: `/skills: ${name} ${targetEnabled ? 'enabled' : 'disabled'}`,
        },
      });
    })
    .catch((err: unknown) => {
      dispatch({
        type: 'append',
        entry: { kind: 'error', text: `/skills: ${(err as Error).message}` },
      });
    });
}

// ---------- /help — sectioned reference card ----------

// Standalone chalk instance pinned to truecolor so the help panel
// renders consistently regardless of the parent component's color
// inference. The transcript's role-color wrapper doesn't strip embedded
// ANSI, so accents survive into render.
const helpChalk = new Chalk({ level: 3 });

const KEYBINDINGS: Array<{ keys: string; desc: string }> = [
  { keys: '@<file>', desc: 'inline a file into the next turn (Tab opens a picker)' },
  { keys: '/', desc: 'open the slash-command menu' },
  { keys: '↑ / ↓', desc: 'walk session prompt history (on first / last line of input)' },
  { keys: 'Shift-Enter', desc: 'newline inside the input' },
  { keys: 'Ctrl-O', desc: 'reprint the latest truncated tool output in full' },
  { keys: 'mouse wheel / scrollbar', desc: 'scroll the conversation (native terminal scrollback)' },
  { keys: 'Esc', desc: 'cancel an in-flight turn / clear the input draft' },
  { keys: 'Ctrl-C', desc: 'quit pentesterflow' },
];

const TIPS: string[] = [
  'browser_capture_* tools surface live request / cookie / storage data once the Chrome extension is forwarding to a --browser-ingest server.',
  'coverage(action="untested", candidates=[...], vuln_classes=[...]) returns the (endpoint, param, class) tuples you have NOT tested yet — drive the next pass off of it.',
  'read_payloads(skill="<name>") pulls curated wordlists from disk. Skills like ssti / jwt ship pre-canned payload files in their payloads/ directory.',
  "Disabled skills are hidden from the agent's system prompt entirely. Use /skills to flip a skill back on without restarting.",
  '/model <id> validates against the live backend catalog and suggests the closest match on typo. /provider for the full interactive picker.',
];

function pad(s: string, n: number): string {
  return s.length >= n ? s : s + ' '.repeat(n - s.length);
}

function buildHelpText(
  agent: Agent,
  readConfig: () => { backend: Backend; baseURL: string; apiKey: string; model: string },
): string {
  const c = helpChalk;
  const cfg = readConfig();
  const enabled = agent.skills.listEnabled().length;
  const total = agent.skills.list().length;
  const target = agent.target.baseURL() || '(none — engagement unset)';
  const provider = cfg.backend || 'ollama';
  const model = cfg.model || agent.client.model() || '(unset)';

  const out: string[] = [];

  out.push(c.bold.cyan('PentesterFlow') + c.gray(' — quick reference'));
  out.push(c.gray('─'.repeat(60)));
  out.push('');

  // Session ----------------------------------------------------------
  out.push(c.bold.white('Session'));
  out.push(`  ${c.gray('provider')}   ${c.white(provider)}`);
  out.push(`  ${c.gray('model')}      ${c.white(model)}`);
  out.push(`  ${c.gray('target')}     ${c.white(target)}`);
  out.push(
    `  ${c.gray('limits')}     max-steps ${c.white(String(agent.getMaxSteps()))}` +
      `  ·  auto-compact ${c.white(String(agent.getAutoCompactThreshold()))} tok` +
      `  ·  thinking ${c.white(agent.thinkingIsEnabled() ? 'on' : 'off')}`,
  );
  out.push(`  ${c.gray('skills')}     ${c.white(`${enabled}/${total}`)} enabled`);
  out.push('');

  // Slash commands ---------------------------------------------------
  out.push(c.bold.white('Slash commands'));
  // Width of "name args" column for alignment.
  const namelines = SLASH_ITEMS.map((s) => (s.args ? `${s.name} ${s.args}` : s.name));
  const w = Math.min(36, Math.max(...namelines.map((n) => n.length)) + 2);
  SLASH_ITEMS.forEach((s, i) => {
    const left = pad(namelines[i] ?? '', w);
    out.push(`  ${c.cyan(left)}${c.gray(s.description)}`);
  });
  out.push('');

  // Keybindings ------------------------------------------------------
  out.push(c.bold.white('Input & navigation'));
  const kw = Math.max(...KEYBINDINGS.map((k) => k.keys.length)) + 2;
  for (const k of KEYBINDINGS) {
    out.push(`  ${c.cyan(pad(k.keys, kw))}${c.gray(k.desc)}`);
  }
  out.push('');

  // Tips -------------------------------------------------------------
  out.push(c.bold.white('Tips'));
  for (const t of TIPS) {
    // Wrap each tip to ~88 cols, manually so we don't blow the
    // terminal layout. Words only.
    const words = t.split(' ');
    let line = '  • ';
    for (const w of words) {
      if (line.length + w.length + 1 > 88) {
        out.push(c.gray(line));
        line = '    ';
      }
      line += `${w} `;
    }
    if (line.trim().length > 0) out.push(c.gray(line.trimEnd()));
  }
  out.push('');
  out.push(c.gray('Type ') + c.cyan('/') + c.gray(' for the live command menu.'));

  return out.join('\n');
}

// ---------- /provider interactive flow ----------

/** Open the backend picker. Re-uses the AskModal plumbing by synthesizing
 *  an AskRequest dispatched straight into pendingAsk — the modal's
 *  arrow-key + Enter handling works without modification. */
function openProviderPicker(
  dispatch: React.Dispatch<Action>,
  readConfig: () => { backend: Backend; baseURL: string; apiKey: string; model: string },
  applyProvider: ApplyProvider,
): void {
  const cur = readConfig();
  const labelOllama = `Ollama${cur.backend === 'ollama' || cur.backend === '' ? ' (current)' : ''}`;
  const labelLM = `LM Studio${cur.backend === 'lmstudio' ? ' (current)' : ''}`;
  const labelOAI = `OpenAI-compatible${cur.backend === 'openai-compat' ? ' (current)' : ''}`;

  const req: AskRequest = {
    question: {
      header: 'provider',
      question: 'Which LLM backend should pentesterflow use?',
      options: [
        { label: labelOllama, description: 'local — /api/tags + /api/chat' },
        { label: labelLM, description: 'local — /v1/models + /v1/chat/completions' },
        {
          label: labelOAI,
          description: 'remote — needs base URL + API key (uses current config values)',
        },
      ],
    },
    resolve: (picked) => {
      dispatch({ type: 'set-ask', req: null });
      const backend: Backend = picked.startsWith('Ollama')
        ? 'ollama'
        : picked.startsWith('LM Studio')
          ? 'lmstudio'
          : 'openai-compat';
      const config = readConfig();
      // For openai-compat we need URL + key already in config.
      if (backend === 'openai-compat' && (!config.baseURL || !config.apiKey)) {
        dispatch({
          type: 'append',
          entry: {
            kind: 'error',
            text:
              'openai-compat needs a base URL + API key. Restart with --base-url + --api-key, ' +
              'or pre-set them in ~/.pentesterflow/config.json, then run /provider again.',
          },
        });
        return;
      }
      const baseURL = backend === 'openai-compat' ? config.baseURL : '';
      const apiKey = backend === 'openai-compat' ? config.apiKey : '';
      void fetchAndPickModel(backend, baseURL, apiKey, dispatch, applyProvider);
    },
    reject: () => dispatch({ type: 'set-ask', req: null }),
  };
  dispatch({ type: 'set-ask', req });
}

/**
 * Pick the closest candidate to `input` from `known` for did-you-mean
 * messages. Strategy: prefer longest common prefix (handles typos at the
 * end like "qwen2.5-coder-32b" → "qwen2.5-coder-32b-instruct"); fall back
 * to substring containment in either direction. Returns undefined when no
 * candidate is meaningfully close.
 */
function suggestClosest(input: string, known: string[]): string | undefined {
  const needle = input.toLowerCase();
  let best: { name: string; score: number } | undefined;
  for (const cand of known) {
    const lower = cand.toLowerCase();
    let score = 0;
    // Longest common prefix.
    const prefLen = Math.min(needle.length, lower.length);
    for (let i = 0; i < prefLen; i += 1) {
      if (needle[i] !== lower[i]) break;
      score += 2;
    }
    if (lower.includes(needle) || needle.includes(lower)) score += 5;
    if (!best || score > best.score) best = { name: cand, score };
  }
  // Require at least 4 chars of shared prefix (or substring hit) to avoid
  // proposing wildly unrelated models on totally bogus input.
  return best && best.score >= 4 ? best.name : undefined;
}

/** Fetch the model list from the chosen backend and open the model picker.
 *  Caps the list to MODEL_PICKER_CAP entries so the modal stays readable;
 *  the user can always fall back to `/model <id>` for an unlisted model. */
const MODEL_PICKER_CAP = 12;

async function fetchAndPickModel(
  backend: Backend,
  baseURL: string,
  apiKey: string,
  dispatch: React.Dispatch<Action>,
  applyProvider: ApplyProvider,
): Promise<void> {
  let models: string[];
  try {
    models = await listModels(backend, baseURL, apiKey);
  } catch (err) {
    dispatch({
      type: 'append',
      entry: {
        kind: 'error',
        text: `${backend} list-models failed: ${(err as Error).message}`,
      },
    });
    return;
  }
  if (models.length === 0) {
    dispatch({
      type: 'append',
      entry: {
        kind: 'error',
        text: `${backend} returned no models — is it running with a model loaded?`,
      },
    });
    return;
  }
  const shown = models.slice(0, MODEL_PICKER_CAP);
  const overflow = models.length - shown.length;
  const req: AskRequest = {
    question: {
      header: 'model',
      question: `Select model for ${backend}${overflow > 0 ? `  (showing ${shown.length} of ${models.length} — use /model <id> for unlisted)` : ''}:`,
      options: shown.map((m) => ({ label: m })),
    },
    resolve: (picked) => {
      dispatch({ type: 'set-ask', req: null });
      void applyProvider({ backend, model: picked, baseURL, apiKey })
        .then(() =>
          dispatch({
            type: 'append',
            entry: { kind: 'system', text: `provider set to ${backend} · model ${picked}` },
          }),
        )
        .catch((err: unknown) =>
          dispatch({
            type: 'append',
            entry: { kind: 'error', text: `provider switch failed: ${(err as Error).message}` },
          }),
        );
    },
    reject: () => dispatch({ type: 'set-ask', req: null }),
  };
  dispatch({ type: 'set-ask', req });
}
