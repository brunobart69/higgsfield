import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { getI18n } from "@/lib/i18n/server";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { CustomerForm } from "@/components/customers/customer-form";
import { createCustomerAction } from "../actions";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t.customers.new };
}

export default async function NewCustomerPage() {
  const { t } = await getI18n();
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <Link href="/customers" className="inline-flex items-center gap-2 text-sm text-muted hover:text-foreground">
        <ArrowLeft className="size-4" /> {t.customers.title}
      </Link>
      <PageHeader eyebrow={t.nav.groups.operations} title={t.customers.new} />
      <Card>
        <CardContent className="p-5 sm:p-6">
          <CustomerForm action={createCustomerAction} />
        </CardContent>
      </Card>
    </div>
  );
}
