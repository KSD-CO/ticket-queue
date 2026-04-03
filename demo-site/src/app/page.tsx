import Link from "next/link";
import { getFeaturedEvents, EVENTS, CATEGORIES } from "@/lib/events";
import { EventCard } from "@/components/event-card";
import { fetchQueueStatusMap, isQueueEnabled } from "@/lib/queue-status";

export default async function HomePage() {
  const featured = getFeaturedEvents();
  const upcoming = EVENTS.filter((e) => !e.soldOut).slice(0, 4);
  const queueStatusMap = await fetchQueueStatusMap();

  return (
    <>
      {/* ── Hero ── */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-red-900/40 via-bg to-orange-900/20 animate-gradient" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_40%,rgba(208,65,37,0.15),transparent_50%)]" />

        <div className="relative mx-auto max-w-7xl px-4 pb-20 pt-24 sm:px-6 sm:pb-28 sm:pt-32 lg:px-8">
          <div className="max-w-3xl">
            <p className="text-sm font-semibold uppercase tracking-wider text-accent">
              Music events in Vietnam
            </p>
            <h1 className="mt-4 text-4xl font-extrabold tracking-tight sm:text-6xl lg:text-7xl">
              Feel the{" "}
              <span className="gradient-text bg-gradient-to-r from-red-400 via-orange-400 to-amber-400">
                music
              </span>
              , live.
            </h1>
            <p className="mt-6 text-lg text-text-secondary sm:text-xl">
              From intimate jazz sessions to massive festivals. Discover, queue, and buy tickets
              for the hottest events &mdash; powered by our fair virtual queue system.
            </p>
            <div className="mt-8 flex flex-wrap gap-4">
              <Link
                href="/events"
                className="rounded-full bg-accent px-6 py-3 text-sm font-bold text-white transition-colors hover:bg-accent-hover"
              >
                Browse All Events
              </Link>
              <Link
                href="#featured"
                className="rounded-full border border-border bg-bg-card px-6 py-3 text-sm font-medium text-text transition-colors hover:bg-bg-elevated"
              >
                Featured Events
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* ── Category pills ── */}
      <section className="border-b border-border-subtle bg-bg-card/50">
        <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-sm font-medium text-text-muted">Browse by:</span>
            {CATEGORIES.map((cat) => (
              <Link
                key={cat.value}
                href={`/events?category=${cat.value}`}
                className="rounded-full border border-border px-4 py-1.5 text-sm font-medium text-text-secondary transition-colors hover:border-accent hover:text-accent"
              >
                {cat.label}
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* ── Featured events ── */}
      <section id="featured" className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
        <div className="flex items-end justify-between">
          <div>
            <h2 className="text-2xl font-bold sm:text-3xl">Featured Events</h2>
            <p className="mt-1 text-text-secondary">Don&apos;t miss these hot picks</p>
          </div>
          <Link
            href="/events"
            className="text-sm font-medium text-accent hover:text-accent-hover"
          >
            View all &rarr;
          </Link>
        </div>

        <div className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {featured.map((event) => (
            <EventCard key={event.slug} event={event} queueEnabled={isQueueEnabled(queueStatusMap, event.slug)} />
          ))}
        </div>
      </section>

      {/* ── How it works ── */}
      <section className="border-y border-border-subtle bg-bg-card/30">
        <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
          <h2 className="text-center text-2xl font-bold sm:text-3xl">
            How the Queue Works
          </h2>
          <p className="mt-2 text-center text-text-secondary">
            Our fair virtual queue ensures everyone gets equal access to popular events
          </p>

          <div className="mt-12 grid gap-8 sm:grid-cols-3">
            {[
              {
                step: "01",
                title: "Choose Your Tickets",
                desc: "Browse events, pick your ticket tier and quantity.",
              },
              {
                step: "02",
                title: "Enter the Queue",
                desc: "For popular events, you'll be placed in a fair first-come, first-served queue.",
              },
              {
                step: "03",
                title: "Buy When Released",
                desc: "When it's your turn, you get a time-limited token to complete your purchase.",
              },
            ].map((item) => (
              <div key={item.step} className="text-center">
                <span className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-accent/10 text-lg font-bold text-accent">
                  {item.step}
                </span>
                <h3 className="mt-4 text-lg font-semibold">{item.title}</h3>
                <p className="mt-2 text-sm text-text-muted">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Upcoming events ── */}
      <section className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
        <h2 className="text-2xl font-bold sm:text-3xl">Upcoming Events</h2>
        <p className="mt-1 text-text-secondary">Get your tickets before they sell out</p>

        <div className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {upcoming.map((event) => (
            <EventCard key={event.slug} event={event} queueEnabled={isQueueEnabled(queueStatusMap, event.slug)} />
          ))}
        </div>
      </section>
    </>
  );
}
