import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";


const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "CarePulse — Telehealth appointments",
    template: "%s · CarePulse",
  },
  description:
    "Book appointments, run consultations and keep patient records in sync with one shared clinical schedule.",
  manifest: "/manifest.json",
};

export const viewport: Viewport = {
  themeColor: "#E6E9E6",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased scroll-smooth`}
    >
      <body className="min-h-full flex flex-col bg-primary-bg">
        {children}
      </body>
    </html>
  );
}
