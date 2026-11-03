import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

/** Paginação por URL (?page=), compatível com Server Components. */
export function Pagination({
  page,
  totalPages,
  hrefFor,
  labels,
}: {
  page: number;
  totalPages: number;
  hrefFor: (page: number) => string;
  labels: { previous: string; next: string; page: string };
}) {
  if (totalPages <= 1) return null;
  const btn = "inline-flex h-9 items-center gap-1 rounded-md border border-border bg-surface-2 px-3 text-xs transition hover:border-border-strong";
  const disabled = "pointer-events-none opacity-40";
  return (
    <nav className="flex items-center justify-between gap-3 pt-4" aria-label="pagination">
      <Link href={hrefFor(page - 1)} className={cn(btn, page <= 1 && disabled)} aria-disabled={page <= 1}>
        <ChevronLeft className="size-4" /> {labels.previous}
      </Link>
      <span className="text-xs text-muted tabular">{labels.page}</span>
      <Link href={hrefFor(page + 1)} className={cn(btn, page >= totalPages && disabled)} aria-disabled={page >= totalPages}>
        {labels.next} <ChevronRight className="size-4" />
      </Link>
    </nav>
  );
}
