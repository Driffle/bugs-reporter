import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';
import { LoggerService } from '../logger/logger.service';

const MAX_RETRIES = 3;
const INITIAL_BACKOFF_MS = 1000;

export interface CreateIssueInput {
  name: string;
  descriptionHtml: string;
  stateId?: string;
  labelIds?: string[];
  priority?: 'none' | 'urgent' | 'high' | 'medium' | 'low';
}

export interface CreateIssueResult {
  id: string;
  sequence_id?: number;
  name: string;
  identifier?: string;
}

@Injectable()
export class PlaneService {
  private readonly api: AxiosInstance;
  private readonly workspaceSlug: string;
  private readonly projectId: string;
  private readonly defaultStateId: string | undefined;
  private readonly defaultLabelIds: string[];

  constructor(
    private readonly config: ConfigService,
    private readonly logger: LoggerService,
  ) {
    const baseURL = (this.config.get<string>('PLANE_BASE_URL') ?? 'https://api.plane.so').replace(/\/$/, '');
    this.workspaceSlug = this.config.get<string>('PLANE_WORKSPACE_SLUG') ?? '';
    this.projectId = this.config.get<string>('PLANE_PROJECT_ID') ?? '';
    this.defaultStateId = this.config.get<string>('PLANE_STATE_ID') || undefined;
    const labelIds = this.config.get<string>('PLANE_LABEL_IDS');
    this.defaultLabelIds = labelIds ? labelIds.split(',').map((s) => s.trim()).filter(Boolean) : [];

    this.api = axios.create({
      baseURL: `${baseURL}/api/v1`,
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': this.config.get<string>('PLANE_API_KEY') ?? '',
      },
      timeout: 15000,
    });
  }

  private async withRetry<T>(fn: () => Promise<T>): Promise<T> {
    let lastError: Error | null = null;
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        return await fn();
      } catch (err: any) {
        lastError = err;
        const status = err.response?.status;
        if (status >= 400 && status < 500 && status !== 429) {
          throw err;
        }
        if (attempt < MAX_RETRIES - 1) {
          const delay = INITIAL_BACKOFF_MS * Math.pow(2, attempt);
          this.logger.warn(`Plane API attempt ${attempt + 1} failed, retrying in ${delay}ms`, 'PlaneService');
          await new Promise((r) => setTimeout(r, delay));
        }
      }
    }
    throw lastError;
  }

  async createIssue(input: CreateIssueInput): Promise<CreateIssueResult> {
    const url = `/workspaces/${this.workspaceSlug}/projects/${this.projectId}/work-items/`;
    const body: Record<string, unknown> = {
      name: input.name,
      description_html: input.descriptionHtml,
      state: input.stateId ?? this.defaultStateId,
      labels: input.labelIds ?? this.defaultLabelIds,
      priority: input.priority ?? 'medium',
    };
    if (!body.state) delete body.state;
    if (!(body.labels as string[])?.length) delete body.labels;

    const res = await this.withRetry(() => this.api.post(url, body));
    const data = res.data as { id: string; sequence_id?: number; name: string; identifier?: string };
    this.logger.log({ planeId: data.id, name: data.name }, 'Plane issue created');
    return {
      id: data.id,
      sequence_id: data.sequence_id,
      name: data.name,
      identifier: data.identifier,
    };
  }

  async addComment(issueId: string, commentHtml: string): Promise<void> {
    const commentUrl = `/workspaces/${this.workspaceSlug}/projects/${this.projectId}/issues/${issueId}/comments/`;
    await this.withRetry(() =>
      this.api.post(commentUrl, { comment_html: commentHtml, comment_storage: { comment_html: commentHtml } }),
    );
    this.logger.log({ issueId }, 'Plane comment added');
  }

  getIssueUrl(issueId: string, sequenceId?: number): string {
    const base = (this.config.get<string>('PLANE_BASE_URL') ?? 'https://api.plane.so').replace(/\/$/, '');
    const appBase = base.replace(/\/api\/v1.*$/, '');
    return `${appBase}/${this.workspaceSlug}/projects/${this.projectId}/issues/${sequenceId ?? issueId}`;
  }
}
