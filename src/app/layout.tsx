import type { Metadata } from "next";
// Self-hosted fonts (no request to Google; keeps the CSP to 'self').
import "@fontsource-variable/archivo";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "@fontsource/ibm-plex-mono/600.css";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Debtors · Precision Thermal", template: "%s · Precision Thermal Debtors" },
  description: "Aged debtors for DND Insulation and Gippsland Insulation.",
  robots: { index: false, follow: false, nocache: true },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en-AU">
      <body>{children}</body>
    </html>
  );
}
