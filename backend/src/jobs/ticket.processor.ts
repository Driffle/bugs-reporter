import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { SlackService } from '../slack/slack.service';
import { PlaneService } from '../plane/plane.service';
import { DeduplicationService } from '../deduplication/deduplication.service';
import { AiService } from '../ai/ai.service';
import { LoggerService } from '../logger/logger.service';

export interface TicketJobPayload {
  eventId: string;
  channelId: string;
  userId: string | undefined;
  text: string;
  ts: string;
  threadTs: string | undefined;
  permalink: string;
  hasBugEmoji: boolean;
  files?: { name: string; url_private: string; mimetype: string; permalink: string }[];
  attachments?: { title?: string; title_link?: string; text?: string; image_url?: string }[];
}

@Processor('ticket')
export class TicketProcessor extends WorkerHost {
  constructor(
    private readonly prisma: PrismaService,
    private readonly slack: SlackService,
    private readonly plane: PlaneService,
    private readonly dedup: DeduplicationService,
    private readonly ai: AiService,
    private readonly logger: LoggerService,
  ) {
    super();
  }

  async process(job: Job<TicketJobPayload>): Promise<void> {
    const { eventId, channelId, userId, text, ts, threadTs, permalink, files, attachments } = job.data;
    const threadTsOrTs = threadTs ?? ts;

    const existing = await this.prisma.processedMessage.findUnique({ where: { messageId: eventId } });
    if (existing) {
      this.logger.log({ eventId }, 'Ticket job skipped: already processed (idempotent)');
      return;
    }

    const normalized = this.dedup.normalize(text);
    const contentHash = this.dedup.hash(normalized);
    const duplicate = await this.dedup.findDuplicate(contentHash);

    if (duplicate) {
      const commentHtml = `Duplicate report from Slack: ${permalink}`;
      try {
        await this.plane.addComment(duplicate.planeId, commentHtml);
      } catch (err) {
        this.logger.warn({ err, planeId: duplicate.planeId }, 'Failed to add duplicate comment');
      }
      const displayId = duplicate.planeSequenceId ?? duplicate.planeId;
      await this.slack.postReply(channelId, threadTsOrTs, `Duplicate of ${displayId}`);
      await this.slack.addReaction(channelId, ts, 'bug');
      await this.slack.markProcessed(eventId, channelId, ts);
      this.logger.log({ eventId, duplicateOf: duplicate.planeId }, 'Dedup: commented on existing ticket');
      return;
    }

    const summary = await this.ai.summarizeForBug(text);
    const mediaHtml = buildMediaHtml(files, attachments);
    const descriptionHtml = [
      `<p>${escapeHtml(text)}</p>`,
      `<p><a href="${escapeHtml(permalink)}">Slack message</a></p>`,
      summary.stepsToReproduce ? `<p><strong>Steps to reproduce:</strong> ${escapeHtml(summary.stepsToReproduce)}</p>` : '',
      summary.expectedVsActual ? `<p><strong>Expected vs Actual:</strong> ${escapeHtml(summary.expectedVsActual)}</p>` : '',
      mediaHtml,
    ]
      .filter(Boolean)
      .join('\n');

    const priorityMap = {
      low: 'low' as const,
      medium: 'medium' as const,
      high: 'high' as const,
      critical: 'urgent' as const,
    };
    const priority = summary.severity ? priorityMap[summary.severity] ?? 'medium' : 'medium';

    let result: { id: string; sequence_id?: number };
    try {
      result = await this.plane.createIssue({
        name: summary.title,
        descriptionHtml,
        priority,
      });
    } catch (err) {
      this.logger.error(`Plane create issue failed: ${(err as Error).message}`, (err as Error).stack, 'TicketProcessor');
      throw err;
    }

    await this.prisma.ticket.create({
      data: {
        planeId: result.id,
        planeSequenceId: result.sequence_id != null ? String(result.sequence_id) : null,
        slackMessageId: eventId,
        contentHash,
        channelId,
        slackUserId: userId ?? null,
      },
    });
    await this.slack.markProcessed(eventId, channelId, ts);

    const issueUrl = this.plane.getIssueUrl(result.id, result.sequence_id);
    const replyText = `Bug ticket created: ${result.sequence_id ?? result.id} — ${issueUrl}`;
    await this.slack.postReply(channelId, threadTsOrTs, replyText);
    await this.slack.addReaction(channelId, ts, 'bug');

    this.logger.log({ eventId, planeId: result.id }, 'Ticket creation success');
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function buildMediaHtml(
  files?: TicketJobPayload['files'],
  attachments?: TicketJobPayload['attachments'],
): string {
  const parts: string[] = [];

  if (files?.length) {
    parts.push('<p><strong>Attachments:</strong></p><ul>');
    for (const f of files) {
      if (f.mimetype.startsWith('image/')) {
        parts.push(`<li><a href="${escapeHtml(f.permalink)}">${escapeHtml(f.name)}</a><br/><img src="${escapeHtml(f.url_private)}" alt="${escapeHtml(f.name)}"/></li>`);
      } else {
        parts.push(`<li><a href="${escapeHtml(f.permalink)}">${escapeHtml(f.name)}</a></li>`);
      }
    }
    parts.push('</ul>');
  }

  if (attachments?.length) {
    parts.push('<p><strong>Links:</strong></p><ul>');
    for (const a of attachments) {
      const label = escapeHtml(a.title ?? a.title_link ?? a.text ?? 'Link');
      const href = escapeHtml(a.title_link ?? '');
      if (href) parts.push(`<li><a href="${href}">${label}</a>${a.text ? ` — ${escapeHtml(a.text)}` : ''}</li>`);
      if (a.image_url) parts.push(`<li><img src="${escapeHtml(a.image_url)}" alt="${label}"/></li>`);
    }
    parts.push('</ul>');
  }

  return parts.join('\n');
}
