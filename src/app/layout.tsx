import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Motif — Design Systems Canvas",
  description: "A design canvas built for design systems and AI",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1" />
      </head>
      <body>{children}</body>
    </html>
  );
}
