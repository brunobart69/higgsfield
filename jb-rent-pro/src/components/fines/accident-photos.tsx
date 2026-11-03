"use client";
import { useState } from "react";
import { useI18n } from "@/lib/i18n/provider";
import { AreaPhotos, PhotoViewer, type Thumb } from "@/components/inspections/area-photos";
import { deleteAccidentPhotoAction, registerAccidentPhotoAction } from "@/app/(app)/fines/actions";

export function AccidentPhotos({ accidentId, vehicleId, companyId, photos }: { accidentId: string; vehicleId: string; companyId: string; photos: Thumb[] }) {
  const { t } = useI18n();
  const [viewer, setViewer] = useState<string | null>(null);
  return (
    <>
      <AreaPhotos
        photos={photos}
        companyId={companyId}
        vehicleId={vehicleId}
        folder={`accidents/${accidentId}`}
        register={(path, size) => registerAccidentPhotoAction({ accident_id: accidentId, path, size_bytes: size })}
        remove={deleteAccidentPhotoAction}
        label={t.accidents.photos}
        onOpen={setViewer}
      />
      <PhotoViewer url={viewer} onClose={() => setViewer(null)} closeLabel={t.common.close} />
    </>
  );
}
