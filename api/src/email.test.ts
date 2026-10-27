import { createServer, type Server } from 'net';
import { describe, expect, it } from 'vitest';
import { isSmtpConfigured, sendMail, smtpConfigFromEnv } from './email';

/** A tiny fake SMTP server (no auth, no TLS) used only to prove the
 *  client speaks SMTP. It never sends a real email and never leaves
 *  the test process. */
function fakeSmtpServer(received: string[]): Promise<{ port: number; server: Server }> {
  return new Promise((resolve) => {
    const server = createServer((socket) => {
      socket.write('220 fake.local ESMTP ready\r\n');
      let inData = false;
      let buffer = '';
      socket.on('data', (chunk: Buffer) => {
        buffer += chunk.toString('utf8');
        let idx = buffer.indexOf('\r\n');
        while (idx >= 0) {
          const line = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          if (inData) {
            if (line === '.') {
              inData = false;
              socket.write('250 OK message accepted\r\n');
            } else {
              received.push(line);
            }
          } else if (line.startsWith('EHLO')) {
            socket.write('250-fake.local\r\n250 HELP\r\n');
          } else if (line.startsWith('MAIL FROM')) {
            socket.write('250 OK\r\n');
          } else if (line.startsWith('RCPT TO')) {
            socket.write('250 OK\r\n');
          } else if (line === 'DATA') {
            socket.write('354 End data with <CR><LF>.<CR><LF>\r\n');
            inData = true;
          } else if (line === 'QUIT') {
            socket.write('221 Bye\r\n');
            socket.end();
          } else {
            socket.write('250 OK\r\n');
          }
          idx = buffer.indexOf('\r\n');
        }
      });
    });
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolve({ port: typeof address === 'object' && address ? address.port : 0, server });
    });
  });
}

describe('Den & Desk SMTP client (test/dev, no real email)', () => {
  it('reports SMTP as unconfigured when SMTP_HOST is missing', () => {
    expect(smtpConfigFromEnv({})).toBeNull();
    expect(isSmtpConfigured({})).toBe(false);
    expect(isSmtpConfigured({ SMTP_FROM: 'x@example.com' })).toBe(false);
  });

  it('throws a clear configuration error instead of silently falling back', async () => {
    await expect(sendMail({ subject: 'Hi', text: 'Hello', to: 'a@example.com' }, {})).rejects.toThrow(/SMTP is not configured/);
    await expect(sendMail({ subject: 'Hi', text: 'Hello', to: 'a@example.com' }, { SMTP_HOST: '127.0.0.1', SMTP_PORT: '2525' })).rejects.toThrow(/SMTP_FROM/);
  });

  it('delivers a message to a local fake SMTP server (no real email sent)', async () => {
    const received: string[] = [];
    const { port, server } = await fakeSmtpServer(received);
    try {
      await sendMail(
        { subject: 'Test code', text: 'Your code is: 123456', to: 'kitty@example.com' },
        { SMTP_FROM: 'den@example.com', SMTP_HOST: '127.0.0.1', SMTP_PORT: String(port) },
      );
    } finally {
      server.close();
    }
    expect(received.join('\n')).toMatch(/Your code is: 123456/);
    expect(received.join('\n')).toMatch(/Subject: Test code/);
  });
});
