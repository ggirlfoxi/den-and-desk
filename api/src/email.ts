/**
 * SMTP email delivery for Den & Desk — test/dev build only.
 *
 * No SMTP provider is chosen, paid for, or bundled here, and no
 * dependency was added: this is a small, dependency-free SMTP client
 * (Node net/tls only) driven entirely by environment variables:
 *   SMTP_HOST, SMTP_PORT (default 587), SMTP_USER, SMTP_PASS, SMTP_FROM
 *   SMTP_SECURE=true forces an implicit-TLS connection (port 465 style).
 *
 * FREE-ONLY + PAYMENT GATE: if a host, provider, or SMTP route ever
 * asks for payment, a card, a paid plan, or a trial that converts to
 * paid, STOP — do not proceed, do not work around it, and report it
 * as blocked. Payment is a separate future user decision, never
 * automatic, never assumed, even after a polished product exists.
 *
 * TEST/DEV ONLY: this build is not a production launch, not for real
 * users, and not an open beta. Do not send invites or email to real
 * people from this code path in a shared deployment until the user
 * explicitly approves that separate step.
 *
 * Failure behaviour, by design:
 * - If SMTP is not configured, sendMail throws a clear configuration
 *   error. It never silently falls back to printing a login code, and
 *   it never logs a code.
 * - The only code-return path is the local dev path in index.ts, which
 *   is off by default (ALLOW_DEV_CODE must be explicitly 'true') and
 *   is refused in production (NODE_ENV=production).
 */
import { connect as netConnect, type Socket } from 'net';
import { connect as tlsConnect } from 'tls';

export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string | null;
  pass: string | null;
  from: string;
}

export function smtpConfigFromEnv(env: NodeJS.ProcessEnv = process.env): SmtpConfig | null {
  const host = (env.SMTP_HOST ?? '').trim();
  if (!host) return null;
  const portRaw = Number.parseInt(env.SMTP_PORT ?? '587', 10);
  const port = Number.isFinite(portRaw) && portRaw > 0 ? portRaw : 587;
  const secure = env.SMTP_SECURE === 'true' || port === 465;
  return {
    from: (env.SMTP_FROM ?? '').trim(),
    host,
    pass: env.SMTP_PASS ?? null,
    port,
    secure,
    user: env.SMTP_USER ?? null,
  };
}

export function isSmtpConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  const config = smtpConfigFromEnv(env);
  return !!config && config.from.length > 0;
}

class SmtpConnection {
  private socket: Socket;
  private buffer = '';
  private waiters: Array<{ resolve: (line: string[]) => void; reject: (err: Error) => void }> = [];
  private completed: string[][] = [];
  private pendingReply: string[] | null = null;

  constructor(socket: Socket) {
    this.socket = socket;
    socket.setEncoding('utf8');
    socket.on('data', (chunk: string) => this.onData(chunk));
    socket.on('error', (err) => {
      const waiters = this.waiters;
      this.waiters = [];
      for (const w of waiters) w.reject(err);
    });
  }

  private onData(chunk: string): void {
    this.buffer += chunk;
    let idx = this.buffer.indexOf('\r\n');
    while (idx >= 0) {
      const line = this.buffer.slice(0, idx);
      this.buffer = this.buffer.slice(idx + 2);
      this.onLine(line);
      idx = this.buffer.indexOf('\r\n');
    }
  }

  private onLine(line: string): void {
    // An SMTP reply is complete when a line's 4th character is a space
    // (a '-' there means "more lines follow").
    if (!this.pendingReply) this.pendingReply = [];
    this.pendingReply.push(line);
    if (line.length >= 4 && line[3] === '-') return;
    const reply = this.pendingReply;
    this.pendingReply = null;
    const waiter = this.waiters.shift();
    if (waiter) waiter.resolve(reply);
    else this.completed.push(reply);
  }

  async read(): Promise<string[]> {
    const done = this.completed.shift();
    if (done) return done;
    return new Promise((resolve, reject) => {
      this.waiters.push({ reject, resolve });
    });
  }

  async command(text: string): Promise<string[]> {
    this.socket.write(`${text}\r\n`);
    return this.read();
  }

  async upgradeToTls(host: string): Promise<void> {
    const old = this.socket;
    const upgraded = tlsConnect({ host, rejectUnauthorized: true, socket: old });
    await new Promise<void>((resolve, reject) => {
      upgraded.once('secureConnect', () => resolve());
      upgraded.once('error', (err) => reject(err));
    });
    this.socket = upgraded as unknown as Socket;
    this.socket.setEncoding('utf8');
    this.socket.on('data', (chunk: string) => this.onData(chunk));
    this.socket.on('error', (err) => {
      const waiters = this.waiters;
      this.waiters = [];
      for (const w of waiters) w.reject(err);
    });
  }

