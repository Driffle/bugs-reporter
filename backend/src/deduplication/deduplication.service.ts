import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { createHash } from 'crypto';

const STOPWORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'is', 'it', 'that', 'this', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might', 'must', 'can', 'i', 'we', 'you', 'they', 'he', 'she', 'as', 'so', 'if', 'then', 'than', 'when', 'what', 'which', 'who', 'how', 'just', 'not', 'no', 'only', 'more', 'most', 'some', 'all', 'each', 'every', 'both', 'few', 'other', 'into', 'from', 'up', 'out', 'about', 'over', 'after', 'before', 'between', 'through', 'during', 'without', 'again', 'further', 'once', 'here', 'there', 'any', 'same', 'too', 'very', 'now',
]);

const LAST_N_TICKETS = 50;

@Injectable()
export class DeduplicationService {
  constructor(private readonly prisma: PrismaService) {}

  normalize(text: string): string {
    const lower = text.toLowerCase().trim();
    const words = lower.replace(/[^\w\s]/g, ' ').split(/\s+/).filter(Boolean);
    const filtered = words.filter((w) => w.length > 1 && !STOPWORDS.has(w));
    return filtered.join(' ').trim() || lower;
  }

  hash(normalized: string): string {
    return createHash('sha256').update(normalized).digest('hex');
  }

  /**
   * MVP: compare hash against last N tickets. Same hash = duplicate.
   */
  async findDuplicate(contentHash: string): Promise<{ planeId: string; planeSequenceId: string } | null> {
    const recent = await this.prisma.ticket.findMany({
      orderBy: { createdAt: 'desc' },
      take: LAST_N_TICKETS,
      select: { planeId: true, planeSequenceId: true, contentHash: true },
    });

    for (const t of recent) {
      if (t.contentHash === contentHash) {
        return { planeId: t.planeId, planeSequenceId: t.planeSequenceId ?? t.planeId };
      }
    }
    return null;
  }
}
