/** Only same-site relative paths are allowed as a post-login destination (no open redirects). */
export function safeNext(next: string | null | undefined): string {
  if (
    typeof next !== 'string' ||
    !next.startsWith('/') ||
    next.startsWith('//') ||
    next.startsWith('/\\')
  ) {
    return '/';
  }
  if (next.startsWith('/login') || next.startsWith('/register')) return '/';
  return next;
}
