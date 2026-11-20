"use client";

/** "Book for my parent / daughter": preselects who the consultation is for and scrolls to the form. */
export function AsideButton({ pick, label }: { pick: string; label: string }) {
  return (
    <a
      className="btn"
      href="#book"
      onClick={() => window.dispatchEvent(new CustomEvent("ssw:pick-who", { detail: pick }))}
    >
      {label}
    </a>
  );
}
