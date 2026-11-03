import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { getI18n } from "@/lib/i18n/server";
import { customerName, getCustomer } from "@/lib/customers/queries";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { CustomerForm } from "@/components/customers/customer-form";
import { updateCustomerAction } from "../../actions";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t.customers.edit };
}

export default async function EditCustomerPage({ params }: { params: Promise<{ id: string }> }) {
  const [{ t }, { id }] = await Promise.all([getI18n(), params]);
  const c = await getCustomer(id);
  if (!c || c.anonymized_at) notFound();
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <Link href={`/customers/${id}`} className="inline-flex items-center gap-2 text-sm text-muted hover:text-foreground">
        <ArrowLeft className="size-4" /> {customerName(c)}
      </Link>
      <PageHeader eyebrow={t.nav.groups.operations} title={t.customers.edit} description={customerName(c)} />
      <Card>
        <CardContent className="p-5 sm:p-6">
          <CustomerForm action={updateCustomerAction.bind(null, id)} values={c} lockType />
        </CardContent>
      </Card>
    </div>
  );
}
