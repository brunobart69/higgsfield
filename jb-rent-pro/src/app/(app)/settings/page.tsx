import type { Metadata } from "next";
import { getI18n } from "@/lib/i18n/server";
import { getSession } from "@/lib/auth/session";
import { getCompanySettings, getLogoUrl, listFees } from "@/lib/settings/queries";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { TabsNav } from "@/components/ui/tabs-nav";
import { Forbidden } from "@/components/layout/forbidden";
import { CompanyForm, ContractForm, DefaultsForm, FiscalForm } from "@/components/settings/settings-forms";
import { FeesManager } from "@/components/settings/fees-manager";
import { LogoForm } from "@/components/settings/logo-form";

const TABS = ["company", "fiscal", "defaults", "contract", "fees", "branding"] as const;
type Tab = (typeof TABS)[number];

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t.settings.title };
}

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const [{ t }, session, params] = await Promise.all([getI18n(), getSession(), searchParams]);
  if (session.status !== "ok" || session.profile.role !== "owner") return <Forbidden message={t.errors.forbidden} />;

  const tab: Tab = (TABS as readonly string[]).includes(params.tab ?? "") ? (params.tab as Tab) : "company";
  const company = await getCompanySettings();
  if (!company) return <Forbidden message={t.errors.loadFailed} />;

  const [fees, logoUrl] = await Promise.all([
    tab === "fees" ? listFees() : Promise.resolve([]),
    tab === "branding" ? getLogoUrl(company.logo_path) : Promise.resolve(null),
  ]);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageHeader eyebrow={t.nav.groups.admin} title={t.settings.title} description={t.settings.subtitle} />
      <TabsNav active={tab} tabs={TABS.map((k) => ({ key: k, label: t.settings.tabs[k], href: `/settings?tab=${k}` }))} />
      <Card>
        <CardContent className="p-5 sm:p-6">
          {tab === "company" && <CompanyForm c={company} />}
          {tab === "fiscal" && <FiscalForm c={company} />}
          {tab === "defaults" && <DefaultsForm c={company} />}
          {tab === "contract" && <ContractForm c={company} />}
          {tab === "fees" && <FeesManager fees={fees} />}
          {tab === "branding" && <LogoForm logoUrl={logoUrl} />}
        </CardContent>
      </Card>
    </div>
  );
}
