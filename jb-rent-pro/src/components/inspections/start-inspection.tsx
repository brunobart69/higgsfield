import { ClipboardCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { startInspectionAction } from "@/app/(app)/inspections/actions";

/** Botão que cria (ou retoma) uma inspeção — formulário simples, funciona sem JavaScript. */
export function StartInspection({
  vehicleId,
  rentalId,
  type,
  label,
  variant = "default",
  size = "default",
}: {
  vehicleId: string;
  rentalId?: string | null;
  type: "delivery" | "return" | "periodic";
  label: string;
  variant?: "default" | "secondary" | "outline";
  size?: "default" | "sm";
}) {
  return (
    <form action={startInspectionAction}>
      <input type="hidden" name="vehicle_id" value={vehicleId} />
      <input type="hidden" name="rental_id" value={rentalId ?? ""} />
      <input type="hidden" name="inspection_type" value={type} />
      <Button type="submit" variant={variant} size={size}>
        <ClipboardCheck /> {label}
      </Button>
    </form>
  );
}
