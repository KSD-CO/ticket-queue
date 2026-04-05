// ============================================================
// Admin API client — browser-side fetch wrapper
// ============================================================

export interface EventConfig {
  eventId: string;
  name: string;
  enabled: boolean;
  protectedPaths: string[];
  originUrl: string;
  releaseRate: number;
  mode: "always" | "threshold";
  activationThreshold?: number;
  tokenTtlSeconds: number;
  failMode: "open" | "closed";
  turnstileEnabled: boolean;
  turnstileSiteKey?: string;
  turnstileSecretKey?: string;
  maxQueueSize: number;
  eventStartTime?: string;
  eventEndTime?: string;
  createdAt: string;
  updatedAt: string;
}

export interface QueueStats {
  eventId: string;
  activeVisitors: number;
  releasedVisitors: number;
  totalVisitors: number;
  averageWaitMs: number | null;
  webSocketConnections: number;
}

export interface CreateEventInput {
  eventId: string;
  name: string;
  protectedPaths: string[];
  originUrl: string;
  releaseRate?: number;
  mode?: "always" | "threshold";
  activationThreshold?: number;
  tokenTtlSeconds?: number;
  failMode?: "open" | "closed";
  maxQueueSize?: number;
  eventStartTime?: string;
  eventEndTime?: string;
}

export type UpdateEventInput = Partial<Omit<CreateEventInput, "eventId">> & {
  enabled?: boolean;
};

export class AdminApiError extends Error {
  public retryAfter?: number;

  constructor(
    public statusCode: number,
    message: string,
    retryAfter?: number,
  ) {
    super(message);
    this.retryAfter = retryAfter;
  }
}

export class AdminApi {
  constructor(
    private baseUrl: string,
    private apiKey: string,
  ) {}

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
        ...init?.headers,
      },
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({ message: res.statusText }));
      const retryAfter = res.status === 429
        ? parseInt(res.headers.get("Retry-After") ?? "", 10) || undefined
        : undefined;
      throw new AdminApiError(
        res.status,
        (body as { message?: string }).message ?? res.statusText,
        retryAfter,
      );
    }

    return res.json() as Promise<T>;
  }

  async listEvents(): Promise<{ events: EventConfig[]; total: number }> {
    return this.request("/api/events");
  }

  async getEvent(id: string): Promise<EventConfig> {
    return this.request(`/api/events/${id}`);
  }

  async createEvent(input: CreateEventInput): Promise<EventConfig> {
    return this.request("/api/events", {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  async updateEvent(id: string, input: UpdateEventInput): Promise<EventConfig> {
    return this.request(`/api/events/${id}`, {
      method: "PUT",
      body: JSON.stringify(input),
    });
  }

  async deleteEvent(id: string): Promise<{ deleted: boolean; eventId: string }> {
    return this.request(`/api/events/${id}`, { method: "DELETE" });
  }

  async updateRate(
    id: string,
    releaseRate: number,
  ): Promise<{ eventId: string; releaseRate: number }> {
    return this.request(`/api/events/${id}/rate`, {
      method: "PUT",
      body: JSON.stringify({ releaseRate }),
    });
  }

  async getStats(id: string): Promise<QueueStats> {
    return this.request(`/api/events/${id}/stats`);
  }
}
