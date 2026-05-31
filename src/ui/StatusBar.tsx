// Status bar: "ready" / "disconnected" word + hints. Spinner is shown
// when busy.

import { Box, Text } from 'ink';
import Spinner from 'ink-spinner';
import type { ToolSupportPill } from './Banner.js';

export interface StatusProps {
  busy: boolean;
  apiReady: boolean;
  activeSkill: string | null;
  yolo: boolean;
  ctxTokens: number;
  /** Live model + tool-support, surfaced here since the banner (printed
   *  once into scrollback) can't reflect post-launch changes. */
  model?: string;
  toolSupport?: ToolSupportPill;
  /** True when a collapsible tool-result hasn't been expanded yet (Ctrl-O reprints it). */
  expandHint: boolean;
}

function toolPill(t?: ToolSupportPill): { text: string; color: string } | null {
  switch (t) {
    case 'yes':
      return { text: 'tools ✓', color: 'green' };
    case 'no':
      return { text: 'NO TOOLS', color: 'red' };
    case 'probing':
      return { text: 'probing…', color: 'yellow' };
    default:
      return null;
  }
}

export function StatusBar(props: StatusProps): React.ReactElement {
  if (props.busy) {
    return (
      <Box>
        <Text color="yellow">
          <Spinner type="dots" />
        </Text>
        <Text color="gray"> thinking · Esc to cancel</Text>
        {props.activeSkill ? <Text color="gray"> · skill: {props.activeSkill}</Text> : null}
      </Box>
    );
  }

  const ctxHint =
    props.ctxTokens >= 1000
      ? `  ·  ctx: ~${(props.ctxTokens / 1000).toFixed(1)}k`
      : props.ctxTokens > 0
        ? `  ·  ctx: ~${props.ctxTokens}`
        : '';
  const pill = toolPill(props.toolSupport);

  return (
    <Box>
      {props.apiReady ? (
        <Text color="green" bold>
          ready
        </Text>
      ) : (
        <Text color="red" bold>
          disconnected
        </Text>
      )}
      <Text color="gray"> · Enter send · / commands</Text>
      {props.model ? <Text color="gray"> · {props.model}</Text> : null}
      {pill ? <Text color={pill.color}> [{pill.text}]</Text> : null}
      {props.expandHint ? <Text color="cyan"> · Ctrl-O expand output</Text> : null}
      {props.activeSkill ? <Text color="gray"> · skill: {props.activeSkill}</Text> : null}
      {ctxHint ? <Text color="gray">{ctxHint}</Text> : null}
      {props.yolo ? (
        <Text color="red" bold>
          {'  ·  YOLO'}
        </Text>
      ) : null}
    </Box>
  );
}
