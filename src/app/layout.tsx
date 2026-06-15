import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-sans" });

export const metadata: Metadata = {
  title: "LedgerLens — Trial Balance to UltraTax",
  description:
    "Upload a client trial balance, auto-assign US tax codes (Form 8825 / Schedule L / Schedule E) with a rule engine + AI fallback, review, and export a single-sheet UltraTax CS import file. Built for CPAs and bookkeepers.",
  applicationName: "LedgerLens",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${inter.variable} font-sans antialiased`}>
        {children}
      </body>
    </html>
  );
}
