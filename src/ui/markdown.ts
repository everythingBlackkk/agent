// Inline markdown → ANSI renderer for the transcript. Deliberately
// regex-based rather than a full markdown parser: assistant output is
// usually a paragraph or two with the occasional **bold**, `code`, or
// `# Heading`, and a real parser is overkill for that. Ink renders ANSI
// escape codes inside <Text> verbatim, so the returned string drops
// straight into the transcript without any further wrapping.
//
// Supported syntax:
//   **bold**          →  bold
//   __bold__          →  bold
//   *italic*          →  italic   (single-word; *foo bar* also OK)
//   _italic_          →  italic
//   `inline code`     →  cyan
//   # Heading         →  bold magenta (line-level)
//   ## Heading        →  bold cyan
//   ###+ Heading      →  bold (no color)
//   - list item       →  • prefix
//   * list item       →  • prefix
//   ``` … ```         →  code block, language-aware syntax highlighting
//                       when the fence specifies a language (e.g. ```bash);
//                       dim plain text otherwise. No inline markdown is
//                       re-applied inside the fences.

import { Chalk } from 'chalk';
import { highlight, supportsLanguage } from 'cli-highlight';

// Force color level 3 (truecolor) inside this module. Default chalk
// suppresses ANSI when stdout isn't a TTY (test runs, piped output),
// but the transcript is always rendered by Ink — Ink requires a TTY
// itself — so always emitting ANSI is correct and lets tests assert
// directly on the escape sequences without test-env overrides.
const chalk = new Chalk({ level: 3 });

/**
 * Render a markdown string to an ANSI-styled string for direct insertion
 * into an Ink <Text> child. Safe to call on plain text — returns the
 * input unchanged when no markdown syntax is present.
 */
export function renderMarkdown(s: string): string {
  if (!s) return s;
  const lines = s.split('\n');
  const out: string[] = [];
  let inFence = false;
  let fenceLang = '';
  let fenceBuf: string[] = [];

  for (const raw of lines) {
    // CommonMark allows 0-3 spaces of indent before a fence marker. We
    // honor that — many models emit ` ```python` (one space) when the
    // block sits after a colon or inside a list, and a strict
    // startsWith('```') silently dropped those.
    const fenceMatch = raw.match(/^[ \t]{0,3}```\s*(\S*)/);
    if (fenceMatch) {
      if (inFence) {
        // Closing fence — flush buffered content. renderFencedBlock
        // now returns the WHOLE block (header rule + gutter body +
        // footer rule), so we don't push our own ``` markers.
        out.push(renderFencedBlock(fenceBuf, fenceLang));
        inFence = false;
        fenceLang = '';
        fenceBuf = [];
      } else {
        // Opening fence — record language, don't emit anything yet.
        // The header rule is drawn by renderFencedBlock once we know
        // the body width.
        inFence = true;
        fenceLang = fenceMatch[1] ?? '';
      }
      continue;
    }
    if (inFence) {
      fenceBuf.push(raw);
      continue;
    }
    out.push(renderLine(raw));
  }

  // Unterminated fence: render whatever we buffered so the user still
  // gets something readable instead of silently losing the tail.
  if (inFence && fenceBuf.length > 0) {
    out.push(renderFencedBlock(fenceBuf, fenceLang));
  }

  return out.join('\n');
}

/**
 * Render a buffered code block. Minimal chrome: syntax-highlighted
 * body + `NN│ ` line-number gutter. No header rule, no language chip,
 * no footer rule — those felt like section dividers, not code
 * containers. Fenced code renders as bare
 * highlighted text (no chrome at all); we keep the gutter on top of
 * that because line numbers are the actually-useful affordance for
 * pentest workflows (referencing payload line 3 by number, etc.).
 *
 * Result for hello world:
 *
 *   1│ print("Hello, World!")
 *
 * Result for a 5-line bash block:
 *
 *   1│ #!/usr/bin/env bash
 *   2│ set -euo pipefail
 *   3│ NAME="World"
 *   4│ echo "Hello, ${NAME}!"
 *   5│ curl -s -o /dev/null -w "%{http_code}\n" "$URL"
 *
 * The `│` glyph on every row IS the visual separation from prose —
 * no extra horizontal rule needed.
 */
function renderFencedBlock(lines: string[], lang: string): string {
  if (lines.length === 0) return '';

  let highlighted: string[];
  if (lang && supportsLanguage(lang)) {
    try {
      // cli-highlight returns the whole body with ANSI in place; split
      // back into rows so we can add the gutter line-by-line.
      highlighted = highlight(lines.join('\n'), {
        language: lang,
        ignoreIllegals: true,
      }).split('\n');
    } catch {
      highlighted = lines.map((l) => chalk.dim(l));
    }
  } else {
    highlighted = lines.map((l) => chalk.dim(l));
  }

  const gutterWidth = String(highlighted.length).length;
  return highlighted
    .map((row, i) => {
      const num = String(i + 1).padStart(gutterWidth, ' ');
      return `${chalk.dim(`${num}│`)} ${row}`;
    })
    .join('\n');
}

function renderLine(line: string): string {
  // Heading: # / ## / ### Heading
  const heading = line.match(/^(\s*)(#{1,6})\s+(.*)$/);
  if (heading) {
    const indent = heading[1] ?? '';
    const level = (heading[2] ?? '').length;
    const text = renderInline(heading[3] ?? '');
    if (level === 1) return `${indent}${chalk.bold(chalk.magenta(text))}`;
    if (level === 2) return `${indent}${chalk.bold(chalk.cyan(text))}`;
    return `${indent}${chalk.bold(text)}`;
  }

  // Bullet: `- item` or `* item` (the bullet marker is rewritten to a
  // bullet glyph). Numbered lists pass through unchanged.
  const bullet = line.match(/^(\s*)([-*])\s+(.*)$/);
  if (bullet) {
    const indent = bullet[1] ?? '';
    return `${indent}${chalk.gray('•')} ${renderInline(bullet[3] ?? '')}`;
  }

  // Blockquote: `> text`
  const quote = line.match(/^(\s*)>\s?(.*)$/);
  if (quote) {
    const indent = quote[1] ?? '';
    return `${indent}${chalk.gray('│ ')}${chalk.dim(renderInline(quote[2] ?? ''))}`;
  }

  return renderInline(line);
}

/** Inline span styling. Order matters — code is processed first so
 *  backtick contents don't get re-interpreted as bold/italic. */
function renderInline(s: string): string {
  if (!s) return s;
  return s
    .replace(/`([^`]+)`/g, (_m, body: string) => chalk.cyan(body))
    .replace(/\*\*([^*\n]+)\*\*/g, (_m, body: string) => chalk.bold(body))
    .replace(/__([^_\n]+)__/g, (_m, body: string) => chalk.bold(body))
    .replace(/(?<![\w*])\*([^*\n]+)\*(?!\w)/g, (_m, body: string) => chalk.italic(body))
    .replace(/(?<![\w_])_([^_\n]+)_(?!\w)/g, (_m, body: string) => chalk.italic(body));
}
