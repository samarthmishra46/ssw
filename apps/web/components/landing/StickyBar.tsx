"use client";

import { useEffect, useState } from "react";

/**
 * Hides while its target section is on screen, so it never covers the ticks or the pay button.
 * Programme pages point it at the booking card; the centre page at the consultation cards.
 */
export function StickyBar({ target = "book", label = "Nadi Pariksha consultation", cta = "Book now" }: { target?: string; label?: string; cta?: string }) {
  const [off, setOff] = useState(false);
  useEffect(() => {
    const el = document.getElementById(target);
    if (!el || !("IntersectionObserver" in window)) return;
    const io = new IntersectionObserver((es) => setOff(es[0]?.isIntersecting ?? false), { threshold: 0.05 });
    io.observe(el);
    return () => io.disconnect();
  }, [target]);
  return (
    <div className={`bar${off ? " off" : ""}`}>
      <div className="wrap">
        <span>{label}</span>
        <a href={`#${target}`}>{cta}</a>
      </div>
    </div>
  );
}
