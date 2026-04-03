"use client";

import { useState, useEffect, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { getEventBySlug, formatPrice, type MusicEvent, type TicketTier } from "@/lib/events";
import { QueueOverlay } from "@/components/queue-overlay";

function CheckoutContent() {
  const searchParams = useSearchParams();
  const eventSlug = searchParams.get("event");
  const [event, setEvent] = useState<MusicEvent | null>(null);
  const [orderItems, setOrderItems] = useState<{ tier: TicketTier; qty: number }[]>([]);
  const [showQueue, setShowQueue] = useState(false);
  const [hasToken, setHasToken] = useState(false);
  const [paymentSubmitted, setPaymentSubmitted] = useState(false);

  useEffect(() => {
    if (!eventSlug) return;
    const found = getEventBySlug(eventSlug);
    if (!found) return;
    setEvent(found);

    // Parse ticket quantities from URL
    const items: { tier: TicketTier; qty: number }[] = [];
    for (const tier of found.ticketTiers) {
      const qty = parseInt(searchParams.get(tier.id) || "0", 10);
      if (qty > 0) {
        items.push({ tier, qty });
      }
    }
    setOrderItems(items);

    // Check if we already have a queue token
    const cookies = document.cookie.split(";");
    const tokenCookie = cookies.find((c) => c.trim().startsWith("__queue_token="));
    if (tokenCookie) {
      setHasToken(true);
    } else if (found.queueEnabled) {
      // Need to go through queue
      setShowQueue(true);
    }
  }, [eventSlug, searchParams]);

  if (!eventSlug || !event) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-20 text-center">
        <h1 className="text-2xl font-bold">No event selected</h1>
        <p className="mt-2 text-text-muted">Please choose an event first.</p>
        <Link
          href="/events"
          className="mt-4 inline-block rounded-full bg-accent px-5 py-2 text-sm font-semibold text-white hover:bg-accent-hover"
        >
          Browse Events
        </Link>
      </div>
    );
  }

  if (orderItems.length === 0) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-20 text-center">
        <h1 className="text-2xl font-bold">No tickets selected</h1>
        <p className="mt-2 text-text-muted">Go back and select your tickets.</p>
        <Link
          href={`/events/${event.slug}`}
          className="mt-4 inline-block rounded-full bg-accent px-5 py-2 text-sm font-semibold text-white hover:bg-accent-hover"
        >
          Back to Event
        </Link>
      </div>
    );
  }

  const total = orderItems.reduce((sum, item) => sum + item.tier.price * item.qty, 0);
  const currency = orderItems[0]?.tier.currency || "VND";

  function handleQueueRelease(token: string) {
    setHasToken(true);
    setShowQueue(false);
  }

  if (paymentSubmitted) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-20 text-center">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-success/10 text-3xl text-success">
          &#10003;
        </div>
        <h1 className="mt-4 text-2xl font-bold">Order Confirmed!</h1>
        <p className="mt-2 text-text-secondary">
          Your tickets for <strong>{event.title}</strong> have been booked.
        </p>
        <p className="mt-1 text-sm text-text-muted">
          Confirmation will be sent to your email. Order #{Math.random().toString(36).slice(2, 10).toUpperCase()}
        </p>

        <div className="mt-8 rounded-xl border border-border-subtle bg-bg-card p-6 text-left">
          <h3 className="font-semibold">Order Summary</h3>
          {orderItems.map((item) => (
            <div key={item.tier.id} className="mt-3 flex justify-between text-sm">
              <span className="text-text-secondary">
                {item.qty}x {item.tier.name}
              </span>
              <span className="font-medium">{formatPrice(item.tier.price * item.qty, item.tier.currency)}</span>
            </div>
          ))}
          <div className="mt-4 border-t border-border-subtle pt-3 flex justify-between font-bold">
            <span>Total</span>
            <span>{formatPrice(total, currency)}</span>
          </div>
        </div>

        <Link
          href="/"
          className="mt-6 inline-block rounded-full bg-accent px-6 py-2 text-sm font-semibold text-white hover:bg-accent-hover"
        >
          Back to Home
        </Link>
      </div>
    );
  }

  return (
    <>
      {/* Queue overlay */}
      {showQueue && (
        <QueueOverlay
          eventId={event.slug}
          queueUrl={typeof window !== "undefined" ? window.location.origin : ""}
          returnUrl={typeof window !== "undefined" ? window.location.href : ""}
          onRelease={handleQueueRelease}
        />
      )}

      <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
        {/* Queue status banner */}
        {event.queueEnabled && hasToken && (
          <div className="mb-6 rounded-xl border border-success/20 bg-success/5 p-4 text-center">
            <p className="text-sm font-medium text-success">
              &#10003; You have queue access. Complete your purchase before the token expires.
            </p>
          </div>
        )}

        <h1 className="text-2xl font-bold sm:text-3xl">Checkout</h1>
        <p className="mt-1 text-text-secondary">{event.title}</p>

        <div className="mt-8 grid gap-8 lg:grid-cols-5">
          {/* Order summary */}
          <div className="lg:col-span-2">
            <div className="rounded-xl border border-border-subtle bg-bg-card p-5">
              <h2 className="font-semibold">Order Summary</h2>

              <div className="mt-4 space-y-3">
                {orderItems.map((item) => (
                  <div key={item.tier.id} className="flex justify-between">
                    <div>
                      <p className="text-sm font-medium text-text">{item.tier.name}</p>
                      <p className="text-xs text-text-muted">Qty: {item.qty}</p>
                    </div>
                    <p className="text-sm font-semibold">
                      {formatPrice(item.tier.price * item.qty, item.tier.currency)}
                    </p>
                  </div>
                ))}
              </div>

              <div className="mt-4 border-t border-border-subtle pt-4 flex justify-between">
                <span className="font-bold">Total</span>
                <span className="text-xl font-bold text-accent">
                  {formatPrice(total, currency)}
                </span>
              </div>
            </div>

            {/* Event info */}
            <div className="mt-4 rounded-xl border border-border-subtle bg-bg-card p-5">
              <div className="flex items-center gap-3">
                <div
                  className="flex h-12 w-12 items-center justify-center rounded-xl text-2xl"
                  style={{
                    background: `linear-gradient(135deg, ${event.imageGradient[0]}, ${event.imageGradient[1]})`,
                  }}
                >
                  {event.emoji}
                </div>
                <div>
                  <p className="font-semibold">{event.title}</p>
                  <p className="text-xs text-text-muted">
                    {event.venue}, {event.city}
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Payment form */}
          <div className="lg:col-span-3">
            <div className="rounded-xl border border-border-subtle bg-bg-card p-5">
              <h2 className="font-semibold">Contact Information</h2>
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <InputField label="First Name" placeholder="James" />
                <InputField label="Last Name" placeholder="Nguyen" />
                <InputField label="Email" placeholder="james@example.com" className="sm:col-span-2" type="email" />
                <InputField label="Phone" placeholder="+84 901 234 567" className="sm:col-span-2" type="tel" />
              </div>
            </div>

            <div className="mt-6 rounded-xl border border-border-subtle bg-bg-card p-5">
              <h2 className="font-semibold">Payment</h2>
              <div className="mt-4 grid gap-4">
                <InputField label="Card Number" placeholder="4242 4242 4242 4242" />
                <div className="grid grid-cols-2 gap-4">
                  <InputField label="Expiry" placeholder="MM/YY" />
                  <InputField label="CVC" placeholder="123" />
                </div>
                <InputField label="Cardholder Name" placeholder="JAMES NGUYEN" />
              </div>
            </div>

            <button
              onClick={() => setPaymentSubmitted(true)}
              className="mt-6 w-full rounded-full bg-accent py-3.5 text-center text-sm font-bold text-white transition-colors hover:bg-accent-hover"
            >
              Pay {formatPrice(total, currency)}
            </button>

            <p className="mt-3 text-center text-xs text-text-muted">
              Demo only — no real payment is processed.
            </p>
          </div>
        </div>
      </div>
    </>
  );
}

function InputField({
  label,
  placeholder,
  type = "text",
  className = "",
}: {
  label: string;
  placeholder: string;
  type?: string;
  className?: string;
}) {
  return (
    <div className={className}>
      <label className="mb-1 block text-xs font-medium text-text-muted">{label}</label>
      <input
        type={type}
        placeholder={placeholder}
        className="w-full rounded-lg border border-border bg-bg-elevated px-3 py-2.5 text-sm text-text placeholder:text-text-muted focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
      />
    </div>
  );
}

export default function CheckoutPage() {
  return (
    <Suspense
      fallback={
        <div className="mx-auto max-w-2xl px-4 py-20 text-center">
          <p className="text-text-muted">Loading checkout...</p>
        </div>
      }
    >
      <CheckoutContent />
    </Suspense>
  );
}
