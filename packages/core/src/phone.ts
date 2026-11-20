/**
 * Board section 3: normalise every phone to E.164 (+91 and 10 digits).
 * Phone is the only identity used to match or create a contact.
 */
export function normalizeIndianPhone(input: string): string | null {
  const digits = input.replace(/\D/g, "");
  let local: string;
  if (digits.length === 10) local = digits;
  else if (digits.length === 11 && digits.startsWith("0")) local = digits.slice(1);
  else if (digits.length === 12 && digits.startsWith("91")) local = digits.slice(2);
  else return null;
  // Indian mobile numbers start with 6, 7, 8 or 9.
  if (!/^[6-9]\d{9}$/.test(local)) return null;
  return `+91${local}`;
}

export function maskPhone(e164: string): string {
  return e164.length > 6 ? `${e164.slice(0, 3)} ••••• ${e164.slice(-3)}` : e164;
}
