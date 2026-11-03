"use client";
import { useState } from "react";
import { DocumentUploader } from "@/components/files/document-uploader";
import { SelectField, TextAreaField } from "@/components/ui/field";
import { useI18n } from "@/lib/i18n/provider";
import { DOCUMENT_CATEGORIES } from "@/lib/validation/documents";
import { registerDocumentAction } from "@/app/(app)/documents/actions";

type Opt = { value: string; label: string };

/** Envio pela central: o usuário escolhe o vínculo (empresa, veículo ou contrato). */
export function CenterUploader({ companyId, vehicles, rentals }: { companyId: string; vehicles: Opt[]; rentals: Opt[] }) {
  const { t } = useI18n();
  const d = t.docsCenter;
  const [link, setLink] = useState<"none" | "vehicle" | "rental">("none");
  return (
    <DocumentUploader
      buttonLabel={d.upload}
      title={d.upload}
      hint={d.hint}
      companyId={companyId}
      entity="company"
      entityId="general"
      folder="documents"
      categoryLabel={d.category}
      categories={DOCUMENT_CATEGORIES.map((c) => ({ value: c, label: d.categories[c] }))}
      defaultCategory="other"
      showIssued
      resolveTarget={(fd) => {
        const v = String(fd.get("link_vehicle") ?? "");
        const r = String(fd.get("link_rental") ?? "");
        if (link === "vehicle" && v) return { entity: "vehicles", entityId: v, folder: "documents" };
        if (link === "rental" && r) return { entity: "rentals", entityId: r, folder: "documents" };
        return { entity: "company", entityId: "general", folder: "documents" };
      }}
      extraFields={
        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField
            label={d.linkTo}
            name="link"
            value={link}
            onChange={(e) => setLink(e.target.value as typeof link)}
            options={(["none", "vehicle", "rental"] as const).map((k) => ({ value: k, label: d.links[k] }))}
          />
          {link === "vehicle" && <SelectField label={d.vehicle} name="link_vehicle" required options={vehicles} />}
          {link === "rental" && <SelectField label={d.rental} name="link_rental" required options={rentals} />}
          <TextAreaField label={d.notes} name="notes" rows={2} optionalLabel={t.common.optional} className="sm:col-span-2" />
        </div>
      }
      register={(path, file, meta) =>
        registerDocumentAction({
          path,
          category: meta.category,
          title: meta.title,
          mime_type: file.mime,
          size_bytes: file.size,
          vehicle_id: link === "vehicle" ? String(meta.form.get("link_vehicle") ?? "") : null,
          rental_id: link === "rental" ? String(meta.form.get("link_rental") ?? "") : null,
          insurance_policy_id: null,
          issued_at: meta.issued_at,
          expires_at: meta.expires_at,
          notes: String(meta.form.get("notes") ?? ""),
        })
      }
    />
  );
}
