"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  AdminApi,
  AdminApiError,
  type EventConfig,
  type QueueStats,
  type CreateEventInput,
  type UpdateEventInput,
} from "@/lib/admin-api";

// ── Persistence helpers ──────────────────────────────────────

function loadSaved(key: string): string {
  if (typeof window === "undefined") return "";
  return localStorage.getItem(key) ?? "";
}

// ── Main Admin Page ──────────────────────────────────────────

export default function AdminPage() {
  const [apiUrl, setApiUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const apiRef = useRef<AdminApi | null>(null);

  // Load saved credentials on mount
  useEffect(() => {
    setApiUrl(loadSaved("admin_api_url"));
    setApiKey(loadSaved("admin_api_key"));
  }, []);

  const handleConnect = async () => {
    setError(null);
    const url = apiUrl.replace(/\/+$/, "");
    const api = new AdminApi(url, apiKey);
    try {
      await api.listEvents();
      apiRef.current = api;
      localStorage.setItem("admin_api_url", url);
      localStorage.setItem("admin_api_key", apiKey);
      setConnected(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Connection failed");
    }
  };

  if (!connected) {
    return (
      <div className="min-h-[80vh] flex items-center justify-center p-4">
        <div className="w-full max-w-md space-y-6">
          <div className="text-center space-y-2">
            <h1 className="text-2xl font-bold text-text">Queue Admin</h1>
            <p className="text-text-secondary text-sm">
              Connect to your admin API to manage events and monitor queues.
            </p>
          </div>

          <div className="bg-bg-card border border-border rounded-xl p-6 space-y-4">
            <div className="space-y-2">
              <label className="block text-sm font-medium text-text-secondary">
                Admin API URL
              </label>
              <input
                type="url"
                value={apiUrl}
                onChange={(e) => setApiUrl(e.target.value)}
                placeholder="https://ticket-queue-admin.xxx.workers.dev"
                className="w-full bg-bg border border-border rounded-lg px-3 py-2 text-sm text-text placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-accent/50 focus:border-accent"
              />
            </div>
            <div className="space-y-2">
              <label className="block text-sm font-medium text-text-secondary">
                API Key
              </label>
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="Bearer token"
                className="w-full bg-bg border border-border rounded-lg px-3 py-2 text-sm text-text placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-accent/50 focus:border-accent"
                onKeyDown={(e) => e.key === "Enter" && handleConnect()}
              />
            </div>
            {error && (
              <p className="text-danger text-sm">{error}</p>
            )}
            <button
              onClick={handleConnect}
              className="w-full bg-accent hover:bg-accent-hover text-white font-medium py-2 rounded-lg transition-colors"
            >
              Connect
            </button>
          </div>
        </div>
      </div>
    );
  }

  return <AdminDashboard api={apiRef.current!} onDisconnect={() => setConnected(false)} />;
}

// ── Dashboard ────────────────────────────────────────────────

function AdminDashboard({
  api,
  onDisconnect,
}: {
  api: AdminApi;
  onDisconnect: () => void;
}) {
  const [events, setEvents] = useState<EventConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<"list" | "create" | "edit" | "monitor">("list");
  const [selectedEvent, setSelectedEvent] = useState<EventConfig | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadEvents = useCallback(async () => {
    try {
      const data = await api.listEvents();
      setEvents(data.events);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load events");
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    loadEvents();
  }, [loadEvents]);

  const handleCreate = async (input: CreateEventInput) => {
    await api.createEvent(input);
    await loadEvents();
    setView("list");
  };

  const handleUpdate = async (id: string, input: UpdateEventInput) => {
    await api.updateEvent(id, input);
    await loadEvents();
    setView("list");
    setSelectedEvent(null);
  };

  const handleDelete = async (id: string) => {
    await api.deleteEvent(id);
    await loadEvents();
    setView("list");
    setSelectedEvent(null);
  };

  const handleToggle = async (event: EventConfig) => {
    await api.updateEvent(event.eventId, { enabled: !event.enabled });
    await loadEvents();
  };

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-text">Queue Admin</h1>
          <p className="text-text-muted text-sm mt-1">
            {events.length} event{events.length !== 1 && "s"} configured
          </p>
        </div>
        <div className="flex items-center gap-3">
          {view !== "list" && (
            <button
              onClick={() => { setView("list"); setSelectedEvent(null); }}
              className="px-4 py-2 text-sm text-text-secondary hover:text-text border border-border rounded-lg transition-colors"
            >
              Back
            </button>
          )}
          {view === "list" && (
            <button
              onClick={() => setView("create")}
              className="px-4 py-2 text-sm bg-accent hover:bg-accent-hover text-white rounded-lg transition-colors"
            >
              + New Event
            </button>
          )}
          <button
            onClick={onDisconnect}
            className="px-4 py-2 text-sm text-text-muted hover:text-danger border border-border rounded-lg transition-colors"
          >
            Disconnect
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-6 bg-danger/10 border border-danger/30 text-danger rounded-lg px-4 py-3 text-sm">
          {error}
        </div>
      )}

      {/* Views */}
      {loading && view === "list" && (
        <div className="text-center py-20 text-text-muted">Loading...</div>
      )}

      {!loading && view === "list" && (
        <EventList
          events={events}
          onEdit={(e) => { setSelectedEvent(e); setView("edit"); }}
          onMonitor={(e) => { setSelectedEvent(e); setView("monitor"); }}
          onToggle={handleToggle}
          onDelete={handleDelete}
        />
      )}

      {view === "create" && (
        <EventForm onSubmit={handleCreate} />
      )}

      {view === "edit" && selectedEvent && (
        <EventForm
          event={selectedEvent}
          onSubmit={(input) => handleUpdate(selectedEvent.eventId, input)}
        />
      )}

      {view === "monitor" && selectedEvent && (
        <QueueMonitor api={api} event={selectedEvent} />
      )}
    </div>
  );
}