  end(): void {
    try {
      this.socket.end();
    } catch {
      // Closing a finished socket is not an error worth surfacing.
    }
  }
}

function codeOf(lines: string[]): number {
  return Number.parseInt((lines[0] ?? '000').slice(0, 3), 10);
}

export async function sendMail(
  message: { from?: string; subject: string; text: string; to: string },
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const config = smtpConfigFromEnv(env);
  if (!config) {
    throw new Error(
      'SMTP is not configured. Set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS and SMTP_FROM before email can be sent. No code was sent and no code was logged.',
    );
  }
  const from = (message.from ?? config.from).trim();
  if (!from) {
    throw new Error('SMTP_FROM is not set. Set SMTP_FROM before email can be sent.');
  }
  const rawSocket = config.secure
    ? tlsConnect({ host: config.host, port: config.port, rejectUnauthorized: true })
    : netConnect(config.port, config.host);
  const conn = new SmtpConnection(rawSocket);
  const timeout = setTimeout(() => {
    try {
      rawSocket.destroy(new Error('SMTP connection timed out.'));
    } catch {
      // Destroying a timed-out socket is best-effort.
    }
  }, 15000);
  try {
    const greeting = await conn.read();
    if (codeOf(greeting) !== 220) throw new Error(`SMTP greeting failed: ${greeting.join(' ')}`);
    let ehlo = await conn.command(`EHLO ${config.host}`);
    if (codeOf(ehlo) !== 250) throw new Error(`SMTP EHLO failed: ${ehlo.join(' ')}`);
    const offersStarttls = !config.secure && ehlo.some((line) => /STARTTLS/i.test(line));
    if (offersStarttls) {
      const starttls = await conn.command('STARTTLS');
      if (codeOf(starttls) !== 220) throw new Error(`SMTP STARTTLS failed: ${starttls.join(' ')}`);
      await conn.upgradeToTls(config.host);
      ehlo = await conn.command(`EHLO ${config.host}`);
      if (codeOf(ehlo) !== 250) throw new Error(`SMTP EHLO after STARTTLS failed: ${ehlo.join(' ')}`);
    }
    if (config.user && config.pass) {
      if (!config.secure && !offersStarttls) {
        throw new Error('SMTP authentication requires a TLS connection (STARTTLS or implicit TLS). Refusing to send credentials in clear text.');
      }
      const auth = await conn.command('AUTH LOGIN');
      if (codeOf(auth) !== 334) throw new Error(`SMTP AUTH failed: ${auth.join(' ')}`);
      const userRes = await conn.command(Buffer.from(config.user).toString('base64'));
      if (codeOf(userRes) !== 334) throw new Error(`SMTP AUTH failed: ${userRes.join(' ')}`);
      const passRes = await conn.command(Buffer.from(config.pass).toString('base64'));
      if (codeOf(passRes) !== 235) throw new Error(`SMTP AUTH failed: ${passRes.join(' ')}`);
    }
    const mailFrom = await conn.command(`MAIL FROM:<${from}>`);
    if (codeOf(mailFrom) !== 250) throw new Error(`SMTP MAIL FROM failed: ${mailFrom.join(' ')}`);
    const rcpt = await conn.command(`RCPT TO:<${message.to}>`);
    if (codeOf(rcpt) !== 250 && codeOf(rcpt) !== 251) throw new Error(`SMTP RCPT TO failed: ${rcpt.join(' ')}`);
    const data = await conn.command('DATA');
    if (codeOf(data) !== 354) throw new Error(`SMTP DATA failed: ${data.join(' ')}`);
    const body = message.text
      .split('\n')
      .map((line) => (line.startsWith('.') ? `.${line}` : line))
      .join('\r\n');
    const payload = `From: ${from}\r\nTo: ${message.to}\r\nSubject: ${message.subject}\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${body}\r\n.\r\n`;
    rawSocket.write(payload);
    const sent = await conn.read();
    if (codeOf(sent) !== 250) throw new Error(`SMTP message send failed: ${sent.join(' ')}`);
    await conn.command('QUIT');
  } finally {
    clearTimeout(timeout);
    conn.end();
  }
}

export async function sendLoginCode(email: string, code: string, env: NodeJS.ProcessEnv = process.env): Promise<void> {
  await sendMail(
    {
      subject: 'Your Den & Desk login code (test/dev)',
      text: [
        `Your Den & Desk login code is: ${code}`,
        'It expires in 10 minutes. Never share it with anyone.',
        'This is a test/dev build — not a production launch, not for real users.',
      ].join('\n'),
      to: email,
    },
    env,
  );
}
