import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Toaster } from "sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "TurnoYa — Fila virtual y turnos para salas de espera",
    template: "%s · TurnoYa",
  },
  description:
    "Reemplaza la cola física por una fila virtual: el cliente escanea un QR, recibe su turno y un aviso por WhatsApp cuando falta poco. Pantalla TV en tiempo real y panel de ventanillas.",
  applicationName: "TurnoYa",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "TurnoYa", statusBarStyle: "default" },
  icons: { icon: "/icon.svg", apple: "/icon.svg" },
};

export const viewport: Viewport = {
  themeColor: "#0f766e",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="es" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">
        <TooltipProvider>{children}</TooltipProvider>
        <Toaster richColors position="top-center" closeButton />
      </body>
    </html>
  );
}
