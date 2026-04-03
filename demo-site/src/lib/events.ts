// ============================================================
// Mock event data for the music ticket demo site
// ============================================================

export interface TicketTier {
  id: string;
  name: string;
  price: number;
  currency: string;
  description: string;
  available: number;
  maxPerOrder: number;
}

export interface Artist {
  name: string;
  role?: string;
}

export interface MusicEvent {
  slug: string;
  title: string;
  tagline: string;
  description: string;
  date: string;        // ISO date
  time: string;        // e.g. "20:00"
  doors: string;       // e.g. "18:30"
  venue: string;
  city: string;
  country: string;
  category: "concert" | "festival" | "dj-set" | "live-session";
  artists: Artist[];
  ticketTiers: TicketTier[];
  imageGradient: [string, string]; // CSS gradient colors (no real images needed)
  emoji: string;                   // visual stand-in for artwork
  featured: boolean;
  soldOut: boolean;
  /** Queue system enabled for this event's checkout */
  queueEnabled: boolean;
}

export const EVENTS: MusicEvent[] = [
  {
    slug: "neon-nights-2026",
    title: "Neon Nights 2026",
    tagline: "The ultimate electronic music experience",
    description:
      "Three stages, 40+ artists, and the most immersive production in Southeast Asia. From deep house to hard techno, Neon Nights delivers an unforgettable night under the stars. VIP guests get access to the rooftop lounge with panoramic views.",
    date: "2026-06-15",
    time: "20:00",
    doors: "18:00",
    venue: "Saigon Exhibition Center",
    city: "Ho Chi Minh City",
    country: "Vietnam",
    category: "festival",
    artists: [
      { name: "DJ Shadow", role: "Headliner" },
      { name: "Bonobo", role: "Main Stage" },
      { name: "Peggy Gou", role: "Main Stage" },
      { name: "Bicep", role: "Stage 2" },
      { name: "Four Tet", role: "Stage 2" },
      { name: "Local Heroes", role: "Stage 3" },
    ],
    ticketTiers: [
      {
        id: "nn-ga",
        name: "General Admission",
        price: 850000,
        currency: "VND",
        description: "Access to all 3 stages",
        available: 2000,
        maxPerOrder: 4,
      },
      {
        id: "nn-vip",
        name: "VIP",
        price: 2500000,
        currency: "VND",
        description: "VIP lounge + fast-track entry + complimentary drinks",
        available: 200,
        maxPerOrder: 2,
      },
      {
        id: "nn-vvip",
        name: "VVIP Table",
        price: 15000000,
        currency: "VND",
        description: "Private table for 6, dedicated server, backstage meet & greet",
        available: 20,
        maxPerOrder: 1,
      },
    ],
    imageGradient: ["#6366f1", "#a855f7"],
    emoji: "🎆",
    featured: true,
    soldOut: false,
    queueEnabled: true,
  },
  {
    slug: "acoustic-garden",
    title: "Acoustic Garden",
    tagline: "Stripped-back. Soulful. Intimate.",
    description:
      "An afternoon of acoustic performances in the lush gardens of the Continental Hotel. Bring a blanket, sip craft cocktails, and let the music carry you. Limited to 300 guests for an exclusive experience.",
    date: "2026-05-03",
    time: "15:00",
    doors: "14:00",
    venue: "Continental Hotel Gardens",
    city: "Ho Chi Minh City",
    country: "Vietnam",
    category: "live-session",
    artists: [
      { name: "Thao Trang", role: "Headliner" },
      { name: "An Tran Duo", role: "Opening" },
      { name: "The Saigon Strings", role: "Special Guest" },
    ],
    ticketTiers: [
      {
        id: "ag-standard",
        name: "Garden Pass",
        price: 450000,
        currency: "VND",
        description: "Lawn seating with picnic area",
        available: 250,
        maxPerOrder: 4,
      },
      {
        id: "ag-premium",
        name: "Front Row",
        price: 900000,
        currency: "VND",
        description: "Reserved seating in first 3 rows + welcome drink",
        available: 50,
        maxPerOrder: 2,
      },
    ],
    imageGradient: ["#059669", "#34d399"],
    emoji: "🌿",
    featured: false,
    soldOut: false,
    queueEnabled: false,
  },
  {
    slug: "bassline-warehouse",
    title: "Bassline Warehouse",
    tagline: "Underground bass music all night long",
    description:
      "Raw concrete, massive sound systems, and the heaviest bass this side of the Mekong. Drum & bass, dubstep, and UKG from midnight till sunrise. Not for the faint-hearted.",
    date: "2026-07-20",
    time: "23:00",
    doors: "22:00",
    venue: "District 4 Warehouse",
    city: "Ho Chi Minh City",
    country: "Vietnam",
    category: "dj-set",
    artists: [
      { name: "Sub Focus", role: "Headliner" },
      { name: "Dimension", role: "Special Guest" },
      { name: "Saigon Bass Collective", role: "Residents" },
    ],
    ticketTiers: [
      {
        id: "bw-early",
        name: "Early Bird",
        price: 350000,
        currency: "VND",
        description: "Limited early bird pricing",
        available: 0,
        maxPerOrder: 2,
      },
      {
        id: "bw-standard",
        name: "Standard",
        price: 500000,
        currency: "VND",
        description: "General admission",
        available: 800,
        maxPerOrder: 4,
      },
    ],
    imageGradient: ["#dc2626", "#f97316"],
    emoji: "🔊",
    featured: true,
    soldOut: false,
    queueEnabled: true,
  },
  {
    slug: "jazz-on-the-rooftop",
    title: "Jazz on the Rooftop",
    tagline: "Smooth jazz with Saigon skyline views",
    description:
      "Every Friday evening, join us 32 floors up for world-class jazz against the glittering Saigon skyline. A rotating lineup of international and Vietnamese jazz artists. Smart casual dress code.",
    date: "2026-04-25",
    time: "19:30",
    doors: "19:00",
    venue: "Skybar Saigon",
    city: "Ho Chi Minh City",
    country: "Vietnam",
    category: "live-session",
    artists: [
      { name: "Quynh Anh Quartet", role: "Resident" },
      { name: "Marcus Miller", role: "Special Guest" },
    ],
    ticketTiers: [
      {
        id: "jr-standard",
        name: "Standing",
        price: 600000,
        currency: "VND",
        description: "Bar access + standing area",
        available: 100,
        maxPerOrder: 4,
      },
      {
        id: "jr-table",
        name: "Table for Two",
        price: 2000000,
        currency: "VND",
        description: "Reserved table + bottle of wine",
        available: 15,
        maxPerOrder: 1,
      },
    ],
    imageGradient: ["#7c3aed", "#2563eb"],
    emoji: "🎷",
    featured: false,
    soldOut: false,
    queueEnabled: false,
  },
  {
    slug: "saigon-symphony-night",
    title: "Saigon Symphony Night",
    tagline: "A cinematic orchestral experience",
    description:
      "The Saigon Philharmonic Orchestra performs iconic film scores from Hans Zimmer, John Williams, and Ennio Morricone. Full orchestra, choir, and immersive surround sound in the historic Opera House.",
    date: "2026-08-10",
    time: "19:00",
    doors: "18:00",
    venue: "Saigon Opera House",
    city: "Ho Chi Minh City",
    country: "Vietnam",
    category: "concert",
    artists: [
      { name: "Saigon Philharmonic Orchestra" },
      { name: "Maestro Nguyen Van Anh", role: "Conductor" },
      { name: "Linh Chi", role: "Soprano" },
    ],
    ticketTiers: [
      {
        id: "ssn-balcony",
        name: "Balcony",
        price: 500000,
        currency: "VND",
        description: "Upper balcony seating",
        available: 300,
        maxPerOrder: 6,
      },
      {
        id: "ssn-orchestra",
        name: "Orchestra",
        price: 1200000,
        currency: "VND",
        description: "Ground floor orchestra seating",
        available: 150,
        maxPerOrder: 4,
      },
      {
        id: "ssn-box",
        name: "Private Box",
        price: 8000000,
        currency: "VND",
        description: "Private box for 4 guests + champagne service",
        available: 8,
        maxPerOrder: 1,
      },
    ],
    imageGradient: ["#b91c1c", "#991b1b"],
    emoji: "🎻",
    featured: true,
    soldOut: false,
    queueEnabled: true,
  },
  {
    slug: "sunrise-beach-party",
    title: "Sunrise Beach Party",
    tagline: "Dance from dusk to dawn on the sand",
    description:
      "Vung Tau's most iconic beach party is back. Two stages on the sand, fire dancers, sunrise yoga, and a lineup that spans deep house, Afrobeat, and balearic. Bus shuttles included from HCMC.",
    date: "2026-09-05",
    time: "16:00",
    doors: "15:00",
    venue: "Back Beach",
    city: "Vung Tau",
    country: "Vietnam",
    category: "festival",
    artists: [
      { name: "Black Coffee", role: "Headliner" },
      { name: "Disclosure", role: "Main Stage" },
      { name: "Channel Tres", role: "Beach Stage" },
      { name: "Saigon Selectors", role: "Residents" },
    ],
    ticketTiers: [
      {
        id: "sbp-ga",
        name: "Beach Pass",
        price: 750000,
        currency: "VND",
        description: "Full event access + shuttle bus",
        available: 1500,
        maxPerOrder: 4,
      },
      {
        id: "sbp-glamping",
        name: "Glamping Package",
        price: 3500000,
        currency: "VND",
        description: "Beach pass + luxury tent + breakfast + shower access",
        available: 50,
        maxPerOrder: 2,
      },
    ],
    imageGradient: ["#ea580c", "#fbbf24"],
    emoji: "🏖️",
    featured: false,
    soldOut: false,
    queueEnabled: true,
  },
  {
    slug: "retro-vinyl-night",
    title: "Retro Vinyl Night",
    tagline: "All vinyl. All night. No requests.",
    description:
      "A celebration of analog sound. DJs spin exclusively on vinyl — funk, soul, disco, and rare grooves. The warmest sound system in District 1, powered by vintage McIntosh amplifiers.",
    date: "2026-05-17",
    time: "21:00",
    doors: "20:00",
    venue: "The Vinyl Room",
    city: "Ho Chi Minh City",
    country: "Vietnam",
    category: "dj-set",
    artists: [
      { name: "DJ Krush", role: "Headliner" },
      { name: "The Crate Diggers", role: "Residents" },
    ],
    ticketTiers: [
      {
        id: "rvn-standard",
        name: "Door Ticket",
        price: 300000,
        currency: "VND",
        description: "General admission",
        available: 150,
        maxPerOrder: 4,
      },
    ],
    imageGradient: ["#854d0e", "#ca8a04"],
    emoji: "💿",
    featured: false,
    soldOut: true,
    queueEnabled: false,
  },
  {
    slug: "k-wave-live-2026",
    title: "K-Wave Live 2026",
    tagline: "K-Pop's biggest stars live in Saigon",
    description:
      "The first major K-Pop concert in Ho Chi Minh City. Three chart-topping acts, full production, fan zones, merch booths, and a lightstick ocean. This is the one fans have been waiting for.",
    date: "2026-10-12",
    time: "18:00",
    doors: "16:00",
    venue: "Phu Tho Stadium",
    city: "Ho Chi Minh City",
    country: "Vietnam",
    category: "concert",
    artists: [
      { name: "ATEEZ", role: "Headliner" },
      { name: "IVE", role: "Special Guest" },
      { name: "NewJeans", role: "Special Guest" },
    ],
    ticketTiers: [
      {
        id: "kw-standing",
        name: "Standing Zone",
        price: 1500000,
        currency: "VND",
        description: "Standing area in front of stage",
        available: 3000,
        maxPerOrder: 2,
      },
      {
        id: "kw-seated",
        name: "Seated",
        price: 2000000,
        currency: "VND",
        description: "Reserved numbered seat",
        available: 5000,
        maxPerOrder: 4,
      },
      {
        id: "kw-vip",
        name: "VIP Standing",
        price: 4500000,
        currency: "VND",
        description: "Front pit + early entry + exclusive merch pack",
        available: 500,
        maxPerOrder: 2,
      },
    ],
    imageGradient: ["#db2777", "#9333ea"],
    emoji: "💜",
    featured: true,
    soldOut: false,
    queueEnabled: true,
  },
];

export function getEventBySlug(slug: string): MusicEvent | undefined {
  return EVENTS.find((e) => e.slug === slug);
}

export function getFeaturedEvents(): MusicEvent[] {
  return EVENTS.filter((e) => e.featured);
}

export function getEventsByCategory(category: MusicEvent["category"]): MusicEvent[] {
  return EVENTS.filter((e) => e.category === category);
}

export function formatPrice(price: number, currency: string): string {
  if (currency === "VND") {
    return new Intl.NumberFormat("vi-VN").format(price) + "đ";
  }
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(price);
}

export function formatDate(dateStr: string): string {
  return new Date(dateStr + "T00:00:00").toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

export const CATEGORIES: { value: MusicEvent["category"]; label: string }[] = [
  { value: "concert", label: "Concerts" },
  { value: "festival", label: "Festivals" },
  { value: "dj-set", label: "DJ Sets" },
  { value: "live-session", label: "Live Sessions" },
];
