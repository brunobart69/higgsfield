"use client";
import * as React from "react";
import { Label } from "./label";
import { Input } from "./input";
import { Textarea } from "./textarea";
import { NativeSelect } from "./native-select";
import { cn } from "@/lib/utils";

type Common = { label: string; name: string; error?: string; hint?: string; className?: string; optionalLabel?: string };

function Wrapper({
  id,
  label,
  error,
  hint,
  className,
  optionalLabel,
  children,
}: Omit<Common, "name"> & { id: string; children: React.ReactNode }) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <Label htmlFor={id}>
        {label}
        {optionalLabel && <span className="ml-1 font-normal text-subtle">({optionalLabel})</span>}
      </Label>
      {children}
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

function aria(id: string, error?: string, hint?: string) {
  const d = [error ? `${id}-err` : null, hint && !error ? `${id}-hint` : null].filter(Boolean).join(" ");
  return { "aria-invalid": error ? true : undefined, "aria-describedby": d || undefined } as const;
}

export function TextField({ label, name, error, hint, className, optionalLabel, ...props }: Common & React.InputHTMLAttributes<HTMLInputElement>) {
  const id = React.useId();
  return (
    <Wrapper id={id} label={label} error={error} hint={hint} className={className} optionalLabel={optionalLabel}>
      <Input id={id} name={name} {...aria(id, error, hint)} {...props} />
    </Wrapper>
  );
}

export function TextAreaField({ label, name, error, hint, className, optionalLabel, ...props }: Common & React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const id = React.useId();
  return (
    <Wrapper id={id} label={label} error={error} hint={hint} className={className} optionalLabel={optionalLabel}>
      <Textarea id={id} name={name} {...aria(id, error, hint)} {...props} />
    </Wrapper>
  );
}

export function SelectField({
  label,
  name,
  error,
  hint,
  className,
  optionalLabel,
  options,
  ...props
}: Common & React.SelectHTMLAttributes<HTMLSelectElement> & { options: Array<{ value: string; label: string }> }) {
  const id = React.useId();
  return (
    <Wrapper id={id} label={label} error={error} hint={hint} className={className} optionalLabel={optionalLabel}>
      <NativeSelect id={id} name={name} {...aria(id, error, hint)} {...props}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </NativeSelect>
    </Wrapper>
  );
}
