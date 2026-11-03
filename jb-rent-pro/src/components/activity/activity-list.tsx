"use client";
import { ChevronDown, LogIn, Pencil, PlusCircle, Send, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useI18n } from "@/lib/i18n/provider";
import { interpolate } from "@/lib/i18n/config";
import { formatDateTime } from "@/lib/format";
import { describeUserAgent, type ActivityEntry } from "@/lib/activity/utils";

const ICONS: Record<string, typeof Pencil> = { insert: PlusCircle, update: Pencil, delete: Trash2, "auth.login": LogIn };
const VARIANT: Record<string, "success" | "info" | "danger" | "neutral" | "default"> = {
  insert: "success",
  update: "info",
  delete: "danger",
  "auth.login": "neutral",
};
const HIDDEN_FIELDS = new Set(["id", "company_id", "created_at", "updated_at", "created_by", "updated_by"]);

function show(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

/** Linhas da tabela de diferenças: update = {campo: {old,new}}; insert/delete = snapshot. */
function diffRows(entry: ActivityEntry): Array<{ field: string; before: string; after: string }> {
  const c = entry.changes;
  if (!c) return [];
  return Object.entries(c)
    .filter(([k]) => !HIDDEN_FIELDS.has(k))
    .map(([field, v]) => {
      if (entry.action === "update" && v && typeof v === "object" && "old" in v && "new" in v) {
        const d = v as { old: unknown; new: unknown };
        return { field, before: show(d.old), after: show(d.new) };
      }
      if (entry.action === "delete") return { field, before: show(v), after: "—" };
      return { field, before: "—", after: show(v) };
    })
    .filter((r) => r.before !== "—" || r.after !== "—");
}

export function ActivityList({ rows, names }: { rows: ActivityEntry[]; names: Record<string, string> }) {
  const { t } = useI18n();
  const a = t.activity;
  const fields = t.settings.fields as Record<string, string>;
  const entityLabel = (e: string) => (a.entities as Record<string, string>)[e] ?? e;
  const actionLabel = (x: string) => (a.actions as Record<string, string>)[x] ?? x;

  return (
    <ul className="divide-y divide-border">
      {rows.map((r) => {
        const Icon = ICONS[r.action] ?? Send;
        const diff = diffRows(r);
        const who = r.userId ? (names[r.userId] ?? r.userId.slice(0, 8)) : a.system;
        return (
          <li key={r.id}>
            <details className="group">
              <summary className="flex cursor-pointer list-none items-start gap-3 px-4 py-3.5 transition hover:bg-surface-2/60 sm:px-5 [&::-webkit-details-marker]:hidden">
                <Icon className="mt-0.5 size-4 shrink-0 text-gold" aria-hidden />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={VARIANT[r.action] ?? "default"}>{actionLabel(r.action)}</Badge>
                    <span className="text-sm font-medium">{entityLabel(r.entity)}</span>
                    {r.action === "update" && diff.length > 0 && (
                      <span className="text-xs text-subtle">{interpolate(a.changedFields, { n: diff.length })}</span>
                    )}
                  </div>
                  <p className="mt-0.5 truncate text-xs text-muted">
                    {who}
                    {r.action === "auth.login" && ` · ${describeUserAgent(r.userAgent)}${r.ip ? ` · ${r.ip}` : ""}`}
                  </p>
                </div>
                <time dateTime={r.createdAt} className="shrink-0 text-xs text-subtle tabular">
                  {formatDateTime(r.createdAt)}
                </time>
                {diff.length > 0 && <ChevronDown className="mt-0.5 size-4 shrink-0 text-subtle transition group-open:rotate-180" aria-hidden />}
              </summary>
              {diff.length > 0 && (
                <div className="scrollbar-thin overflow-x-auto px-4 pb-4 sm:px-5">
                  <table className="w-full min-w-[28rem] text-xs">
                    <thead className="text-subtle">
                      <tr>
                        <th className="py-1.5 pr-3 text-left font-medium">{a.field}</th>
                        <th className="py-1.5 pr-3 text-left font-medium">{a.before}</th>
                        <th className="py-1.5 text-left font-medium">{a.after}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {diff.map((d) => (
                        <tr key={d.field} className="align-top">
                          <td className="py-1.5 pr-3 text-muted">{fields[d.field] ?? d.field}</td>
                          <td className="max-w-[16rem] break-words py-1.5 pr-3 text-danger/90">{d.before}</td>
                          <td className="max-w-[16rem] break-words py-1.5 text-success/90">{d.after}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </details>
          </li>
        );
      })}
    </ul>
  );
}
