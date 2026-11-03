"use client";
import { AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useI18n } from "@/lib/i18n/provider";

export default function DashboardError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const { t } = useI18n();
  return (
    <Card className="border-danger/30">
      <CardContent className="flex flex-col items-start gap-4 p-6 sm:flex-row sm:items-center">
        <AlertCircle className="size-6 text-danger" />
        <p className="flex-1 text-sm">{t.errors.loadFailed}</p>
        <Button variant="secondary" onClick={reset}>
          {t.common.retry}
        </Button>
      </CardContent>
    </Card>
  );
}
