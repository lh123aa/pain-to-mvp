import type { Metadata } from "next";
import { Source_Sans_3, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";
import "./components.css";
import { Analytics } from "./components/analytics";

/* 字体：Source Sans 3（正文）+ IBM Plex Mono（眉标 / 数字 / 代码），与 landing-v0.html 一致 */
const sourceSans = Source_Sans_3({
  variable: "--font-sans",
  subsets: ["latin"],
  weight: ["400", "600", "700"],
  style: ["normal", "italic"],
});

const plexMono = IBM_Plex_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
});

export const metadata: Metadata = {
  title: {
    default: "The Tell — Every text has a tell.",
    template: "%s — The Tell",
  },
  description:
    "Upload your chat export. Get a private, evidence-based report on attachment patterns, communication health, and what to do next.",
  openGraph: {
    title: "The Tell — Every text has a tell.",
    description:
      "A private, evidence-based relationship report from your chat export.",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className={`${sourceSans.variable} ${plexMono.variable}`}
    >
      <body>
        {children}
        <Analytics />
      </body>
    </html>
  );
}
