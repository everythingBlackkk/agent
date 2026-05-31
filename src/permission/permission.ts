// Permission prompter. The TUI implements a Prompter that pops a modal
// asking "allow once / allow session / deny" for each tool call that
// requires permission. Tools call `prompter.ask(...)` and synchronously
// wait for a Decision before running.
//
// YOLO wraps a Prompter and short-circuits to `allow-once` for every
// request, bypassing the modal — EXCEPT requests flagged `bypassYolo`
// (sensitive-file reads/writes), which always show the real prompt. The
// shell denylist is a separate static guard inside the tool and always
// fires regardless of prompter.

export type Decision = 'allow-once' | 'allow-session' | 'deny';

export interface Request {
  tool: string;
  summary: string;
  detail: string;
  /** When true, YOLO must NOT auto-approve — defer to the real prompter.
   *  Used for high-consequence operations (reading/writing credential
   *  paths) where blanket YOLO consent is too dangerous. */
  bypassYolo?: boolean;
  /** When true, an "allow session" decision is honored once but NOT cached
   *  — the next equivalent call re-prompts. Used for arbitrary-exec tools
   *  (shell) where one approval must not silently whitelist all future
   *  commands for the session. */
  noSessionCache?: boolean;
}

export interface Prompter {
  ask(req: Request, signal?: AbortSignal): Promise<Decision>;
}

/** Yolo wraps a Prompter and answers "allow-once" without prompting. */
export class YoloPrompter implements Prompter {
  private inner: Prompter;
  private yolo = false;

  constructor(inner: Prompter, initial = false) {
    this.inner = inner;
    this.yolo = initial;
  }

  setYolo(on: boolean): void {
    this.yolo = on;
  }

  isYolo(): boolean {
    return this.yolo;
  }

  async ask(req: Request, signal?: AbortSignal): Promise<Decision> {
    // Sensitive operations (bypassYolo) always go through the real prompter,
    // even in YOLO — blanket consent must not extend to credential paths.
    if (this.yolo && !req.bypassYolo) return 'allow-once';
    return this.inner.ask(req, signal);
  }
}

/** AlwaysAllow is for headless / test contexts. Production must use a real prompter. */
export class AlwaysAllow implements Prompter {
  async ask(_req: Request): Promise<Decision> {
    return 'allow-once';
  }
}

/** AlwaysDeny is for hermetic tests that should never trigger a tool run. */
export class AlwaysDeny implements Prompter {
  async ask(_req: Request): Promise<Decision> {
    return 'deny';
  }
}
