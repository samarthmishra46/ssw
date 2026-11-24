import type { Centre, Programme } from "./types";

export type { Centre, IamCentreSettings, Programme, Practitioner, Proof } from "./types";

// ---------------------------------------------------------------------------
// Centres
// ---------------------------------------------------------------------------

export const centres: Record<string, Centre> = {
  ahmedabad: {
    slug: "ahmedabad",
    code: "AHM",
    name: "Sri Sri Wellbeing Ahmedabad",
    city: "Ahmedabad",
    shortAddress: "Shivranjani Cross Road, Ambawadi",
    fullAddress:
      "Sri Sri Wellbeing Centre, Shivranjani Cross Road, Near Pintu Garment, Ambawadi, Ahmedabad, Gujarat 380015",
    hours: "Open every day, 9:30 am to 6:30 pm",
    receptionPhone: "8511606276",
    // TODO: brand WhatsApp number (connected in Slixta).
    whatsappNumber: "918511606276",
    mapUrl: "https://www.google.com/maps/search/?api=1&query=Sri+Sri+Wellbeing+Shivranjani+Cross+Road+Ambawadi+Ahmedabad",
    feeInr: 500,
    languages: ["Gujarati", "Hindi", "English"],
    slixtaOwnerId: null,
    calendarService: "nadi-pariksha",
    bookingWindowDays: 7,
    // Doctors, fees and slots come from I AM. Code confirmed on the staging key (GET /centres/).
    iam: {
      centreCode: "ssw_ahmedabad",
      modes: ["offline", "online"],
      expertType: "doctor",
      preferredDurationMinutes: 30,
    },
  },
};

export function getCentre(slug: string): Centre | undefined {
  return centres[slug];
}

export function getCentreByCode(code: string): Centre | undefined {
  return Object.values(centres).find((c) => c.code === code.toUpperCase());
}

// ---------------------------------------------------------------------------
// Shared copy
// ---------------------------------------------------------------------------

export const REFUND_POLICY_SHORT =
  "The consultation fee is non-refundable once your booking is confirmed. To change your time, call reception. If a technical problem means you were charged twice, or you paid and we can't offer you a slot, the amount is returned to you.";

const DUR = "[[duration]]";

export const commonFaq: [string, string][] = [
  [
    "What is Nadi Pariksha?",
    "A traditional Ayurvedic pulse reading. Our Ayurveda doctors use it to understand your body's constitution and balance.",
  ],
  ["Do I have to start a treatment that day?", "No. You leave with a plan and decide in your own time."],
  [
    "Should I stop my current medicines?",
    "No. Please continue anything your own doctor has prescribed, and bring the list with you. Any change should be discussed with your physician.",
  ],
  ["What if I need to change my time?", "Call reception on 8511606276 and they'll move your slot."],
  ["Is the fee refundable?", REFUND_POLICY_SHORT],
  [
    "Can Ayurveda help with chronic health issues?",
    "Yes, Ayurveda works well for chronic conditions like joint pain, digestive disorders, hormonal issues, migraine, and stress. Treatments aim at restoring systemic balance over time.",
  ],
  [
    "Is Ayurvedic treatment safe for all age groups?",
    "Yes, treatments are safe and suitable for children, adults, and the elderly. Our doctors design plans based on individual age, condition, and body type.",
  ],
];

export const disclaimer =
  "All services at Sri Sri Wellbeing are provided based on a qualified doctor's assessment and recommendation. Individual experiences vary. These are traditional Ayurvedic wellness services and are not a substitute for medical treatment. For any diagnosed medical condition, please consult your physician.";

export const availabilityNote =
  "Some therapies may not be available at every centre. The therapies offered vary by location. Please check directly with your chosen centre for availability.";

// ---------------------------------------------------------------------------
// Programmes (ported from SSW_Ahmedabad_NadiPariksha_MASTER.html)
// ---------------------------------------------------------------------------

const HOURS = "Open every day, 9:30 am to 6:30 pm";

