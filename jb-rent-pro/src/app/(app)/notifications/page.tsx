import type { Metadata } from "next";
import { getI18n } from "@/lib/i18n/server";
import { listNotifications, listRentalRequests } from "@/lib/notifications/queries";
import { PageHeader } from "@/components/ui/page-header";
import { TabsNav } from "@/components/ui/tabs-nav";
import { NotificationList } from "@/components/notifications/notification-list";
import { RequestList } from "@/components/notifications/request-list";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t.notifications.title };
}

export default async function NotificationsPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const [{ t }, sp] = await Promise.all([getI18n(), searchParams]);
  const view = sp.view === "resolved" ? "resolved" : "open";
  const [rows, requests] = await Promise.all([listNotifications(view), view === "open" ? listRentalRequests() : Promise.resolve([])]);
  const n = t.notifications;
  return (
    <div className="space-y-6">
      <PageHeader eyebrow={t.nav.groups.overview} title={n.title} description={n.subtitle} />
      {requests.length > 0 && (
        <section id="requests" className="space-y-3">
          <h2 className="font-display text-sm font-semibold text-gold-light">{n.requests.title}</h2>
          <RequestList rows={requests} />
        </section>
      )}
      <TabsNav
        active={view}
        tabs={[
          { key: "open", label: n.tabs.open, href: "/notifications" },
          { key: "resolved", label: n.tabs.resolved, href: "/notifications?view=resolved" },
        ]}
      />
      <NotificationList rows={rows} resolved={view === "resolved"} />
      <p className="text-xs text-subtle">{n.hint}</p>
    </div>
  );
}
