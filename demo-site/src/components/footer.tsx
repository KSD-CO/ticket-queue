import Link from "next/link";

export function Footer() {
  return (
    <footer className="border-t border-border-subtle bg-bg">
      <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
        <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <span className="text-xl font-bold gradient-text bg-gradient-to-r from-purple-400 to-pink-500">
              VIBE
            </span>
            <p className="mt-3 text-sm text-text-muted">
              Discover and buy tickets for the hottest music events in Vietnam.
            </p>
          </div>

          <div>
            <h3 className="text-sm font-semibold uppercase tracking-wider text-text-secondary">
              Events
            </h3>
            <ul className="mt-3 space-y-2">
              <li>
                <Link href="/events?category=concert" className="text-sm text-text-muted hover:text-text">
                  Concerts
                </Link>
              </li>
              <li>
                <Link href="/events?category=festival" className="text-sm text-text-muted hover:text-text">
                  Festivals
                </Link>
              </li>
              <li>
                <Link href="/events?category=dj-set" className="text-sm text-text-muted hover:text-text">
                  DJ Sets
                </Link>
              </li>
              <li>
                <Link href="/events?category=live-session" className="text-sm text-text-muted hover:text-text">
                  Live Sessions
                </Link>
              </li>
            </ul>
          </div>

          <div>
            <h3 className="text-sm font-semibold uppercase tracking-wider text-text-secondary">
              Support
            </h3>
            <ul className="mt-3 space-y-2">
              <li><span className="text-sm text-text-muted">FAQ</span></li>
              <li><span className="text-sm text-text-muted">Contact Us</span></li>
              <li><span className="text-sm text-text-muted">Refund Policy</span></li>
            </ul>
          </div>

          <div>
            <h3 className="text-sm font-semibold uppercase tracking-wider text-text-secondary">
              Legal
            </h3>
            <ul className="mt-3 space-y-2">
              <li><span className="text-sm text-text-muted">Terms of Service</span></li>
              <li><span className="text-sm text-text-muted">Privacy Policy</span></li>
            </ul>
          </div>
        </div>

        <div className="mt-10 border-t border-border-subtle pt-6 text-center">
          <p className="text-xs text-text-muted">
            &copy; 2026 VIBE. Demo site for the ticket queue system. All events are fictional.
          </p>
        </div>
      </div>
    </footer>
  );
}
