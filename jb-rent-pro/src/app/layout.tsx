import type { Metadata, Viewport } from "next";
import { Inter, Sora } from "next/font/google";
import { Toaster } from "sonner";
import { getI18n } from "@/lib/i18n/server";
import { I18nProvider } from "@/lib/i18n/provider";
import { ServiceWorkerRegister } from "@/components/pwa/sw-register";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const sora = Sora({ subsets: ["latin"], variable: "--font-display-face", display: "swap", weight: ["500", "600", "700"] });

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return {
    title: { default: t.meta.title, template: `%s · ${t.meta.title}` },
    description: t.meta.description,
    applicationName: "JB RENT PRO",
    appleWebApp: { capable: true, title: "JB RENT PRO", statusBarStyle: "black-translucent" },
    formatDetection: { telephone: false },
    icons: {
      icon: [
        { url: "/icons/icon.svg", type: "image/svg+xml" },
        { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      ],
      apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180" }],
    },
    robots: { index: false, follow: false },
  };
}

export const viewport: Viewport = {
  themeColor: "#09090b",
  colorScheme: "dark",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const { locale, t } = await getI18n();
  return (
    <html lang={locale} className={`${inter.variable} ${sora.variable}`}>
      <body className="min-h-dvh">
        <I18nProvider locale={locale} t={t}>
          {children}
          <Toaster
            theme="dark"
            position="top-center"
            toastOptions={{
              classNames: {
                toast: "!bg-surface-2 !border-border !text-foreground",
                description: "!text-muted",
              },
            }}
          />
        </I18nProvider>
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}
