/**
 * Content model for centre landing pages.
 * Strings may contain [[...]] to mark text still to be confirmed; it renders with a dashed underline.
 */

export type Centre = {
  slug: string;
  /** Three letters, used in booking references (AHM-123456). */
  code: string;
  name: string;
  shortAddress: string;
  fullAddress: string;
  hours: string;
  receptionPhone: string;
  /** WhatsApp number in international format without +, for wa.me links. */
  whatsappNumber: string;
  mapUrl: string;
  feeInr: number;
  languages: readonly string[];
  /** Slixta user IDs. Overridable per environment with SLIXTA_OWNER_ID_<CODE> / SLIXTA_TELECALLER_ID_<CODE>. */
  slixtaOwnerId: string | null;
  slixtaTelecallerId: string | null;
  calendarService: string;
  /** Booking window shown on the landing page. */
  bookingWindowDays: number;
};

export type Practitioner = {
  name: string;
  title: string;
  languages: string[];
  photo?: string;
  bio: string;
};

export type Proof = { quote: string; who: string };

export type Programme = {
  slug: string;
  concern: string;
  label: string;
  metaTitle: string;
  metaDescription: string;
  head: string;
  sub: string;
  small: string;
  bullets: string[];
  who: string[];
  moment: [string, string];
  momentImage: { src: string; position: string; alt: string };
  steps: [string, string][];
  aside: { heading: string; body: string; button: string; pick: string } | null;
  why: string[];
  faq: [string, string][];
  safety: string;
  showAvailabilityNote: boolean;
  /** Board 2A asks for practitioner and proof on every centre page. Fill these in when the centre provides them. */
  practitioners?: Practitioner[];
  proof?: Proof[];
};
