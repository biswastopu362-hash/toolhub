import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { ThemeProvider } from "@/components/theme-provider";
import { RegisterServiceWorker } from "@/components/pwa/register-sw";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "ToolHub — All-in-One App Hub",
  description:
    "One app for everything you do on your phone, laptop and computer. Calculator, converters, generators, developer tools, notes, weather and more — works offline, on every device.",
  keywords: [
    "toolhub",
    "tools",
    "calculator",
    "converter",
    "PWA",
    "app hub",
    "productivity",
    "utilities",
  ],
  applicationName: "ToolHub",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      { url: "/favicon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "ToolHub",
  },
  formatDetection: {
    telephone: false,
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  viewportFit: "cover",
};

/** Applied before first paint to avoid theme flash (mirrors ThemeProvider). */
const themeInitScript = `(function(){try{var m=localStorage.getItem('toolhub.mode')||'system';var a=localStorage.getItem('toolhub.accent')||'emerald';var d=m==='dark'||m==='amoled'||(m==='system'&&window.matchMedia('(prefers-color-scheme: dark)').matches);var r=document.documentElement;r.classList.toggle('dark',!!d);r.classList.toggle('amoled',m==='amoled');r.dataset.accent=a;r.style.colorScheme=d?'dark':'light';}catch(e){}})()`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning data-accent="emerald">
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground min-h-screen`}
      >
        <ThemeProvider>{children}</ThemeProvider>
        <Toaster />
        <RegisterServiceWorker />
      </body>
    </html>
  );
}
