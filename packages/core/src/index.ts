export * from "./phone";
export * from "./stages";
export * from "./lead-rules";
export * from "./links";
export * from "./signatures";
export * from "./time";
export * from "./schedule";
export * from "./consent";
export * from "./schemas";

/** "AHM" + 6 random digits, e.g. AHM-482913. */
export function makeBookingRef(centreCode: string, random: () => number = Math.random): string {
  const n = Math.floor(100000 + random() * 900000);
  return `${centreCode.toUpperCase()}-${n}`;
}
