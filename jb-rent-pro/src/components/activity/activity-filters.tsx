"use client";
import Link from "next/link";
import { Filter } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SelectField, TextField } from "@/components/ui/field";
import { useI18n } from "@/lib/i18n/provider";
import type { ActivityFilters } from "@/lib/activity/utils";

/** Filtros por GET: a URL guarda o estado e a página é renderizada no servidor. */
export function ActivityFiltersForm({
  filters,
  users,
  entities,
  actions,
}: {
  filters: ActivityFilters;
  users: Array<{ id: string; name: string }>;
  entities: string[];
  actions: string[];
}) {
  const { t } = useI18n();
  const a = t.activity;
  const entityLabel = (e: string) => (a.entities as Record<string, string>)[e] ?? e;
  const actionLabel = (x: string) => (a.actions as Record<string, string>)[x] ?? x;

  return (
    <form method="get" action="/activity" className="grid gap-3 rounded-lg border border-border bg-surface/60 p-4 sm:grid-cols-2 lg:grid-cols-6 lg:items-end">
      {users.length > 0 && (
        <SelectField
          label={a.user}
          name="user"
          defaultValue={filters.userId ?? ""}
          className="lg:col-span-1"
          options={[{ value: "", label: t.common.all }, ...users.map((u) => ({ value: u.id, label: u.name }))]}
        />
      )}
      <SelectField
        label={a.entity}
        name="entity"
        defaultValue={filters.entity ?? ""}
        options={[{ value: "", label: t.common.all }, ...entities.map((e) => ({ value: e, label: entityLabel(e) }))]}
      />
      <SelectField
        label={a.action}
        name="action"
        defaultValue={filters.action ?? ""}
        options={[{ value: "", label: t.common.all }, ...actions.map((x) => ({ value: x, label: actionLabel(x) }))]}
      />
      <TextField label={t.common.from} name="from" type="date" defaultValue={filters.from ?? ""} />
      <TextField label={t.common.to} name="to" type="date" defaultValue={filters.to ?? ""} />
      <div className="flex gap-2 sm:col-span-2 lg:col-span-1">
        <Button type="submit" className="flex-1">
          <Filter /> {t.common.filter}
        </Button>
        <Button asChild variant="ghost">
          <Link href="/activity">{t.common.clear}</Link>
        </Button>
      </div>
    </form>
  );
}
