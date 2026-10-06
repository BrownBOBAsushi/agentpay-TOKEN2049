import type { Metadata } from "next";
import type { ReactNode } from "react";
import localFont from "next/font/local";
import "./globals.css";

const legends = localFont({ src: "./fonts/MarcellusSC-Regular.ttf", variable: "--font-legends", display: "swap" });
const prose = localFont({ src: [
  { path: "./fonts/SchibstedGrotesk-VF.ttf", weight: "400 900", style: "normal" },
  { path: "./fonts/SchibstedGrotesk-Italic-VF.ttf", weight: "400 900", style: "italic" },
], variable: "--font-prose", display: "swap" });
const values = localFont({ src: "./fonts/OCRB-10.otf", variable: "--font-values", display: "swap" });

export const metadata: Metadata = {
  title: "AgentPay Guard",
  description: "A Guard Check compares an agent's Spend Proposal with a human-signed Mandate. Cardano preprod · test funds only.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${legends.variable} ${prose.variable} ${values.variable}`}>
      <body>{children}</body>
    </html>
  );
}
