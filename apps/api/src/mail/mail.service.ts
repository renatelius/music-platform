import { Inject, Injectable, Logger, type OnApplicationShutdown } from '@nestjs/common';
import nodemailer from 'nodemailer';

import type { AppConfig } from '../config/env.js';
import { APP_CONFIG } from '../infra/tokens.js';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

@Injectable()
export class MailService implements OnApplicationShutdown {
  private readonly logger = new Logger('Mail');
  private readonly transport: ReturnType<typeof nodemailer.createTransport>;
  private readonly from: string;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    const { host, port, secure, user, password, from } = config.mail;
    this.from = from;
    this.transport = nodemailer.createTransport({
      host,
      port,
      secure,
      ...(user !== undefined ? { auth: { user, pass: password ?? '' } } : {}),
    });
  }

  async send(message: MailMessage): Promise<void> {
    await this.transport.sendMail({ from: this.from, ...message });
    this.logger.log(`Sent "${message.subject}"`);
  }

  onApplicationShutdown(): void {
    this.transport.close();
  }
}
