import { notFound } from "next/navigation";
import Link from "next/link";
import { getEventBySlug, EVENTS, formatDate, formatPrice } from "@/lib/events";
import { fetchQueueStatusMap, isQueueEnabled } from "@/lib/queue-status";
import { TicketSelector } from "@/components/ticket-selector";

interface EventDetailPageProps {
  params: Promise<{ slug: string }>;
}

export async function generateStaticParams() {
  return EVENTS.map((e) => ({ slug: e.slug }));
}

export async function generateMetadata({ params }: EventDetailPageProps) {
  const { slug } = await params;
  const event = getEventBySlug(slug);
  if (!event) return { title: "Event Not Found" };
  return {
    title: event.title,
    description: event.tagline,
  };
}

export default async function EventDetailPage({ params }: EventDetailPageProps) {
  const { slug } = await params;
  const event = getEventBySlug(slug);

  if (!event) {
    notFound();
  }

  const queueStatusMap = await fetchQueueStatusMap();
  const queueEnabled = isQueueEnabled(queueStatusMap, event.slug);

  const lowestAvailable = event.ticketTiers
    .filter((t) => t.available > 0)
    .sort((a, b) => a.price - b.price)[0];

  return (
    <div>
      {/* Hero banner */}
      <div
        className="relative flex min-h-[320px] items-end sm:min-h-[400px]"
        style={{
          background: `linear-gradient(135deg, ${event.imageGradient[0]}, ${event.imageGradient[1]})`,
        }}
      >
        <div className="absolute inset-0 bg-gradient-to-t from-bg via-bg/60 to-transparent" />
        <div className="relative mx-auto w-full max-w-7xl px-4 pb-8 pt-24 sm:px-6 lg:px-8">
          <div className="flex items-center gap-3">
            <span className="rounded-full bg-white/10 px-3 py-1 text-xs font-medium text-white backdrop-blur-sm">
              {event.category.replace("-", " ")}
            </span>
            {queueEnabled && (
              <span className="rounded-full bg-accent/80 px-3 py-1 text-xs font-medium text-white backdrop-blur-sm">
                Virtual Queue
              </span>
            )}
            {event.soldOut && (
              <span className="rounded-full bg-danger px-3 py-1 text-xs font-bold text-white">
                SOLD OUT
              </span>
            )}
          </div>
          <h1 className="mt-3 text-3xl font-extrabold sm:text-5xl">{event.title}</h1>
          <p className="mt-2 text-lg text-text-secondary">{event.tagline}</p>
        </div>
      </div>

      {/* Content */}
      <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
        <div className="grid gap-10 lg:grid-cols-3">
          {/* Left: details */}
          <div className="lg:col-span-2 space-y-8">
            {/* Quick info */}
            <div className="grid gap-4 sm:grid-cols-2">
              <InfoBox label="Date" value={formatDate(event.date)} />
              <InfoBox label="Time" value={`Doors ${event.doors} · Show ${event.time}`} />
              <InfoBox label="Venue" value={event.venue} />
              <InfoBox label="Location" value={`${event.city}, ${event.country}`} />
            </div>

            {/* Description */}
            <section>
              <h2 className="text-xl font-bold">About</h2>
              <p className="mt-3 leading-relaxed text-text-secondary">{event.description}</p>
            </section>

            {/* Lineup */}
            <section>
              <h2 className="text-xl font-bold">Lineup</h2>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                {event.artists.map((artist) => (
                  <div
                    key={artist.name}
                    className="flex items-center gap-3 rounded-xl border border-border-subtle bg-bg-card p-3"
                  >
                    <div
                      className="flex h-10 w-10 items-center justify-center rounded-full text-lg"
                      style={{
                        background: `linear-gradient(135deg, ${event.imageGradient[0]}40, ${event.imageGradient[1]}40)`,
                      }}
                    >
                      {event.emoji}
                    </div>
                    <div>
                      <p className="font-semibold text-text">{artist.name}</p>
                      {artist.role && (
                        <p className="text-xs text-text-muted">{artist.role}</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </section>

            {/* Queue info banner */}
            {queueEnabled && !event.soldOut && (
              <section className="rounded-xl border border-accent/20 bg-accent/5 p-5">
                <h3 className="font-semibold text-accent">Virtual Queue Active</h3>
                <p className="mt-1 text-sm text-text-secondary">
                  Due to high demand, this event uses our virtual queue system. When you click
                  &quot;Buy Tickets&quot;, you&apos;ll be placed in a fair first-come, first-served queue.
                  Once it&apos;s your turn, you&apos;ll have a time-limited window to complete your purchase.
                </p>
              </section>
            )}
          </div>

          {/* Right: ticket selector */}
          <div>
            <div className="sticky top-20">
              <TicketSelector
                tiers={event.ticketTiers}
                eventSlug={event.slug}
                queueEnabled={queueEnabled}
                soldOut={event.soldOut}
              />

              {lowestAvailable && (
                <p className="mt-4 text-center text-xs text-text-muted">
                  Starting from {formatPrice(lowestAvailable.price, lowestAvailable.currency)}
                </p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function InfoBox({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border-subtle bg-bg-card p-4">
      <p className="text-xs font-medium uppercase tracking-wider text-text-muted">{label}</p>
      <p className="mt-1 font-semibold text-text">{value}</p>
    </div>
  );
}
