"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Archive, Download, Eye, FileImage, FileText, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useI18n } from "@/lib/i18n/provider";
import { errorText } from "@/lib/i18n/errors";
import { formatDate } from "@/lib/format";
import { formatBytes } from "@/lib/files/sniff";
import type { FormState } from "@/lib/auth/validation";

export type DocRow = {
  id: string;
  label: string;
  typeLabel: string;
  mime_type: string;
  size_bytes: number | null;
  expires_at: string | null;
  created_at: string;
};

/** Lista de documentos com abrir/baixar via link temporário e arquivar/excluir com confirmação. */
export function DocumentList({
  rows,
  kind,
  today,
  onArchive,
  onDelete,
  confirmDeleteText,
}: {
  rows: DocRow[];
  kind: "vehicle-doc" | "customer-doc";
  today: string;
  onArchive?: (id: string) => Promise<FormState>;
  onDelete?: (id: string) => Promise<FormState>;
  confirmDeleteText?: string;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [confirm, setConfirm] = useState<{ id: string; mode: "archive" | "delete" } | null>(null);

  function run() {
    if (!confirm) return;
    const fn = confirm.mode === "archive" ? onArchive : onDelete;
    if (!fn) return;
    const id = confirm.id;
    startTransition(async () => {
      const res = await fn(id);
      if (res.ok) {
        toast.success(t.common.saved);
        router.refresh();
      } else toast.error(errorText(t, res.error));
      setConfirm(null);
    });
  }

  return (
    <>
      <ul className="divide-y divide-border rounded-lg border border-border">
        {rows.map((d) => {
          const Icon = d.mime_type === "application/pdf" ? FileText : FileImage;
          const expired = d.expires_at !== null && d.expires_at < today;
          return (
            <li key={d.id} className="flex items-center gap-3 p-3.5 sm:px-4">
              <Icon className="size-5 shrink-0 text-gold" aria-hidden />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="truncate text-sm font-medium">{d.label}</p>
                  {expired && <Badge variant="danger">{t.vehicles.docs.expired}</Badge>}
                </div>
                <p className="truncate text-xs text-muted tabular">
                  {d.typeLabel}
                  {d.expires_at && ` · ${t.vehicles.docs.expires}: ${formatDate(d.expires_at)}`}
                  {d.size_bytes ? ` · ${formatBytes(d.size_bytes)}` : ""}
                  {` · ${formatDate(d.created_at)}`}
                </p>
              </div>
              <a
                href={`/api/files/${kind}/${d.id}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex size-10 items-center justify-center rounded-md text-muted transition hover:bg-surface-2 hover:text-foreground"
                aria-label={`${t.common.view}: ${d.label}`}
              >
                <Eye className="size-4" />
              </a>
              <a
                href={`/api/files/${kind}/${d.id}?download=1`}
                className="hidden size-10 items-center justify-center rounded-md text-muted transition hover:bg-surface-2 hover:text-foreground sm:flex"
                aria-label={`Download: ${d.label}`}
              >
                <Download className="size-4" />
              </a>
              {onArchive && (
                <button
                  type="button"
                  onClick={() => setConfirm({ id: d.id, mode: "archive" })}
                  className="flex size-10 items-center justify-center rounded-md text-muted transition hover:bg-surface-2 hover:text-foreground"
                  aria-label={`${t.common.archive}: ${d.label}`}
                >
                  <Archive className="size-4" />
                </button>
              )}
              {onDelete && (
                <button
                  type="button"
                  onClick={() => setConfirm({ id: d.id, mode: "delete" })}
                  className="flex size-10 items-center justify-center rounded-md text-danger transition hover:bg-danger/10"
                  aria-label={`${t.common.remove}: ${d.label}`}
                >
                  <Trash2 className="size-4" />
                </button>
              )}
            </li>
          );
        })}
      </ul>
      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(v) => !v && setConfirm(null)}
        title={confirm?.mode === "delete" ? (confirmDeleteText ?? t.common.remove) : `${t.common.archive}?`}
        destructive={confirm?.mode === "delete"}
        confirmLabel={confirm?.mode === "delete" ? t.common.remove : t.common.archive}
        pending={pending}
        onConfirm={run}
      />
    </>
  );
}
