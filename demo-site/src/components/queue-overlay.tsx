"use client";

import { useState, useEffect, useRef, useCallback } from "react";

type QueueState =
  | { status: "connecting" }
  | { status: "waiting"; position: number; totalAhead: number; estimatedWaitSeconds: number; visitorId: string }
  | { status: "released"; token: string }
  | { status: "paused"; message: string }
  | { status: "queue_full"; currentSize: number; maxSize: number }
  | { status: "error"; message: string };

interface QueueOverlayProps {
  eventId: string;
  queueUrl: string;
  returnUrl: string;
  onRelease: (token: string) => void;
}

export function QueueOverlay({ eventId, queueUrl, returnUrl, onRelease }: QueueOverlayProps) {
  const [state, setState] = useState<QueueState>({ status: "connecting" });
  const [initialPosition, setInitialPosition] = useState<number | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectRef = useRef(0);

  const connect = useCallback(() => {
    const proto = queueUrl.startsWith("https") ? "wss" : "ws";
    const host = new URL(queueUrl).host;
    const url = `${proto}://${host}/queue/ws?event=${encodeURIComponent(eventId)}`;

    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      setState({ status: "connecting" });
      reconnectRef.current = 0;

      const visitorId = localStorage.getItem(`queue_visitor_${eventId}`);
      ws.send(JSON.stringify({ type: "join", visitorId: visitorId || undefined }));
    };

    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        switch (msg.type) {
          case "position":
            localStorage.setItem(`queue_visitor_${eventId}`, msg.visitorId);
            setInitialPosition((prev) => prev ?? msg.position);
            setState({
              status: "waiting",
              position: msg.position,
              totalAhead: msg.totalAhead,
              estimatedWaitSeconds: msg.estimatedWaitSeconds,
              visitorId: msg.visitorId,
            });
            break;
          case "released":
            setState({ status: "released", token: msg.token });
            document.cookie = `__queue_token=${msg.token};path=/;max-age=3600;samesite=lax`;
            onRelease(msg.token);
            break;
          case "paused":
            setState({ status: "paused", message: msg.message || "Queue is temporarily paused" });
            break;
          case "queue_full":
            setState({ status: "queue_full", currentSize: msg.currentSize, maxSize: msg.maxSize });
            break;
          case "error":
            setState({ status: "error", message: msg.message });
            break;
        }
      } catch { /* ignore parse errors */ }
    };

    ws.onclose = () => {
      if (state.status === "released") return;
      reconnectRef.current++;
      const delay = Math.min(1000 * Math.pow(2, reconnectRef.current), 15000);
      setTimeout(connect, delay);
    };

    ws.onerror = () => { /* onclose handles reconnect */ };
  }, [eventId, queueUrl, onRelease, state.status]);

  useEffect(() => {
    connect();
    return () => {
      wsRef.current?.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const progressPct =
    state.status === "waiting" && initialPosition && initialPosition > 1
      ? Math.max(0, Math.min(100, ((initialPosition - state.position) / (initialPosition - 1)) * 100))
      : 0;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-bg/95 backdrop-blur-md">
      <div className="mx-4 w-full max-w-md text-center">
        <h2 className="text-2xl font-bold text-text">You&apos;re in the queue</h2>
        <p className="mt-1 text-sm text-text-secondary">
          Please keep this page open. You&apos;ll be redirected automatically.
        </p>

        <div className="mt-8 rounded-2xl border border-border-subtle bg-bg-card p-6">
          {state.status === "connecting" && (
            <>
              <p className="text-sm text-text-muted">Connecting...</p>
              <div className="mx-auto mt-4 h-1 w-24 animate-pulse rounded-full bg-accent/30" />
            </>
          )}

          {state.status === "waiting" && (
            <>
              <p className="text-xs uppercase tracking-widest text-text-muted">Your position</p>
              <p className="mt-2 text-5xl font-bold tabular-nums text-accent">{state.position}</p>
              <p className="mt-2 text-sm text-text-secondary">
                {state.totalAhead === 0
                  ? "You're next!"
                  : `${state.totalAhead} ${state.totalAhead === 1 ? "person" : "people"} ahead of you`}
              </p>
              <p className="mt-1 text-sm text-text-muted">
                {state.estimatedWaitSeconds < 0
                  ? "Queue is paused"
                  : state.estimatedWaitSeconds <= 60
                    ? "Less than a minute"
                    : `~${Math.ceil(state.estimatedWaitSeconds / 60)} min`}
              </p>

              {/* Progress bar */}
              <div className="mt-4 h-1 w-full overflow-hidden rounded-full bg-bg-elevated">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-accent to-pink-500 transition-all duration-700"
                  style={{ width: `${progressPct}%` }}
                />
              </div>
            </>
          )}

          {state.status === "released" && (
            <>
              <p className="text-4xl">&#10003;</p>
              <p className="mt-2 text-lg font-semibold text-success">You&apos;re in!</p>
              <p className="mt-1 text-sm text-text-muted">Redirecting to checkout...</p>
            </>
          )}

          {state.status === "paused" && (
            <p className="text-sm text-warning">{state.message}</p>
          )}

          {state.status === "queue_full" && (
            <>
              <p className="text-2xl font-bold text-warning">Queue Full</p>
              <p className="mt-2 text-sm text-text-muted">
                {state.currentSize}/{state.maxSize} — please try again later.
              </p>
            </>
          )}

          {state.status === "error" && (
            <p className="text-sm text-danger">{state.message}</p>
          )}
        </div>

        <p className="mt-4 text-xs text-text-muted">
          Powered by ticket queue system
        </p>
      </div>
    </div>
  );
}
