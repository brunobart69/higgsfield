"use client";
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Camera, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n/provider";
import { errorText } from "@/lib/i18n/errors";
import { interpolate } from "@/lib/i18n/config";
import { uploadImages } from "@/lib/files/client";
import { buildStoragePath, extFor } from "@/lib/files/sniff";
import type { FormState } from "@/lib/auth/validation";

export type Thumb = { id: string; url: string | null };

/**
 * Fotos de uma área/avaria: abre a câmera no celular (capture), envia direto
 * ao Storage e registra. Miniaturas com remoção (quando permitido).
 */
export function AreaPhotos({
  photos,
  companyId,
  vehicleId,
  folder,
  register,
  remove,
  readOnly,
  label,
  onOpen,
}: {
  photos: Thumb[];
  companyId: string;
  vehicleId: string;
  folder: string;
  register: (path: string, size: number) => Promise<FormState>;
  remove?: (id: string) => Promise<FormState>;
  readOnly?: boolean;
  label: string;
  onOpen?: (url: string) => void;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  async function onFiles(files: FileList | null) {
    if (!files?.length) return;
    setBusy("0");
    const res = await uploadImages(
      Array.from(files),
      (mime) => buildStoragePath(companyId, "vehicles", vehicleId, folder, extFor(mime)),
      (path, size) => register(path, size),
      (done, total) => setBusy(`${done}/${total}`),
    );
    setBusy(null);
    if (ref.current) ref.current.value = "";
    res.errors.slice(0, 2).forEach((e) => toast.error(errorText(t, e, { max: "15 MB" })));
    if (res.ok) {
      toast.success(interpolate(t.vehicles.photos.uploaded, { n: res.ok }));
      router.refresh();
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {photos.map((p) => (
        <div key={p.id} className="relative size-16 overflow-hidden rounded-md border border-border bg-surface-3 sm:size-20">
          {p.url && (
            <button type="button" onClick={() => onOpen?.(p.url!)} className="block h-full w-full" aria-label={label}>
              {/* eslint-disable-next-line @next/next/no-img-element -- URL assinada temporária */}
              <img src={p.url} alt="" loading="lazy" className="h-full w-full object-cover" />
            </button>
          )}
          {!readOnly && remove && (
            <button
              type="button"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  const res = await remove(p.id);
                  if (res.ok) router.refresh();
                  else toast.error(errorText(t, res.error));
                })
              }
              className="absolute right-0.5 top-0.5 flex size-6 items-center justify-center rounded-full bg-black/70 text-white"
              aria-label={t.common.remove}
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>
      ))}
      {!readOnly && (
        <>
          <input ref={ref} type="file" accept="image/jpeg,image/png" capture="environment" multiple className="sr-only" onChange={(e) => onFiles(e.target.files)} />
          <button
            type="button"
            onClick={() => ref.current?.click()}
            disabled={busy !== null}
            className="flex size-16 flex-col items-center justify-center gap-0.5 rounded-md border border-dashed border-gold/40 text-[0.62rem] text-gold-light transition hover:bg-gold/10 disabled:opacity-60 sm:size-20"
            aria-label={`${t.inspections.addPhotos}: ${label}`}
          >
            {busy !== null ? <Loader2 className="size-5 animate-spin" /> : <Camera className="size-5" />}
            {busy !== null && busy !== "0" ? busy : t.inspections.addPhotos}
          </button>
        </>
      )}
    </div>
  );
}

/** Visualização em tela cheia de uma foto. */
export function PhotoViewer({ url, onClose, closeLabel }: { url: string | null; onClose: () => void; closeLabel: string }) {
  if (!url) return null;
  return (
    <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 flex flex-col bg-black/95 p-3 pb-safe" onClick={onClose}>
      <div className="flex justify-end">
        <button type="button" onClick={onClose} className="rounded-md p-2 text-white" aria-label={closeLabel}>
          <X className="size-6" />
        </button>
      </div>
      <div className="flex min-h-0 flex-1 items-center justify-center">
        {/* eslint-disable-next-line @next/next/no-img-element -- URL assinada temporária */}
        <img src={url} alt="" className="max-h-full max-w-full rounded-md object-contain" />
      </div>
    </div>
  );
}
