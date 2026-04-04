"use client";

import { useEffect, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";

/**
 * Backward-compat redirect: /checkout?event=slug&... -> /checkout/slug?...
 * Keeps all other query params (ticket quantities etc.)
 */
function RedirectContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const eventSlug = searchParams.get("event");

  useEffect(() => {
    if (!eventSlug) return;
    // Build new URL: /checkout/{slug} with remaining params
    const remaining = new URLSearchParams();
    searchParams.forEach((value, key) => {
      if (key !== "event") remaining.set(key, value);
    });
    const qs = remaining.toString();
    router.replace(`/checkout/${eventSlug}${qs ? `?${qs}` : ""}`);
  }, [eventSlug, searchParams, router]);

  if (!eventSlug) {
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

  return (
    <div className="mx-auto max-w-2xl px-4 py-20 text-center">
      <p className="text-text-muted">Redirecting...</p>
    </div>
  );
}

export default function CheckoutRedirectPage() {
  return (
    <Suspense
      fallback={
        <div className="mx-auto max-w-2xl px-4 py-20 text-center">
          <p className="text-text-muted">Loading...</p>
        </div>
      }
    >
      <RedirectContent />
    </Suspense>
  );
}
