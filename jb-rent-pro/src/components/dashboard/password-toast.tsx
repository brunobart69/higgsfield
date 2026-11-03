"use client";
import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n/provider";

export function PasswordUpdatedToast() {
  const { t } = useI18n();
  const router = useRouter();
  const pathname = usePathname();
  useEffect(() => {
    toast.success(t.auth.passwordUpdated);
    router.replace(pathname, { scroll: false });
  }, [t, router, pathname]);
  return null;
}
