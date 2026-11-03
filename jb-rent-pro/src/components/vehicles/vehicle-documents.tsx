"use client";
import { FileText } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { DocumentUploader } from "@/components/files/document-uploader";
import { DocumentList, type DocRow } from "@/components/files/document-list";
import { useI18n } from "@/lib/i18n/provider";
import { VEHICLE_DOC_CATEGORIES } from "@/lib/vehicles/constants";
import { archiveVehicleDocumentAction, registerVehicleDocumentAction } from "@/app/(app)/vehicles/actions";

export function VehicleDocuments({
  vehicleId,
  companyId,
  docs,
  today,
  readOnly,
}: {
  vehicleId: string;
  companyId: string;
  docs: DocRow[];
  today: string;
  readOnly: boolean;
}) {
  const { t } = useI18n();
  const d = t.vehicles.docs;
  return (
    <div className="space-y-4">
      {!readOnly && (
        <div className="flex justify-end">
          <DocumentUploader
            buttonLabel={d.add}
            title={d.add}
            hint={d.hint}
            companyId={companyId}
            entity="vehicles"
            entityId={vehicleId}
            folder="documents"
            categoryLabel={d.category}
            categories={VEHICLE_DOC_CATEGORIES.map((c) => ({ value: c, label: d.categories[c] }))}
            showIssued
            register={(path, file, meta) =>
              registerVehicleDocumentAction({
                vehicle_id: vehicleId,
                path,
                category: meta.category,
                title: meta.title,
                mime_type: file.mime,
                size_bytes: file.size,
                issued_at: meta.issued_at,
                expires_at: meta.expires_at,
              })
            }
          />
        </div>
      )}
      {docs.length === 0 ? (
        <EmptyState icon={FileText} title={d.empty} />
      ) : (
        <DocumentList rows={docs} kind="vehicle-doc" today={today} onArchive={readOnly ? undefined : archiveVehicleDocumentAction} />
      )}
    </div>
  );
}
