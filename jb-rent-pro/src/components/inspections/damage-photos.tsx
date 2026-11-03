"use client";
import { useState } from "react";
import { useI18n } from "@/lib/i18n/provider";
import { deleteDamagePhotoAction, registerDamagePhotoAction } from "@/app/(app)/inspections/actions";
import { AreaPhotos, PhotoViewer, type Thumb } from "./area-photos";

export function DamagePhotos({ damageId, vehicleId, companyId, photos }: { damageId: string; vehicleId: string; companyId: string; photos: Thumb[] }) {
  const { t } = useI18n();
  const [viewer, setViewer] = useState<string | null>(null);
  return (
    <>
      <AreaPhotos
        photos={photos}
        companyId={companyId}
        vehicleId={vehicleId}
        folder={`damages/${damageId}`}
        register={(path, size) => registerDamagePhotoAction({ damage_id: damageId, path, size_bytes: size })}
        remove={deleteDamagePhotoAction}
        label={t.damages.photos}
        onOpen={setViewer}
      />
      <PhotoViewer url={viewer} onClose={() => setViewer(null)} closeLabel={t.common.close} />
    </>
  );
}