export const programmes: Record<string, Programme> = {
  joints: {
    slug: "joints",
    concern: "joints",
    label: "Knees · Back · Joints",
    navLabel: "Joints & back",
    summary:
      "Discomfort in your knees, back or joints? The doctor listens to how you sit, walk and work, reads your pulse, and explains a plan in plain words.",
    metaTitle: "Nadi Pariksha for knees, back and joints · Sri Sri Wellbeing Ahmedabad",
    metaDescription:
      "Sit with our Ayurveda doctors about the discomfort in your knees, back or joints. Book a Nadi Pariksha consultation, Ambawadi, Ahmedabad.",
    head: "When the stairs make you stop and think, it's worth a conversation.",
    sub: "Sit with our Ayurveda doctors, who listen first. Talk through the discomfort in your knees, back or joints, and leave with a plan explained in plain words.",
    small: `${HOURS} · Consult in Gujarati, Hindi or English`,
    bullets: [
      "Choose your doctor: their consultation fee is shown before you pay",
      `About ${DUR}, with our Ayurveda doctors`,
      "No pressure to start any treatment",
      "Sri Sri Wellbeing Ahmedabad, Shivranjani Cross Road, Ambawadi",
    ],
    who: ["Myself", "My parent", "Someone else"],
    moment: [
      "Holding the railing before the first step. Getting up from the floor after puja with a hand on one knee. Rubbing balm on the same knee, night after night.",
      "Most people learn to live around it. Our doctors start by listening: how you sit, walk and work, and when the discomfort shows up.",
    ],
    momentImage: {
      src: "/images/moment-joints.jpg",
      position: "55% 40%",
      alt: "A hand resting on a wooden stair railing in morning light",
    },
    steps: [
      ["We listen first.", "The doctor asks about your day, how you sit, walk and work, and when the discomfort shows up."],
      [
        "Nadi Pariksha and a movement check.",
        "A traditional pulse reading, then a look at how your knees, back and joints move. [[(movement check to be confirmed)]]",
      ],
      [
        "Your plan, explained.",
        "What the doctor sees, in plain words, and what to do next: therapies, osteopathy where it fits, food and routine.",
      ],
      ["You decide.", "No pressure to start anything that day."],
    ],
    aside: {
      heading: "Booking for a parent?",
      body: "Many guests are booked by a son or daughter. Book in your name and add your parent's name in the form. Women therapists look after women guests [[(to be confirmed)]].",
      button: "Book for my parent",
      pick: "My parent",
    },
    why: [
      "A legacy of 30+ years in Ayurveda",
      "Every plan starts with a doctor's assessment",
      "Ayurveda and osteopathy under one roof, under a doctor's guidance",
      "Women therapists for women guests [[(to be confirmed)]]",
      "A new bottle of oil opened for every guest [[(to be confirmed)]]",
    ],
    faq: [
      [
        "What happens in the consultation?",
        `The doctor talks with you about your concern and routine, does a Nadi Pariksha (pulse reading), and explains a plan. It takes about ${DUR}.`,
      ],
      ["Can I book for my parent?", "Yes. Choose who the consultation is for in the form."],
    ],
    safety:
      "If your pain is sudden and severe, follows an injury, or comes with fever, numbness, weakness or chest pain, please see a doctor or visit a hospital first.",
    showAvailabilityNote: true,
  },

  sleep: {
    slug: "sleep",
    concern: "sleep",
    label: "Sleep · Stress · Relaxation",
    navLabel: "Sleep & stress",
    summary:
      "Body tired, mind still running? A look at your food, routine and stress, with relaxation therapy if the doctor feels it suits you.",
    metaTitle: "Nadi Pariksha for sleep and stress · Sri Sri Wellbeing Ahmedabad",
    metaDescription:
      "Body tired, mind still running? An unhurried consultation with our Ayurveda doctors and a routine that fits your evenings. Book online, Ambawadi, Ahmedabad.",
    head: "Body tired. Mind still running. Start with an unhurried conversation.",
    sub: "A consultation with our Ayurveda doctors, a routine that fits your evenings, and relaxation therapy if the doctor feels it suits you.",
    small: `${HOURS} · Consult in Gujarati, Hindi or English`,
    bullets: [
      "Choose your doctor: their consultation fee is shown before you pay",
      `About ${DUR}, with our Ayurveda doctors`,
      "Relaxation therapy on the doctor's advice",
      "Sri Sri Wellbeing Ahmedabad, Shivranjani Cross Road, Ambawadi",
    ],
    who: ["Myself", "Someone else"],
    moment: [
      "Lying awake at 2:47 am with tomorrow's list on loop. Reading the same email three times at 11 pm. Days that start tired and end wired.",
      "Rest is what lets you work, parent and think clearly. Our doctors look at sleep the way Ayurveda always has: through your food, your routine and your stress, not just the hours you spend in bed.",
    ],
    momentImage: {
      src: "/images/moment-sleep.jpg",
      position: "40% 60%",
      alt: "A bedside at night with a lamp and tomorrow's to-do list on the bed",
    },
    steps: [
      ["A real conversation.", "When you eat, when the phone goes down, how your days and evenings run."],
      ["Nadi Pariksha.", "A traditional pulse reading to understand your constitution."],
      ["A routine that fits your life.", "Simple changes for the evening and the morning that a busy week can hold."],
      [
        "Relaxation therapy, if it suits you.",
        "Abhyanga (a full-body warm oil massage) or Shirodhara (warm oil poured in a slow stream over the forehead), as the doctor advises. How many sittings suit your body is decided with the doctor.",
      ],
    ],
    aside: null,
    why: [
      "A legacy of 30+ years in Ayurveda",
      "Every plan starts with a doctor's assessment",
      "A routine you can follow on a busy day, not just a list of rules",
      "Women therapists for women guests [[(to be confirmed)]]",
      "A new bottle of oil opened for every guest [[(to be confirmed)]]",
    ],
    faq: [
      [
        "What happens in the consultation?",
        `The doctor talks with you about your sleep, food and routine, does a Nadi Pariksha (pulse reading), and explains a plan. It takes about ${DUR}.`,
      ],
      [
        "Can I have a relaxation therapy on the same visit?",
        "[[As set by the centre.]] The doctor will advise whether Abhyanga or Shirodhara suits you.",
      ],
      [
        "What is Shirodhara?",
        "A traditional therapy in which warm oil is poured in a slow, steady stream over the forehead while you lie down in a quiet room.",
      ],
    ],
    safety:
      "This consultation supports rest and daily routine. It is not a replacement for mental health care. If you are feeling persistently low or finding it hard to cope, please speak to a doctor or a mental health professional.",
    showAvailabilityNote: true,
  },

  women: {
    slug: "women",
    concern: "women",
    label: "Women's wellness",
    navLabel: "Women's wellness",
    summary: "Your food, sleep, stress and routine, looked at together in one private, unhurried consultation with our Ayurveda doctors.",
    metaTitle: "Women's wellness consultation · Sri Sri Wellbeing Ahmedabad",
    metaDescription:
      "One unhurried conversation with our Ayurveda doctors about your food, sleep, stress and routine. Private Nadi Pariksha consultation, Ahmedabad.",
    head: "Ten tabs open, ten different answers. One unhurried conversation with our Ayurveda doctors.",
    sub: "A private consultation. Your food, sleep, stress and routine, looked at together.",
    small: `Women therapists for women guests [[(to be confirmed)]] · ${HOURS} · Gujarati, Hindi or English`,
    bullets: [
      "Choose your doctor: their consultation fee is shown before you pay",
      `About ${DUR}, with our Ayurveda doctors`,
      "Private, unhurried, no pressure",
      "Sri Sri Wellbeing Ahmedabad, Shivranjani Cross Road, Ambawadi",
    ],
    who: ["Myself", "My daughter", "Someone else"],
    moment: [
      "Late-night searches. One site says eat this, the next says never. Skipped breakfasts, late nights, and a body that feels tired in a way that's hard to explain.",
      "You deserve one clear conversation instead of ten conflicting ones.",
    ],
    momentImage: {
      src: "/images/moment-women.jpg",
      position: "55% 50%",
      alt: "Hands holding a phone in bed late at night beside a cup of herbal tea",
    },
    steps: [
      ["Time to talk.", "The doctor listens to how your days, meals and sleep really go."],
      ["Nadi Pariksha.", "A traditional pulse reading to understand your constitution (prakriti)."],
      [
        "A plan built around your day.",
        "Food, routine and rest guidance you can actually follow, and therapies if the doctor recommends them.",
      ],
      [
        "In private.",
        "Your consultation takes place in private [[(to be confirmed)]], and your details are handled as set out in our Privacy Policy.",
      ],
    ],
    aside: {
      heading: "Booking for your daughter?",
      body: "Book in your name and add hers in the form. If she is 18 or older, she can see the doctor on her own if she prefers, and you're welcome to wait with us. If she is under 18, a parent or guardian stays with her throughout the consultation.",
      button: "Book for my daughter",
      pick: "My daughter",
    },
    why: [
      "A legacy of 30+ years in Ayurveda",
      "Every plan starts with a doctor's assessment",
      "Private, unhurried consultations",
      "Women therapists for women guests [[(to be confirmed)]]",
      "A plan built around your day, not someone else's",
    ],
    faq: [
      [
        "Will I see a woman doctor?",
        "[[Answer to be confirmed by the centre.]] Tell us your preference on WhatsApp or when reception calls, and we'll do our best to arrange it.",
      ],
      [
        "What happens in the consultation?",
        `The doctor talks with you about your food, sleep, stress and routine, does a Nadi Pariksha (pulse reading), and explains a plan. It takes about ${DUR}.`,
      ],
      ["Can someone come with me?", "Yes. Family can sit in with you or wait with us, as you prefer."],
    ],
    safety:
      "This consultation focuses on lifestyle, food and routine through Ayurveda, and is not a replacement for gynaecological care. Please continue any treatment your own doctor has prescribed.",
    showAvailabilityNote: false,
  },
};

