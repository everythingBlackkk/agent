// Centered permission modal. y = allow once, a = allow this session,
// n = deny.

import { Box, Text, useInput } from 'ink';
import { displayToolName } from '../tools/toolDisplay.js';
import type { PermissionRequest } from './permBridge.js';

export function PermissionModal({
  req,
}: {
  req: PermissionRequest;
}): React.ReactElement {
  useInput((input, key) => {
    if (key.escape) {
      req.resolve('deny');
      return;
    }
    const ch = input?.toLowerCase() ?? '';
    if (ch === 'y') req.resolve('allow-once');
    else if (ch === 'a') req.resolve('allow-session');
    else if (ch === 'n') req.resolve('deny');
  });

  return (
    <Box
      borderStyle="round"
      borderColor="magenta"
      flexDirection="column"
      paddingX={2}
      paddingY={1}
      marginTop={1}
    >
      <Text color="magenta" bold>
        Permission requested: {displayToolName(req.tool)}
      </Text>
      <Box marginTop={1}>
        <Text color="white">{req.summary}</Text>
      </Box>
      {req.detail && req.detail !== req.summary ? (
        <Box marginTop={1}>
          <Text color="gray">{truncate(req.detail, 1200)}</Text>
        </Box>
      ) : null}
      <Box marginTop={1}>
        <Text color="gray">
          <Text color="green" bold>
            y
          </Text>{' '}
          allow once ·{' '}
          <Text color="green" bold>
            a
          </Text>{' '}
          allow session ·{' '}
          <Text color="red" bold>
            n
          </Text>{' '}
          deny · Esc deny
        </Text>
      </Box>
    </Box>
  );
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max)}\n[... truncated ...]`;
}
