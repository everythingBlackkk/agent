// Multi-line text input renderer. The value + cursor live in App so
// menus (slash, @file) and the agent loop can intercept keys without
// fighting an inner stateful component. The Input itself is a pure
// renderer: it draws the prompt on the first line, value lines under
// it (continuation lines indented to align), and a cursor block on
// the active line + column.

import { Box, Text } from 'ink';
import { positionOf } from './useTextField.js';

export interface InputProps {
  prompt?: string;
  placeholder?: string;
  value: string;
  /** Offset into value where the cursor sits (0..value.length). */
  cursor: number;
  disabled?: boolean;
}

const CONTINUATION_INDENT = '  ';

export function Input(props: InputProps): JSX.Element {
  const isEmpty = props.value.length === 0;
  const showPlaceholder = isEmpty && props.placeholder;
  const promptText = props.prompt ?? '❯ ';

  if (showPlaceholder) {
    return (
      <Box>
        <Text color="magenta">{promptText}</Text>
        <Text color="gray">{props.placeholder}</Text>
        {!props.disabled ? <Text color="magenta">▌</Text> : null}
      </Box>
    );
  }

  // Split into visible lines so the cursor block can land on the right
  // (line, col). The cursor offset comes from useTextField which tracks
  // an absolute position into the value string.
  const lines = props.value.split('\n');
  const { line: cursorLine, col: cursorCol } = positionOf(props.value, props.cursor);

  return (
    <Box flexDirection="column">
      {lines.map((lineText, lineIdx) => {
        const prefix = lineIdx === 0 ? promptText : CONTINUATION_INDENT;
        const isActive = lineIdx === cursorLine;
        // Position-derived keys are correct here — input lines don't get
        // reordered, only appended/inserted; React's reconciler does the
        // right thing.
        // biome-ignore lint/suspicious/noArrayIndexKey: input rows are ordered, never reordered
        const rowKey = `row-${lineIdx}`;
        if (props.disabled || !isActive) {
          return (
            <Box key={rowKey}>
              <Text color="magenta">{prefix}</Text>
              <Text color="white">{lineText}</Text>
            </Box>
          );
        }
        // Render the active line with a cursor block at cursorCol. We
        // split into head | char-under-cursor | tail so the cursor
        // glyph visibly inverts the character it sits on (or appends a
        // block when the cursor is at end-of-line).
        const head = lineText.slice(0, cursorCol);
        const underCursor = lineText.slice(cursorCol, cursorCol + 1);
        const tail = lineText.slice(cursorCol + 1);
        return (
          <Box key={rowKey}>
            <Text color="magenta">{prefix}</Text>
            <Text color="white">{head}</Text>
            {underCursor ? (
              <Text color="black" backgroundColor="magenta">
                {underCursor}
              </Text>
            ) : (
              <Text color="magenta">▌</Text>
            )}
            <Text color="white">{tail}</Text>
          </Box>
        );
      })}
    </Box>
  );
}
