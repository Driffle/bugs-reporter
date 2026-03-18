import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LoggerService } from '../logger/logger.service';

export interface BugSummary {
  title: string;
  stepsToReproduce?: string;
  expectedVsActual?: string;
  severity?: 'low' | 'medium' | 'high' | 'critical';
}

@Injectable()
export class AiService {
  private readonly openaiKey: string | undefined;

  constructor(
    private readonly config: ConfigService,
    private readonly logger: LoggerService,
  ) {
    this.openaiKey = this.config.get<string>('OPENAI_API_KEY') || undefined;
  }

  async summarizeForBug(messageText: string): Promise<BugSummary> {
    if (!this.openaiKey || !messageText.trim()) {
      return this.fallbackSummary(messageText);
    }
    try {
      const OpenAI = (await import('openai')).default;
      const openai = new OpenAI({ apiKey: this.openaiKey });
      const firstLine = messageText.split(/\n/)[0]?.trim().slice(0, 200) ?? messageText.slice(0, 200);
      const res = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: `You are a bug report assistant. Given a short bug description, respond with a JSON object only (no markdown):
{ "title": "concise bug title under 80 chars", "stepsToReproduce": "optional", "expectedVsActual": "optional", "severity": "low"|"medium"|"high"|"critical" }
Keep title concise. Use severity only if obvious.`,
          },
          { role: 'user', content: firstLine },
        ],
        max_tokens: 300,
      });
      const content = res.choices[0]?.message?.content?.trim();
      if (!content) return this.fallbackSummary(messageText);
      const json = content.replace(/^```\w*\n?|\n?```$/g, '').trim();
      const parsed = JSON.parse(json) as BugSummary;
      return {
        title: String(parsed.title || firstLine).slice(0, 255),
        stepsToReproduce: parsed.stepsToReproduce,
        expectedVsActual: parsed.expectedVsActual,
        severity: parsed.severity,
      };
    } catch (err) {
      this.logger.warn({ err }, 'AI summary failed, using fallback');
      return this.fallbackSummary(messageText);
    }
  }

  private fallbackSummary(messageText: string): BugSummary {
    const firstLine = messageText.split(/\n/).find((l) => l.trim().length > 0)?.trim();
    const title = (firstLine ?? messageText.slice(0, 150)).slice(0, 255);
    return { title: title || 'Bug report' };
  }
}
