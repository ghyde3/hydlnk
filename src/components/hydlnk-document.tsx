import "@/app/globals.css";
import { Geist_Mono, Public_Sans } from "next/font/google";
import type { ReactNode } from "react";

const publicSans = Public_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-public-sans",
  display: "swap",
});

const geistMono = Geist_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-geist-mono",
  display: "swap",
});

/**
 * <html> and <body> for the HYDLNK product UI: the marketing site and the editor app. Each of
 * those route groups has its own root layout that renders this. Tenant pages do not: they have
 * a separate root layout, so they ship none of the HYDLNK CSS or fonts.
 */
export function HydlnkDocument({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${publicSans.variable} ${geistMono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
