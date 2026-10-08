import type { Metadata } from "next";
import { Playfair_Display, JetBrains_Mono, Geist } from "next/font/google";
import "./globals.css";

const playfair = Playfair_Display({
  variable: "--font-serif",
  subsets: ["latin"],
  style: ["normal", "italic"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
});

const geistSans = Geist({
  variable: "--font-sans",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "PROVENANCE — Research you can click and trust",
  description:
    "Autonomous AI Research Team turning research topics into structured, resource-backed, verified papers.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${playfair.variable} ${jetbrainsMono.variable} ${geistSans.variable}`}
        suppressHydrationWarning
      >
        {children}
      </body>
    </html>
  );
}
