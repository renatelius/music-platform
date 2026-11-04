const BASE = `http://127.0.0.1:${process.env.MAILPIT_UI_PORT ?? '8025'}`;

interface MailSummary {
  ID: string;
  Subject: string;
}

/** Waits for the newest email to `to` whose subject contains `subject`, returns its text. */
export async function waitForEmail(to: string, subject: string, timeoutMs = 8000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  const query = encodeURIComponent(`to:"${to}"`);
  while (Date.now() < deadline) {
    const res = await fetch(`${BASE}/api/v1/search?query=${query}&limit=20`);
    if (res.ok) {
      const body = (await res.json()) as { messages?: MailSummary[] };
      const found = (body.messages ?? []).find((m) => m.Subject.includes(subject));
      if (found !== undefined) {
        const message = (await (await fetch(`${BASE}/api/v1/message/${found.ID}`)).json()) as {
          Text: string;
        };
        return message.Text;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`No email "${subject}" to ${to} within ${String(timeoutMs)} ms`);
}

export async function countEmails(to: string): Promise<number> {
  const res = await fetch(`${BASE}/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}`);
  const body = (await res.json()) as { messages?: unknown[] };
  return body.messages?.length ?? 0;
}

export function tokenFromEmail(text: string): string {
  const match = /[?&]token=([A-Za-z0-9_-]{20,})/.exec(text);
  if (!match?.[1]) throw new Error(`No token link in email:\n${text}`);
  return match[1];
}
