import { ShieldAlert } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

export function Forbidden({ message }: { message: string }) {
  return (
    <Card className="mx-auto max-w-lg border-danger/30">
      <CardContent className="flex items-center gap-3 p-6 text-sm">
        <ShieldAlert className="size-5 shrink-0 text-danger" />
        {message}
      </CardContent>
    </Card>
  );
}
