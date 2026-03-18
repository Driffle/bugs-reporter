import { Controller, Post, Req, Res, Headers, RawBodyRequest } from '@nestjs/common';
import { Response } from 'express';
import { SlackService } from './slack.service';
import { LoggerService } from '../logger/logger.service';

const BUG_EMOJI = ':bug:';

@Controller('slack')
export class SlackController {
  constructor(
    private readonly slackService: SlackService,
    private readonly logger: LoggerService,
  ) {}

  @Post('events')
  async handleEvents(
    @Req() req: RawBodyRequest<Request & { body: any }>,
    @Res() res: Response,
    @Headers('x-slack-signature') signature: string,
    @Headers('x-slack-request-timestamp') timestamp: string,
  ) {
    const rawBody = req.rawBody as Buffer | undefined;
    if (!rawBody) {
      this.logger.warn('Slack events request missing raw body', 'SlackController');
      return res.status(400).send('Bad Request');
    }

    const body = req.body as {
      type?: string;
      challenge?: string;
      event?: Record<string, unknown>;
      event_id?: string;
    };

    if (body.type === 'url_verification') {
      this.logger.debug('Slack URL verification', 'SlackController');
      return res.status(200).json({ challenge: body.challenge });
    }

    if (!this.slackService.verifySignature(rawBody, signature ?? '', timestamp ?? '')) {
      this.logger.warn('Slack signature verification failed', 'SlackController');
      return res.status(401).send('Unauthorized');
    }

    if (body.type !== 'event_callback' || !body.event) {
      return res.status(200).send();
    }

    const event = body.event as {
      type: string;
      channel?: string;
      user?: string;
      text?: string;
      ts?: string;
      thread_ts?: string;
      bot_id?: string;
      files?: { name: string; url_private: string; mimetype: string; permalink: string }[];
      attachments?: { title?: string; title_link?: string; text?: string; image_url?: string }[];
      message?: { text?: string; user?: string; bot_id?: string };
    };

    this.logger.log(
      { eventType: event.type, channel: event.channel, eventId: body.event_id },
      'Incoming Slack event',
    );

    if (event.type !== 'message') {
      return res.status(200).send();
    }

    const channelId = event.channel ?? '';
    if (!this.slackService.isFromConfiguredChannel(channelId)) {
      this.logger.debug({ channelId }, 'Ignoring message from non-configured channel');
      return res.status(200).send();
    }

    if (this.slackService.isBotMessage(event as any)) {
      this.logger.debug('Ignoring bot message');
      return res.status(200).send();
    }

    if (!this.slackService.shouldProcessThread(event as any)) {
      this.logger.debug('Ignoring message in thread (threads disabled)');
      return res.status(200).send();
    }

    const text = this.slackService.getMessageText(event as any);
    const hasBugEmoji = text.includes(BUG_EMOJI) || (event as any).message?.text?.includes(BUG_EMOJI);
    if (!this.slackService.hasTrigger(text, hasBugEmoji)) {
      this.logger.debug('No trigger keyword or emoji');
      return res.status(200).send();
    }

    const messageId = body.event_id ?? `${channelId}-${event.ts ?? ''}`;
    const alreadyProcessed = await this.slackService.isAlreadyProcessed(messageId);
    if (alreadyProcessed) {
      this.logger.log({ messageId }, 'Duplicate event (already processed), skipping');
      return res.status(200).send();
    }

    const permalink = await this.slackService.getPermalink(channelId, event.ts ?? '');

    await this.slackService.enqueueTicketJob({
      eventId: messageId,
      channelId,
      userId: event.user ?? event.message?.user,
      text,
      ts: event.ts ?? '',
      threadTs: event.thread_ts,
      permalink,
      hasBugEmoji,
      files: event.files,
      attachments: event.attachments,
    });

    return res.status(200).send();
  }
}
