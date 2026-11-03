"use client";
import * as React from "react";
import { Eye, EyeOff } from "lucide-react";
import { Input } from "./input";
import { Label } from "./label";
import { cn } from "@/lib/utils";

type Props = React.InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  name: string;
  error?: string;
  hint?: string;
  revealLabels?: { show: string; hide: string };
};

/** Campo com rótulo, mensagem de erro acessível e (opcional) botão mostrar/ocultar senha. */
export function FormField({ label, name, error, hint, revealLabels, type, className, ...props }: Props) {
  const id = React.useId();
  const [reveal, setReveal] = React.useState(false);
  const describedBy = [error ? `${id}-err` : null, hint ? `${id}-hint` : null].filter(Boolean).join(" ") || undefined;
  const isPassword = type === "password";
  return (
    <div className={cn("space-y-1.5", className)}>
      <Label htmlFor={id}>{label}</Label>
      <div className="relative">
        <Input
          id={id}
          name={name}
          type={isPassword && reveal ? "text" : type}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={isPassword ? "pr-11" : undefined}
          {...props}
        />
        {isPassword && revealLabels && (
          <button
            type="button"
            onClick={() => setReveal((v) => !v)}
            className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-subtle transition hover:text-foreground"
            aria-label={reveal ? revealLabels.hide : revealLabels.show}
            aria-pressed={reveal}
          >
            {reveal ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          </button>
        )}
      </div>
      {hint && !error && (
        <p id={`${id}-hint`} className="text-xs text-subtle">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-err`} role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
