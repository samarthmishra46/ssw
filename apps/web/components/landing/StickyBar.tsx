"use client";

import { useEffect, useState } from "react";

/** Hides while the booking section is on screen, so it never covers the ticks or the pay button. */
export function StickyBar() {
  const [off, setOff] = useState(false);
  useEffect(() => {
    const target = document.getElementById("book");
    if (!target || !("IntersectionObserver" in window)) return;
    const io = new IntersectionObserver((es) => setOff(es[0]?.isIntersecting ?? false), { threshold: 0.05 });
    io.observe(target);
    return () => io.disconnect();
  }, []);
  return (
    <div className={`bar${off ? " off" : ""}`}>
      <div className="wrap">
        <span>Nadi Pariksha consultation</span>
        <a href="#book">Book now</a>
      </div>
    </div>
  );
}
