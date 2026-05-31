// Friendly tool labels and arg previews, shared between the transcript
// view (src/ui/state.ts) and the permission prompt (src/ui/PermissionModal
// + MCP summarize). Display-only: the agent always works with raw tool
// names and args.

const TOOL_DISPLAY_NAMES: Record<string, string> = {
  mcp_browser_browser_navigate: 'Browser',
};

export function displayToolName(name: string): string {
  return TOOL_DISPLAY_NAMES[name] ?? name;
}

// For tools with a single, obvious argument worth showing bare instead of
// as JSON (e.g. the browser tool's `url`), returns that value as a string.
// Returns null when the tool has no special handling or the field is
// missing/empty — callers fall back to the raw JSON preview.
export function primaryToolArg(name: string, args: Record<string, unknown>): string | null {
  if (name === 'mcp_browser_browser_navigate') {
    const url = args.url;
    if (typeof url === 'string' && url) return url;
  }
  if (name === 'shell' || name === 'bash' || name === 'BashTool') {
    const cmd = args.command;
    if (typeof cmd === 'string' && cmd) return cmd;
  }
  if (name === 'confirm_finding') {
    const title = typeof args.title === 'string' ? args.title : '';
    const severity = typeof args.severity === 'string' ? args.severity : '';
    if (title) return severity ? `(${severity}) ${title}` : title;
  }
  return null;
}

// For tools whose result is a small JSON object, render a compact one-line
// summary in the transcript instead of a pretty-printed JSON dump. The raw
// JSON result still goes to the model unchanged — this is display-only.
// Returns null to fall back to the default tool-result view.
export function formatToolResult(name: string, result: string): string | null {
  if (name === 'browser_capture_status') {
    try {
      const s = JSON.parse(result) as Record<string, unknown>;
      const n = (k: string): number | string => (typeof s[k] === 'number' ? (s[k] as number) : 0);
      const last = typeof s.lastActivityAt === 'string' ? s.lastActivityAt : 'never';
      return `requests: ${n('requests')} · endpoints: ${n('endpoints')} · snapshots: ${n('snapshots')} · last activity: ${last}`;
    } catch {
      return null; // malformed/partial JSON — use the default view
    }
  }
  return null;
}