// ── Event List ───────────────────────────────────────────────

function EventList({
  events,
  onEdit,
  onMonitor,
  onToggle,
  onDelete,
}: {
  events: EventConfig[];
  onEdit: (e: EventConfig) => void;
  onMonitor: (e: EventConfig) => void;
  onToggle: (e: EventConfig) => void;
  onDelete: (id: string) => void;
}) {
  if (events.length === 0) {
    return (
      <div className="text-center py-20">
        <p className="text-text-muted text-lg mb-2">No events configured</p>
        <p className="text-text-muted text-sm">Create your first event to get started.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {events.map((event) => (
        <div
          key={event.eventId}
          className="bg-bg-card border border-border rounded-xl p-5 flex items-center justify-between gap-4"
        >
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-3 mb-1">
              <h3 className="font-semibold text-text truncate">{event.name}</h3>
              <span
                className={`shrink-0 inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                  event.enabled
                    ? "bg-success/15 text-success"
                    : "bg-text-muted/15 text-text-muted"
                }`}
              >
                {event.enabled ? "Active" : "Disabled"}
              </span>
              <span className="shrink-0 inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-accent/15 text-accent">
                {event.mode}
              </span>
            </div>
            <div className="flex items-center gap-4 text-xs text-text-muted">
              <span>ID: {event.eventId}</span>
              <span>{event.releaseRate}/min</span>
              <span>Queue: {event.maxQueueSize === 0 ? "unlimited" : event.maxQueueSize}</span>
              <span>Paths: {event.protectedPaths.join(", ")}</span>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => onMonitor(event)}
              className="px-3 py-1.5 text-xs font-medium text-accent hover:bg-accent/10 border border-accent/30 rounded-lg transition-colors"
            >
              Monitor
            </button>
            <button
              onClick={() => onEdit(event)}
              className="px-3 py-1.5 text-xs font-medium text-text-secondary hover:text-text hover:bg-bg-elevated border border-border rounded-lg transition-colors"
            >
              Edit
            </button>
            <button
              onClick={() => onToggle(event)}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors border ${
                event.enabled
                  ? "text-warning hover:bg-warning/10 border-warning/30"
                  : "text-success hover:bg-success/10 border-success/30"
              }`}
            >
              {event.enabled ? "Disable" : "Enable"}
            </button>
            <button
              onClick={() => {
                if (confirm(`Delete event "${event.name}"?`)) {
                  onDelete(event.eventId);
                }
              }}
              className="px-3 py-1.5 text-xs font-medium text-danger hover:bg-danger/10 border border-danger/30 rounded-lg transition-colors"
            >
              Delete
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Event Form ───────────────────────────────────────────────

function EventForm({
  event,
  onSubmit,
}: {
  event?: EventConfig;
  onSubmit: (input: any) => Promise<void>;
}) {
  const isEdit = !!event;

  const [form, setForm] = useState({
    eventId: event?.eventId ?? "",
    name: event?.name ?? "",
    protectedPaths: event?.protectedPaths.join(", ") ?? "",
    originUrl: event?.originUrl ?? "",
    releaseRate: event?.releaseRate ?? 60,
    mode: event?.mode ?? "always",
    activationThreshold: event?.activationThreshold ?? 100,
    tokenTtlSeconds: event?.tokenTtlSeconds ?? 1800,
    failMode: event?.failMode ?? "open",
    maxQueueSize: event?.maxQueueSize ?? 0,
    eventStartTime: event?.eventStartTime ?? "",
    eventEndTime: event?.eventEndTime ?? "",
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = (field: string, value: any) =>
    setForm((prev) => ({ ...prev, [field]: value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      const input: any = {
        ...form,
        protectedPaths: form.protectedPaths.split(",").map((s) => s.trim()).filter(Boolean),
        releaseRate: Number(form.releaseRate),
        tokenTtlSeconds: Number(form.tokenTtlSeconds),
        maxQueueSize: Number(form.maxQueueSize),
        activationThreshold: form.mode === "threshold" ? Number(form.activationThreshold) : undefined,
      };
      if (!input.eventStartTime) delete input.eventStartTime;
      if (!input.eventEndTime) delete input.eventEndTime;
      if (input.activationThreshold === undefined) delete input.activationThreshold;
      if (isEdit) delete input.eventId;
      await onSubmit(input);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Submit failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="max-w-2xl space-y-6">
      <h2 className="text-xl font-bold text-text">
        {isEdit ? `Edit: ${event.name}` : "Create Event"}
      </h2>

      {error && (
        <div className="bg-danger/10 border border-danger/30 text-danger rounded-lg px-4 py-3 text-sm">
          {error}
        </div>
      )}

      <div className="bg-bg-card border border-border rounded-xl p-6 space-y-5">
        {/* Basic Info */}
        <fieldset className="space-y-4">
          <legend className="text-sm font-semibold text-text-secondary uppercase tracking-wider mb-2">
            Basic Info
          </legend>

          {!isEdit && (
            <Field label="Event ID" hint="URL-safe identifier (e.g. neon-nights-2026)">
              <input
                type="text"
                value={form.eventId}
                onChange={(e) => set("eventId", e.target.value)}
                pattern="^[a-zA-Z0-9_-]+$"
                required
                className="input"
              />
            </Field>
          )}

          <Field label="Name">
            <input
              type="text"
              value={form.name}
              onChange={(e) => set("name", e.target.value)}
              required
              className="input"
            />
          </Field>

          <Field label="Origin URL" hint="HTTPS URL of the origin server">
            <input
              type="url"
              value={form.originUrl}
              onChange={(e) => set("originUrl", e.target.value)}
              required
              className="input"
              placeholder="https://example.com"
            />
          </Field>

          <Field label="Protected Paths" hint="Comma-separated (e.g. /checkout/*, /tickets/*)">
            <input
              type="text"
              value={form.protectedPaths}
              onChange={(e) => set("protectedPaths", e.target.value)}
              required
              className="input"
              placeholder="/checkout/*, /tickets/*"
            />
          </Field>
        </fieldset>

        {/* Queue Config */}
        <fieldset className="space-y-4 pt-4 border-t border-border-subtle">
          <legend className="text-sm font-semibold text-text-secondary uppercase tracking-wider mb-2">
            Queue Configuration
          </legend>

          <div className="grid grid-cols-2 gap-4">
            <Field label="Release Rate" hint="Visitors per minute">
              <input
                type="number"
                value={form.releaseRate}
                onChange={(e) => set("releaseRate", e.target.value)}
                min={0}
                className="input"
              />
            </Field>

            <Field label="Max Queue Size" hint="0 = unlimited">
              <input
                type="number"
                value={form.maxQueueSize}
                onChange={(e) => set("maxQueueSize", e.target.value)}
                min={0}
                className="input"
              />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <Field label="Mode">
              <select
                value={form.mode}
                onChange={(e) => set("mode", e.target.value)}
                className="input"
              >
                <option value="always">Always</option>
                <option value="threshold">Threshold</option>
              </select>
            </Field>

            <Field label="Fail Mode">
              <select
                value={form.failMode}
                onChange={(e) => set("failMode", e.target.value)}
                className="input"
              >
                <option value="open">Open (allow through)</option>
                <option value="closed">Closed (block)</option>
              </select>
            </Field>
          </div>

          {form.mode === "threshold" && (
            <Field label="Activation Threshold" hint="Queue activates when visitors >= this number">
              <input
                type="number"
                value={form.activationThreshold}
                onChange={(e) => set("activationThreshold", e.target.value)}
                min={1}
                required
                className="input"
                placeholder="100"
              />
            </Field>
          )}

          <Field label="Token TTL" hint="Seconds (min 60)">
            <input
              type="number"
              value={form.tokenTtlSeconds}
              onChange={(e) => set("tokenTtlSeconds", e.target.value)}
              min={60}
              className="input"
            />
          </Field>
        </fieldset>

        {/* Schedule */}
        <fieldset className="space-y-4 pt-4 border-t border-border-subtle">
          <legend className="text-sm font-semibold text-text-secondary uppercase tracking-wider mb-2">
            Schedule (Optional)
          </legend>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Start Time">
              <input
                type="datetime-local"
                value={form.eventStartTime}
                onChange={(e) => set("eventStartTime", e.target.value)}
                className="input"
              />
            </Field>
            <Field label="End Time">
              <input
                type="datetime-local"
                value={form.eventEndTime}
                onChange={(e) => set("eventEndTime", e.target.value)}
                className="input"
              />
            </Field>
          </div>
        </fieldset>
      </div>

      <button
        type="submit"
        disabled={submitting}
        className="px-6 py-2.5 bg-accent hover:bg-accent-hover disabled:opacity-50 text-white font-medium rounded-lg transition-colors"
      >
        {submitting ? "Saving..." : isEdit ? "Update Event" : "Create Event"}
      </button>
    </form>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label className="block text-sm font-medium text-text-secondary">
        {label}
        {hint && <span className="ml-1.5 text-text-muted font-normal">({hint})</span>}
      </label>
      {children}
    </div>
  );
}

// ── Queue Monitor ────────────────────────────────────────────

function QueueMonitor({
  api,
  event,
}: {
  api: AdminApi;
  event: EventConfig;
}) {
  const [stats, setStats] = useState<QueueStats | null>(null);
  const [rate, setRate] = useState(event.releaseRate);
  const [rateInput, setRateInput] = useState(String(event.releaseRate));
  const [error, setError] = useState<string | null>(null);
  const [updating, setUpdating] = useState(false);

  const fetchStats = useCallback(async () => {
    try {
      const data = await api.getStats(event.eventId);
      setStats(data);
      setError(null);
    } catch (e) {
      if (e instanceof AdminApiError && e.statusCode === 429) {
        setError(`Rate limited. Retry in ${e.retryAfter ?? 60}s...`);
      } else {
        setError(e instanceof Error ? e.message : "Failed to fetch stats");
      }
    }
  }, [api, event.eventId]);

  useEffect(() => {
    fetchStats();
    const interval = setInterval(fetchStats, 3000);
    return () => clearInterval(interval);
  }, [fetchStats]);

  const handleRateUpdate = async () => {
    const newRate = Number(rateInput);
    if (isNaN(newRate) || newRate < 0) return;
    setUpdating(true);
    try {
      await api.updateRate(event.eventId, newRate);
      setRate(newRate);
      setError(null);
    } catch (e) {
      if (e instanceof AdminApiError && e.statusCode === 429) {
        setError(`Rate limited. Retry in ${e.retryAfter ?? 60}s...`);
      } else {
        setError(e instanceof Error ? e.message : "Failed to update rate");
      }
    } finally {
      setUpdating(false);
    }
  };

  const avgWaitSec = stats?.averageWaitMs ? Math.round(stats.averageWaitMs / 1000) : null;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-text">{event.name}</h2>
        <p className="text-text-muted text-sm mt-1">
          Live queue monitor — refreshes every 3s
        </p>
      </div>

      {error && (
        <div className="bg-danger/10 border border-danger/30 text-danger rounded-lg px-4 py-3 text-sm">
          {error}
        </div>
      )}

      {/* Stats Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard
          label="In Queue"
          value={stats?.activeVisitors ?? "-"}
          color="accent"
        />
        <StatCard
          label="Released"
          value={stats?.releasedVisitors ?? "-"}
          color="success"
        />
        <StatCard
          label="WS Connections"
          value={stats?.webSocketConnections ?? "-"}
          color="warning"
        />
        <StatCard
          label="Avg Wait"
          value={avgWaitSec !== null ? `${avgWaitSec}s` : "-"}
          color="accent"
        />
      </div>

      {/* Total visitors */}
      <div className="bg-bg-card border border-border rounded-xl p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <p className="text-sm text-text-muted">Total Visitors (all time)</p>
            <p className="text-3xl font-bold text-text mt-1">
              {stats?.totalVisitors ?? "-"}
            </p>
          </div>
          <div className="text-right">
            <p className="text-sm text-text-muted">Current Release Rate</p>
            <p className="text-3xl font-bold text-accent mt-1">{rate}/min</p>
          </div>
        </div>

        {/* Progress bar: active vs released */}
        {stats && stats.totalVisitors > 0 && (
          <div className="mt-4">
            <div className="flex justify-between text-xs text-text-muted mb-1">
              <span>Active: {stats.activeVisitors}</span>
              <span>Released: {stats.releasedVisitors}</span>
            </div>
            <div className="h-2 bg-bg-elevated rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-accent to-success rounded-full transition-all duration-500"
                style={{
                  width: `${(stats.releasedVisitors / stats.totalVisitors) * 100}%`,
                }}
              />
            </div>
          </div>
        )}
      </div>

      {/* Rate Control */}
      <div className="bg-bg-card border border-border rounded-xl p-5">
        <h3 className="text-sm font-semibold text-text-secondary uppercase tracking-wider mb-4">
          Rate Control
        </h3>
        <div className="flex items-end gap-3">
          <div className="flex-1 space-y-1.5">
            <label className="block text-sm text-text-muted">
              Release Rate (visitors/min)
            </label>
            <input
              type="number"
              value={rateInput}
              onChange={(e) => setRateInput(e.target.value)}
              min={0}
              className="input"
              onKeyDown={(e) => e.key === "Enter" && handleRateUpdate()}
            />
          </div>
          <button
            onClick={handleRateUpdate}
            disabled={updating}
            className="px-4 py-2 bg-accent hover:bg-accent-hover disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors"
          >
            {updating ? "..." : "Update"}
          </button>
          <button
            onClick={() => { setRateInput("0"); }}
            className="px-4 py-2 text-warning hover:bg-warning/10 border border-warning/30 text-sm font-medium rounded-lg transition-colors"
          >
            Pause
          </button>
        </div>
        <p className="text-xs text-text-muted mt-2">
          Set to 0 to pause the queue. Visitors will remain in queue but no one will be released.
        </p>
      </div>

      {/* Event Config Summary */}
      <div className="bg-bg-card border border-border rounded-xl p-5">
        <h3 className="text-sm font-semibold text-text-secondary uppercase tracking-wider mb-4">
          Event Configuration
        </h3>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-y-3 gap-x-6 text-sm">
          <ConfigRow label="Event ID" value={event.eventId} />
          <ConfigRow label="Status" value={event.enabled ? "Active" : "Disabled"} />
          <ConfigRow label="Mode" value={event.mode} />
          {event.mode === "threshold" && event.activationThreshold && (
            <ConfigRow label="Threshold" value={String(event.activationThreshold)} />
          )}
          <ConfigRow label="Fail Mode" value={event.failMode} />
          <ConfigRow label="Token TTL" value={`${event.tokenTtlSeconds}s`} />
          <ConfigRow label="Max Queue" value={event.maxQueueSize === 0 ? "Unlimited" : String(event.maxQueueSize)} />
          <ConfigRow label="Origin" value={event.originUrl} />
          <ConfigRow label="Paths" value={event.protectedPaths.join(", ")} />
          <ConfigRow label="Created" value={new Date(event.createdAt).toLocaleString()} />
        </div>
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  color,
}: {
  label: string;
  value: string | number;
  color: "accent" | "success" | "warning";
}) {
  const colorMap = {
    accent: "text-accent",
    success: "text-success",
    warning: "text-warning",
  };

  return (
    <div className="bg-bg-card border border-border rounded-xl p-4">
      <p className="text-xs text-text-muted uppercase tracking-wider">{label}</p>
      <p className={`text-2xl font-bold mt-1 ${colorMap[color]}`}>{value}</p>
    </div>
  );
}

function ConfigRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-text-muted">{label}</p>
      <p className="text-text font-medium truncate">{value}</p>
    </div>
  );
}
