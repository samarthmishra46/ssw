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
  /** I AM Partner Booking API settings (docs/06), used when the calendar runs in I AM mode. */
  iam?: IamCentreSettings;
};

/**
 * Doctors, fees, durations, languages and modes all come from the I AM API. These settings only
 * narrow what this landing page offers.
 */
export type IamCentreSettings = {
  /**
   * I AM centre code. Optional: when unset we use the centre the key can see (GET /centres/),
   * matched by city if it sees several. Env override: IAM_CENTRE_<CODE>, e.g. IAM_CENTRE_AHM.
   */
  centreCode?: string;
  /** Modes this page offers. "offline" = centre visit, "online" = video call in the I AM app (needs email). */
  modes: ("offline" | "online")[];
  expertType: "doctor" | "coach";
  /** Preferred centre-visit length, used when the doctor offers it; otherwise the doctor's shortest. */
  preferredDurationMinutes?: number;
  /** Limit to these I AM expert IDs. Empty = every listed doctor. Env override: IAM_EXPERT_IDS_<CODE> (comma-separated). */
  expertIds?: string[];
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
