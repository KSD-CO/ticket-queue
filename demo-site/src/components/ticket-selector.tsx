"use client";

import { useState } from "react";
import { type TicketTier, formatPrice } from "@/lib/events";

interface TicketSelectorProps {
  tiers: TicketTier[];
  eventSlug: string;
  queueEnabled: boolean;
  soldOut: boolean;
}

export function TicketSelector({ tiers, eventSlug, queueEnabled, soldOut }: TicketSelectorProps) {
  const [quantities, setQuantities] = useState<Record<string, number>>({});

  const totalItems = Object.values(quantities).reduce((a, b) => a + b, 0);
  const totalPrice = tiers.reduce((sum, tier) => {
    return sum + (quantities[tier.id] || 0) * tier.price;
  }, 0);

  function updateQuantity(tierId: string, delta: number, max: number) {
    setQuantities((prev) => {
      const current = prev[tierId] || 0;
      const next = Math.max(0, Math.min(max, current + delta));
      return { ...prev, [tierId]: next };
    });
  }

  const currency = tiers[0]?.currency || "VND";

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-bold">Tickets</h2>

      {tiers.map((tier) => {
        const qty = quantities[tier.id] || 0;
        const isAvailable = tier.available > 0;

        return (
          <div
            key={tier.id}
            className={`rounded-xl border p-4 transition-colors ${
              qty > 0
                ? "border-accent bg-accent/5"
                : isAvailable
                  ? "border-border-subtle bg-bg-card hover:border-border"
                  : "border-border-subtle bg-bg-card opacity-50"
            }`}
          >
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <h3 className="font-semibold text-text">{tier.name}</h3>
                  {!isAvailable && (
                    <span className="rounded-full bg-danger/10 px-2 py-0.5 text-xs font-medium text-danger">
                      Sold Out
                    </span>
                  )}
                </div>
                <p className="mt-1 text-sm text-text-muted">{tier.description}</p>
                {isAvailable && (
                  <p className="mt-1 text-xs text-text-muted">
                    {tier.available > 50 ? "Available" : `Only ${tier.available} left`}
                    {" "}· Max {tier.maxPerOrder} per order
                  </p>
                )}
              </div>
              <div className="ml-4 text-right">
                <p className="text-lg font-bold text-text">
                  {formatPrice(tier.price, tier.currency)}
                </p>
              </div>
            </div>

            {isAvailable && (
              <div className="mt-3 flex items-center gap-3">
                <button
                  onClick={() => updateQuantity(tier.id, -1, tier.maxPerOrder)}
                  disabled={qty === 0}
                  className="flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-bg-elevated text-text-secondary transition-colors hover:bg-border disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  -
                </button>
                <span className="w-6 text-center text-sm font-semibold tabular-nums">{qty}</span>
                <button
                  onClick={() => updateQuantity(tier.id, 1, tier.maxPerOrder)}
                  disabled={qty >= tier.maxPerOrder}
                  className="flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-bg-elevated text-text-secondary transition-colors hover:bg-border disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  +
                </button>
              </div>
            )}
          </div>
        );
      })}

      {/* Cart summary + checkout button */}
      {totalItems > 0 && (
        <div className="sticky bottom-4 rounded-xl border border-accent/30 bg-bg-card/95 p-4 backdrop-blur-sm shadow-xl shadow-accent/5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-text-secondary">
                {totalItems} ticket{totalItems > 1 ? "s" : ""}
              </p>
              <p className="text-xl font-bold text-text">
                {formatPrice(totalPrice, currency)}
              </p>
            </div>
            <a
              href={`/checkout?event=${eventSlug}&${Object.entries(quantities)
                .filter(([, v]) => v > 0)
                .map(([k, v]) => `${k}=${v}`)
                .join("&")}`}
              className="rounded-full bg-accent px-6 py-3 text-sm font-bold text-white transition-colors hover:bg-accent-hover"
            >
              {queueEnabled ? "Join Queue to Buy" : "Buy Now"}
            </a>
          </div>
          {queueEnabled && (
            <p className="mt-2 text-xs text-warning">
              This event uses a virtual queue. You&apos;ll be placed in line to ensure fair access.
            </p>
          )}
        </div>
      )}

      {soldOut && (
        <div className="rounded-xl border border-danger/20 bg-danger/5 p-4 text-center">
          <p className="font-semibold text-danger">This event is sold out</p>
          <p className="mt-1 text-sm text-text-muted">Check back later for resale availability.</p>
        </div>
      )}
    </div>
  );
}
