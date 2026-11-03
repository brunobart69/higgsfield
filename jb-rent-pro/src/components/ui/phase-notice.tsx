import { Lock } from "lucide-react";

/** Aba de módulo ainda não liberado: informa a fase em vez de mostrar um botão sem função. */
export function PhaseNotice({ text }: { text: string }) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-dashed border-border px-5 py-8 text-sm text-muted">
      <Lock className="size-4 shrink-0 text-subtle" aria-hidden />
      {text}
    </div>
  );
}
