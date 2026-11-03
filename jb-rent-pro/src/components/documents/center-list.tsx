"use client";
import { DocumentList, type DocRow } from "@/components/files/document-list";
import { useI18n } from "@/lib/i18n/provider";
import { archiveDocumentAction, deleteDocumentAction } from "@/app/(app)/documents/actions";

/** Lista da central: arquivar (empresa/frota) e exclusão definitiva após a retenção (dono). */
export function CenterList({ rows, kind, today, isOwner }: { rows: DocRow[]; kind: "vehicle-doc" | "customer-doc"; today: string; isOwner: boolean }) {
  const { t } = useI18n();
  const canDelete = isOwner && rows.some((r) => r.deletable);
  return (
    <DocumentList
      rows={rows}
      kind={kind}
      today={today}
      onArchive={kind === "vehicle-doc" ? archiveDocumentAction : undefined}
      onDelete={canDelete ? (id) => deleteDocumentAction(id, kind) : undefined}
      confirmDeleteText={t.docsCenter.confirmDelete}
    />
  );
}
