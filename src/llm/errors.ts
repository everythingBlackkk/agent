// Backend error classification. The UI cares about three categories:
// "no model loaded" (lmstudio's typical first-launch state), "model not
// found" (ollama pull missing), and "backend unreachable" (daemon down).
// Anything else is just a generic BackendError so the raw upstream message
// still reaches the log file.
//
// The classifier pattern set is the source of truth for these categories;
// keep it in sync with the backend error shapes.

export type ErrorCategory = 'model-not-loaded' | 'model-not-found' | 'backend-down' | 'unknown';

export class BackendError extends Error {
  readonly backend: string;
  readonly category: ErrorCategory;
  readonly statusCode: number;
  readonly detail: string;

  constructor(backend: string, category: ErrorCategory, statusCode: number, detail: string) {
    const msg =
      statusCode !== 0 ? `${backend} error ${statusCode}: ${detail}` : `${backend}: ${detail}`;
    super(msg);
    this.name = 'BackendError';
    this.backend = backend;
    this.category = category;
    this.statusCode = statusCode;
    this.detail = detail;
  }
}

/**
 * Classify a transport or non-2xx response into a BackendError. Pass
 * `transportErr` (from fetch/undici) OR `statusCode` + `body` (from a
 * non-2xx response), not both — pass undefined for the unused half.
 */
export function classifyBackend(
  backend: string,
  transportErr: unknown,
  statusCode: number,
  body: string | undefined,
): BackendError {
  if (transportErr !== undefined && transportErr !== null) {
    const msg = transportErr instanceof Error ? transportErr.message : String(transportErr);
    const lower = msg.toLowerCase();
    if (
      lower.includes('econnrefused') ||
      lower.includes('connection refused') ||
      lower.includes('enotfound') ||
      lower.includes('no such host') ||
      lower.includes('etimedout') ||
      lower.includes('i/o timeout') ||
      lower.includes('network is unreachable') ||
      lower.includes('socket hang up') ||
      lower.includes('fetch failed')
    ) {
      return new BackendError(backend, 'backend-down', 0, msg);
    }
    return new BackendError(backend, 'unknown', 0, msg);
  }

  // Extract a human message from whichever error envelope the backend used.
  let msg = (body ?? '').trim();
  if (body) {
    try {
      const parsed = JSON.parse(body) as {
        error?: string | { message?: string };
      };
      if (typeof parsed.error === 'string' && parsed.error) {
        msg = parsed.error;
      } else if (parsed.error && typeof parsed.error === 'object' && parsed.error.message) {
        msg = parsed.error.message;
      }
    } catch {
      // Not JSON — keep raw body as msg.
    }
  }

  const lower = msg.toLowerCase();
  if (
    lower.includes('no models loaded') ||
    lower.includes('no model loaded') ||
    lower.includes('model not loaded') ||
    lower.includes('please load a model')
  ) {
    return new BackendError(backend, 'model-not-loaded', statusCode, msg);
  }
  if (
    lower.includes('try pulling it first') ||
    lower.includes('model not found') ||
    lower.includes('does not exist') ||
    (lower.includes('model') && lower.includes('not found'))
  ) {
    return new BackendError(backend, 'model-not-found', statusCode, msg);
  }
  return new BackendError(backend, 'unknown', statusCode, msg);
}
