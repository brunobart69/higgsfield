"use client";
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ImagePlus, Star, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { NativeSelect } from "@/components/ui/native-select";
import { useI18n } from "@/lib/i18n/provider";
import { interpolate } from "@/lib/i18n/config";
import { errorText } from "@/lib/i18n/errors";
import { compressImage, discardUpload, uploadToStorage } from "@/lib/files/client";
import { PHOTO_TYPES } from "@/lib/files/constants";
import { buildStoragePath, extFor } from "@/lib/files/sniff";
import { PHOTO_KINDS, type PhotoKind } from "@/lib/vehicles/constants";
import type { VehiclePhoto } from "@/lib/vehicles/queries";
import { deletePhotoAction, registerVehiclePhotoAction, setMainPhotoAction } from "@/app/(app)/vehicles/actions";

export function PhotoGallery({ photos, vehicleId, companyId, readOnly = false }: { photos: VehiclePhoto[]; vehicleId: string; companyId: string; readOnly?: boolean }) {
  const { t } = useI18n();
  const ph = t.vehicles.photos;
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [kind, setKind] = useState<PhotoKind>(photos.some((p) => p.kind === "main") ? "exterior" : "main");
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [viewing, setViewing] = useState<VehiclePhoto | null>(null);
  const [removing, setRemoving] = useState<VehiclePhoto | null>(null);
  const [pending, startTransition] = useTransition();

  async function onFiles(files: FileList | null) {
    if (!files?.length) return;
    const list = Array.from(files).filter((f) => (PHOTO_TYPES as readonly string[]).includes(f.type));
    let ok = 0;
    setProgress({ done: 0, total: list.length });
    for (const [i, file] of list.entries()) {
      // apenas a primeira foto do lote pode ser a principal
      const k: PhotoKind = kind === "main" && i > 0 ? "exterior" : kind;
      const blob = await compressImage(file);
      const mime = blob.type === "image/png" ? "image/png" : "image/jpeg";
      const path = buildStoragePath(companyId, "vehicles", vehicleId, "photos", extFor(mime));
      const up = await uploadToStorage(path, blob, mime);
      if (!up.ok) {
        toast.error(errorText(t, up.error, { max: "15 MB" }));
      } else {
        const res = await registerVehiclePhotoAction({ vehicle_id: vehicleId, path, kind: k, mime_type: mime, size_bytes: blob.size });
        if (res.ok) ok++;
        else {
          await discardUpload(path);
          toast.error(errorText(t, res.error, { max: "15 MB" }));
        }
      }
      setProgress({ done: i + 1, total: list.length });
    }
    setProgress(null);
    if (inputRef.current) inputRef.current.value = "";
    if (ok) {
      toast.success(interpolate(ph.uploaded, { n: ok }));
      if (kind === "main") setKind("exterior");
      router.refresh();
    }
  }

  function act(fn: () => Promise<{ ok?: boolean; error?: string }>, success?: string) {
    startTransition(async () => {
      const res = await fn();
      if (res.ok) {
        if (success) toast.success(success);
        router.refresh();
      } else toast.error(errorText(t, res.error));
      setRemoving(null);
      setViewing(null);
    });
  }

  // principal primeiro (em destaque), depois externas, internas e detalhes
  const ordered = [...photos].sort((a, b) => PHOTO_KINDS.indexOf(a.kind as PhotoKind) - PHOTO_KINDS.indexOf(b.kind as PhotoKind));

  return (
    <div className="space-y-4">
      {!readOnly && (
        <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface-2/50 p-3 sm:flex-row sm:items-center">
          <label className="flex items-center gap-2 text-xs text-muted sm:w-64">
            <span className="shrink-0">{ph.kind}</span>
            <NativeSelect value={kind} onChange={(e) => setKind(e.target.value as PhotoKind)} className="h-10" aria-label={ph.kind}>
              {PHOTO_KINDS.map((k) => (
                <option key={k} value={k}>
                  {ph.kinds[k]}
                </option>
              ))}
            </NativeSelect>
          </label>
          <input
            ref={inputRef}
            type="file"
            accept="image/jpeg,image/png"
            multiple
            className="sr-only"
            id={`photos-${vehicleId}`}
            onChange={(e) => onFiles(e.target.files)}
          />
          <Button type="button" onClick={() => inputRef.current?.click()} loading={progress !== null} className="sm:ml-auto">
            {progress ? `${progress.done}/${progress.total}` : (
              <>
                <ImagePlus /> {ph.add}
              </>
            )}
          </Button>
          <p className="text-xs text-subtle sm:hidden">{ph.hint}</p>
        </div>
      )}

      {photos.length === 0 ? (
        <EmptyState icon={ImagePlus} title={ph.empty} />
      ) : (
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
          {ordered.map((p) => (
            <li key={p.id} className={p.kind === "main" ? "col-span-2 row-span-2" : undefined}>
              <button
                type="button"
                onClick={() => setViewing(p)}
                className="group relative block h-full min-h-28 w-full overflow-hidden rounded-md border border-border bg-surface-2 focus-visible:border-gold"
                aria-label={`${ph.kinds[p.kind as PhotoKind]} ${p.caption ?? ""}`}
              >
                {p.url && (
                  // eslint-disable-next-line @next/next/no-img-element -- URL assinada temporária
                  <img src={p.url} alt="" loading="lazy" className="absolute inset-0 h-full w-full object-cover transition group-hover:scale-[1.03]" />
                )}
                <span className="absolute left-2 top-2">
                  <Badge variant={p.kind === "main" ? "default" : "neutral"} className="bg-background/80 backdrop-blur">
                    {p.kind === "main" && <Star className="size-3" />} {ph.kinds[p.kind as PhotoKind]}
                  </Badge>
                </span>
                <span className="block aspect-[4/3]" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}
      {!readOnly && <p className="hidden text-xs text-subtle sm:block">{ph.hint}</p>}

      {viewing && (
        <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 flex flex-col bg-black/95 p-3 pb-safe" onClick={() => setViewing(null)}>
          <div className="flex items-center justify-end gap-2" onClick={(e) => e.stopPropagation()}>
            {!readOnly && viewing.kind !== "main" && (
              <Button variant="secondary" size="sm" onClick={() => act(() => setMainPhotoAction(viewing.id))} loading={pending}>
                <Star /> {ph.makeMain}
              </Button>
            )}
            {!readOnly && (
              <Button variant="danger" size="sm" onClick={() => setRemoving(viewing)} disabled={pending}>
                <Trash2 /> {t.common.remove}
              </Button>
            )}
            <Button variant="ghost" size="icon" onClick={() => setViewing(null)} aria-label={t.common.close}>
              <X />
            </Button>
          </div>
          <div className="flex min-h-0 flex-1 items-center justify-center p-2">
            {viewing.url && (
              // eslint-disable-next-line @next/next/no-img-element -- URL assinada temporária
              <img src={viewing.url} alt="" className="max-h-full max-w-full rounded-md object-contain" onClick={(e) => e.stopPropagation()} />
            )}
          </div>
        </div>
      )}
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(v) => !v && setRemoving(null)}
        title={ph.confirmRemove}
        destructive
        confirmLabel={t.common.remove}
        pending={pending}
        onConfirm={() => removing && act(() => deletePhotoAction(removing.id), ph.removed)}
      />
    </div>
  );
}
