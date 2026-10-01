/** One line per event, prefixed so eval output is greppable in a shared log. */
export function log(message: string, data?: Record<string, unknown>) {
  console.log(`[phoenix-eval] ${message}`, data ? JSON.stringify(data) : '');
}
