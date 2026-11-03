import { cn } from "@/lib/utils";

/** Lista de rótulo/valor para fichas (veículo, cliente). Valores vazios aparecem como "—". */
export function InfoGrid({ items, className }: { items: Array<{ label: string; value: React.ReactNode; wide?: boolean }>; className?: string }) {
  return (
    <dl className={cn("grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3 lg:grid-cols-4", className)}>
      {items.map((i) => (
        <div key={i.label} className={cn("min-w-0", i.wide && "col-span-2 sm:col-span-3 lg:col-span-4")}>
          <dt className="text-xs text-subtle">{i.label}</dt>
          <dd className="mt-1 break-words text-sm">{i.value === null || i.value === undefined || i.value === "" ? "—" : i.value}</dd>
        </div>
      ))}
    </dl>
  );
}
