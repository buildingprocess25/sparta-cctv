import type { Metadata } from "next";
import { JetBrains_Mono, Plus_Jakarta_Sans } from "next/font/google";
import { Toaster } from "sonner";
import "./globals.css";

const plusJakartaSans = Plus_Jakarta_Sans({
  variable: "--font-plus-jakarta-sans",
  subsets: ["latin"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "SPARTA CCTV Monitoring",
  description: "Monitoring kamera CCTV toko Alfamart dalam pembangunan",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="id"
      className={`${plusJakartaSans.variable} ${jetbrainsMono.variable} h-full`}
    >
      <body className="min-h-full">
        {children}
        <Toaster position="bottom-center" />
      </body>
    </html>
  );
}