/** Which programmes each centre offers. */
export const centreProgrammes: Record<string, string[]> = {
  ahmedabad: ["joints", "sleep", "women"],
};

export function getProgramme(slug: string): Programme | undefined {
  return programmes[slug];
}

/** Programmes offered at a centre, in display order. */
export function programmesFor(centreSlug: string): Programme[] {
  return (centreProgrammes[centreSlug] ?? []).map((slug) => programmes[slug]).filter((p): p is Programme => !!p);
}

/** Where unknown addresses are sent until other cities have pages. */
export const DEFAULT_CENTRE = "ahmedabad";

/** Copy for a centre's own page (/ahmedabad), which links to its programme pages. */
export const centreHub = {
  tag: "Ayurveda consultations",
  head: (city: string) => `Ayurveda doctors who listen first, in ${city}.`,
  sub: "Choose what's on your mind. Every consultation starts with a conversation and a Nadi Pariksha (pulse reading), and ends with a plan explained in plain words.",
  concernsHeading: "What would you like to talk about?",
  steps: [
    ["We listen first.", "The doctor asks about your concern, your day and your routine."],
    ["Nadi Pariksha.", "A traditional pulse reading, at the heart of an Ayurvedic assessment."],
    ["Your plan, explained.", "What the doctor sees, in plain words, and what to do next."],
    ["You decide.", "No pressure to start anything that day."],
  ] as [string, string][],
  why: [
    "A legacy of 30+ years in Ayurveda",
    "Every plan starts with a doctor's assessment",
    "Choose your doctor and see their fee before you pay",
    "Consult in Gujarati, Hindi or English",
  ],
};

export function allCentres(): { centre: string }[] {
  return Object.keys(centreProgrammes).map((centre) => ({ centre }));
}

export function allLandingPages(): { centre: string; programme: string }[] {
  return Object.entries(centreProgrammes).flatMap(([centre, list]) => list.map((programme) => ({ centre, programme })));
}

export const shared = {
  hero: {
    src: "/images/hero.jpg",
    alt: "Nadi Pariksha: an Ayurvedic doctor's fingertips reading the pulse at a guest's wrist",
    position: "50% 45%",
    positionMobile: "72% 0%",
  },
  journeyImage: "/images/journey.jpg",
  whyImage: "/images/why.jpg",
  company:
    "Sri Sri Wellbeing is operated by Sriveda Sattva Private Limited. [[Registered office and company details to be added.]]",
};
