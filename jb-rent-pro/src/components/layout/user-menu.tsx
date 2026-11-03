"use client";
import Link from "next/link";
import { KeyRound, LogOut, UserRound } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useI18n } from "@/lib/i18n/provider";
import type { CurrentProfile } from "@/lib/auth/session";

export function initials(name: string | null, email: string) {
  const base = (name ?? email).trim();
  const parts = base.split(/[\s@._-]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "JB";
}

export function UserMenu({ profile }: { profile: CurrentProfile }) {
  const { t } = useI18n();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="flex items-center gap-2 rounded-full p-0.5 pr-0.5 transition hover:bg-surface-2 sm:pr-3"
        aria-label={t.nav.account}
      >
        <span className="flex size-9 items-center justify-center rounded-full bg-gold-gradient text-xs font-semibold text-gold-foreground">
          {initials(profile.fullName, profile.email)}
        </span>
        <span className="hidden text-left leading-tight sm:block">
          <span className="block max-w-[10rem] truncate text-sm font-medium">{profile.fullName ?? profile.email}</span>
          <span className="block text-[0.68rem] text-muted">{t.roles[profile.role]}</span>
        </span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel>
          <span className="block truncate text-foreground">{profile.fullName ?? profile.email}</span>
          <span className="block truncate">{profile.email}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/account">
            <UserRound /> {t.nav.account}
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/account#password">
            <KeyRound /> {t.account.changePassword}
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <form action="/auth/signout" method="post">
          <DropdownMenuItem asChild>
            <button type="submit" className="w-full text-danger">
              <LogOut className="!text-danger" /> {t.auth.signOut}
            </button>
          </DropdownMenuItem>
        </form>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
