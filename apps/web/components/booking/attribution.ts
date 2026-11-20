const KEY = "ssw_attr";
const FIELDS = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "fbclid", "gclid"] as const;

function cookie(name: string): string | undefined {
  return document.cookie
    .split("; ")
    .find((c) => c.startsWith(`${name}=`))
    ?.slice(name.length + 1);
}

/**
 * Board 1 / 12: UTM per centre and campaign travels with the lead.
 * First touch is kept for the session in localStorage; the current URL wins if it carries UTMs.
 */
export function captureAttribution(): Record<string, string> {
  let saved: Record<string, string> = {};
  try {
    saved = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Record<string, string>;
  } catch {
    /* storage blocked */
  }
  const url = new URL(window.location.href);
  const fromUrl: Record<string, string> = {};
  for (const f of FIELDS) {
    const v = url.searchParams.get(f);
    if (v) fromUrl[f] = v.slice(0, 200);
  }
  const hasUrl = Object.keys(fromUrl).length > 0;
  const attr: Record<string, string> = hasUrl
    ? { ...fromUrl, landing_url: url.pathname + url.search, referrer: document.referrer.slice(0, 500) }
    : { ...saved };
  if (!attr.landing_url) attr.landing_url = url.pathname;
  if (!attr.referrer && document.referrer) attr.referrer = document.referrer.slice(0, 500);

  const fbp = cookie("_fbp");
  const fbc = cookie("_fbc") ?? (attr.fbclid ? `fb.1.${Date.now()}.${attr.fbclid}` : undefined);
  if (fbp) attr.fbp = fbp;
  if (fbc) attr.fbc = fbc;

  try {
    if (hasUrl || !localStorage.getItem(KEY)) localStorage.setItem(KEY, JSON.stringify(attr));
  } catch {
    /* storage blocked */
  }
  return attr;
}
