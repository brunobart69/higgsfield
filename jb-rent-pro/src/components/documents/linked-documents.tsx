"use client";
import { FileText } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { DocumentUploader } from "@/components/files/document-uploader";
import { DocumentList, type DocRow } from "@/components/files/document-list";
import { useI18n } from "@/lib/i18n/provider";
import { DOCUMENT_CATEGORIES } from "@/lib/validation/documents";
import { archiveDocumentAction, registerDocumentAction } from "@/app/(app)/documents/actions";

type Cat = (typeof DOCUMENT_CATEGORIES)[number];

/**
 * Documentos ligados a uma apólice (pasta do veículo) ou a um contrato
 * (pasta do contrato). O envio de categoria "contrato" marca o contrato como assinado.
 */
export function LinkedDocuments({
  companyId,
  target,
  docs,
  today,
  readOnly,
  categories,
  buttonLabel,
  emptyText,
  successMessage,
}: {
  companyId: string;
  target: { kind: "insurance"; policyId: string; vehicleId: string } | { kind: "rental"; rentalId: string };
  docs: DocRow[];
  today: string;
  readOnly?: boolean;
  categories: Cat[];
  buttonLabel: string;
  emptyText: string;
  successMessage?: string;
}) {
  const { t } = useI18n();
  const d = t.docsCenter;
  const isIns = target.kind === "insurance";
  return (
    <div className="space-y-4">
      {!readOnly && (
        <div className="flex justify-end">
          <DocumentUploader
            buttonLabel={buttonLabel}
            title={buttonLabel}
            hint={d.hint}
            companyId={companyId}
            entity={isIns ? "vehicles" : "rentals"}
            entityId={isIns ? target.vehicleId : target.rentalId}
            folder="documents"
            categoryLabel={d.category}
            categories={categories.map((c) => ({ value: c, label: d.categories[c] }))}
            showIssued
            buttonVariant="secondary"
            successMessage={successMessage}
            register={(path, file, meta) =>
              registerDocumentAction({
                path,
                category: meta.category,
                title: meta.title,
                mime_type: file.mime,
                size_bytes: file.size,
                vehicle_id: isIns ? target.vehicleId : null,
                rental_id: isIns ? null : target.rentalId,
                insurance_policy_id: isIns ? target.policyId : null,
                issued_at: meta.issued_at,
                expires_at: meta.expires_at,
              })
            }
          />
        </div>
      )}
      {docs.length === 0 ? (
        <EmptyState icon={FileText} title={emptyText} />
      ) : (
        <DocumentList rows={docs} kind="vehicle-doc" today={today} onArchive={readOnly ? undefined : archiveDocumentAction} />
      )}
    </div>
  );
}
