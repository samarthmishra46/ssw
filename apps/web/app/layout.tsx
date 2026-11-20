import type { Metadata, Viewport } from "next";
import { Merriweather, Montserrat, Neuton } from "next/font/google";
import { Tracking } from "@/components/Tracking";
import "./globals.css";

// Self-hosted at build time by next/font: no request to Google at runtime, no layout shift.
const merriweather = Merriweather({ subsets: ["latin"], weight: ["400"], variable: "--font-merriweather", display: "swap" });
const montserrat = Montserrat({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-montserrat", display: "swap" });
const neuton = Neuton({ subsets: ["latin"], weight: ["300", "400"], style: ["normal", "italic"], variable: "--font-neuton", display: "swap" });

export const metadata: Metadata = {
  metadataBase: new URL(process.env.SITE_URL ?? "http://localhost:3000"),
  title: "Sri Sri Wellbeing · Book a Nadi Pariksha consultation",
  description: "Book a Nadi Pariksha consultation with our Ayurveda doctors.",
  robots: process.env.ALLOW_INDEXING === "1" ? undefined : { index: false, follow: false },
};

export const viewport: Viewport = { themeColor: "#FDFAF5", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-IN" className={`${merriweather.variable} ${montserrat.variable} ${neuton.variable}`}>
      <body>
        {children}
        <Tracking />
      </body>
    </html>
  );
}
