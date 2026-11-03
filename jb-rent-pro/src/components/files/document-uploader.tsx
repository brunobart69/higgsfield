"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { SelectField, TextField } from "@/components/ui/field";
import { FormAlert } from "@/components/ui/form-alert";
import { Label } from "@/components/ui/label";
import { useI18n } from "@/lib/i18n/provider";
import { errorText } from "@/lib/i18n/errors";
import { interpolate } from "@/lib/i18n/config";
import { compressImage, discardUpload, uploadToStorage } from "@/lib/files/client";
import { DOCUMENT_TYPES, MAX_FILE_BYTES } from "@/lib/files/constants";
import { buildStoragePath, extFor } from "@/lib/files/sniff";
import type { FormState } from "@/lib/auth/validation";

export type DocumentMeta = { category: string; title: string; issued_at?: string; expires_at?: string; form: FormData };
type Entity = "vehicles" | "customers" | "rentals" | "company";

/**
 * Envio de documento: o arquivo vai direto do navegador ao Storage privado
 * (sem passar pelo servidor, evitando o limite de 4,5 MB das funções da Vercel);
 * em seguida o servidor confere o conteúdo e registra os metadados.
 */
export function DocumentUploader({
  buttonLabel,
  title,
  hint,
  companyId,
  entity,
  entityId,
  folder,
  categoryLabel,
  categories,
  showIssued = false,
  register,
  extraFields,
  resolveTarget,
  successMessage,
  buttonVariant,
  defaultCategory,
}: {
  buttonLabel: string;
  title: string;
  hint: string;
  companyId: string;
  entity: Entity;
  entityId: string;
  folder: string;
  categoryLabel: string;
  categories: Array<{ value: string; label: string }>;
  showIssued?: boolean;
  register: (path: string, file: { mime: string; size: number }, meta: DocumentMeta) => Promise<FormState>;
  /** Campos adicionais do formulário (ex.: vínculo com veículo/contrato). */
  extraFields?: React.ReactNode;
  /** Define a pasta de destino a partir do formulário (quando o vínculo é escolhido pelo usuário). */
  resolveTarget?: (fd: FormData) => { entity: Entity; entityId: string; folder: string };
  successMessage?: string;
  buttonVariant?: "default" | "secondary";
  defaultCategory?: string;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [state, setState] = useState<FormState>({});
  const [category, setCategory] = useState(defaultCategory ?? categories[0]?.value ?? "other");
  const [docTitle, setDocTitle] = useState(categories.find((c) => c.value === (defaultCategory ?? categories[0]?.value))?.label ?? "");
  const [titleTouched, setTitleTouched] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const fe = state.fieldErrors ?? {};

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const file = fileRef.current?.files?.[0];
    if (!file) return setState({ fieldErrors: { file: "required" } });
    if (!(DOCUMENT_TYPES as readonly string[]).includes(file.type)) return setState({ fieldErrors: { file: "fileType" } });

    setBusy(true);
    setState({});
    const body = file.type.startsWith("image/") ? await compressImage(file) : file;
    const mime = body.type || file.type;
    if (body.size > MAX_FILE_BYTES) {
      setBusy(false);
      return setState({ fieldErrors: { file: "fileTooLarge" }, vars: { max: "15 MB" } });
    }
    const target = resolveTarget ? resolveTarget(fd) : { entity, entityId, folder };
    const path = buildStoragePath(companyId, target.entity, target.entityId, target.folder, extFor(mime));
    const up = await uploadToStorage(path, body, mime);
    if (!up.ok) {
      setBusy(false);
      return setState({ error: up.error, vars: { max: "15 MB" } });
    }
    const res = await register(path, { mime, size: body.size }, {
      category: String(fd.get("category") ?? category),
      title: String(fd.get("title") ?? ""),
      issued_at: String(fd.get("issued_at") ?? "") || undefined,
      expires_at: String(fd.get("expires_at") ?? "") || undefined,
      form: fd,
    });
    setBusy(false);
    if (!res.ok) {
      await discardUpload(path);
      return setState(res);
    }
    toast.success(successMessage ?? t.vehicles.docs.uploaded);
    setOpen(false);
    router.refresh();
  }

  return (
    <>
      <Button variant={buttonVariant} onClick={() => { setState({}); setOpen(true); }}>
        <Upload /> {buttonLabel}
      </Button>
      <Dialog open={open} onOpenChange={(v) => !busy && setOpen(v)}>
        <DialogContent title={title} description={hint} closeLabel={t.common.close}>
          <form onSubmit={submit} className="space-y-4" noValidate>
            <FormAlert message={errorText(t, state.error, state.vars)} />
            <SelectField
              label={categoryLabel}
              name="category"
              value={category}
              onChange={(e) => {
                setCategory(e.target.value);
                if (!titleTouched) setDocTitle(categories.find((c) => c.value === e.target.value)?.label ?? "");
              }}
              options={categories}
            />
            <TextField
              label={t.vehicles.docs.docTitle}
              name="title"
              value={docTitle}
              onChange={(e) => { setDocTitle(e.target.value); setTitleTouched(true); }}
              required
              error={errorText(t, fe.title)}
            />
            <div className="grid grid-cols-2 gap-4">
              {showIssued && <TextField label={t.vehicles.docs.issued} name="issued_at" type="date" optionalLabel={t.common.optional} error={errorText(t, fe.issued_at)} />}
              <TextField label={t.vehicles.docs.expires} name="expires_at" type="date" optionalLabel={t.common.optional} error={errorText(t, fe.expires_at)} />
            </div>
            {extraFields}
            <div className="space-y-1.5">
              <Label htmlFor="doc-file">{t.files.choose}</Label>
              <input
                ref={fileRef}
                id="doc-file"
                type="file"
                accept="application/pdf,image/jpeg,image/png"
                aria-invalid={fe.file ? true : undefined}
                className="block w-full cursor-pointer rounded-md border border-border bg-surface-2 text-sm text-muted file:mr-3 file:h-11 file:cursor-pointer file:border-0 file:bg-surface-3 file:px-4 file:text-foreground"
              />
              {fe.file && (
                <p role="alert" className="text-xs text-danger">
                  {interpolate(errorText(t, fe.file) ?? "", { max: "15 MB" })}
                </p>
              )}
            </div>
            <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end">
              <Button type="button" variant="secondary" onClick={() => setOpen(false)} disabled={busy}>
                {t.common.cancel}
              </Button>
              <Button type="submit" loading={busy}>
                {busy ? t.common.uploading : t.common.upload}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
