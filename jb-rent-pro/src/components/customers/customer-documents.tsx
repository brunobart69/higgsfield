"use client";
import { FileText, Lock } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { DocumentUploader } from "@/components/files/document-uploader";
import { DocumentList, type DocRow } from "@/components/files/document-list";
import { useI18n } from "@/lib/i18n/provider";
import { CUSTOMER_DOC_TYPES } from "@/lib/customers/constants";
import { deleteCustomerDocumentAction, registerCustomerDocumentAction } from "@/app/(app)/customers/actions";

export function CustomerDocuments({
  customerId,
  companyId,
  docs,
  today,
  canDelete,
  readOnly,
}: {
  customerId: string;
  companyId: string;
  docs: DocRow[];
  today: string;
  canDelete: boolean;
  readOnly: boolean;
}) {
  const { t } = useI18n();
  const d = t.customers.docs;
  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="flex items-start gap-2 text-xs text-muted">
          <Lock className="mt-0.5 size-3.5 shrink-0 text-gold" /> {d.privacy}
        </p>
        {!readOnly && (
          <DocumentUploader
            buttonLabel={d.add}
            title={d.add}
            hint={t.vehicles.docs.hint}
            companyId={companyId}
            entity="customers"
            entityId={customerId}
            folder="documents"
            categoryLabel={d.type}
            categories={CUSTOMER_DOC_TYPES.map((c) => ({ value: c, label: d.types[c] }))}
            register={(path, file, meta) =>
              registerCustomerDocumentAction({
                customer_id: customerId,
                path,
                doc_type: meta.category,
                title: meta.title,
                mime_type: file.mime,
                size_bytes: file.size,
                expires_at: meta.expires_at,
              })
            }
          />
        )}
      </div>
      {docs.length === 0 ? (
        <EmptyState icon={FileText} title={d.empty} />
      ) : (
        <DocumentList
          rows={docs}
          kind="customer-doc"
          today={today}
          onDelete={canDelete ? deleteCustomerDocumentAction : undefined}
          confirmDeleteText={d.confirmRemove}
        />
      )}
    </div>
  );
}
