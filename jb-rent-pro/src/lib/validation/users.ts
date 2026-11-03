import { z } from "zod";
import { emailSchema } from "@/lib/auth/validation";
import { optionalPhone } from "./common";

export const inviteSchema = z.object({
  email: emailSchema.transform((v) => v.toLowerCase()),
  full_name: z.string().trim().min(2, "required").max(120, "tooLong"),
  role: z.enum(["owner", "admin"]),
});

export const roleSchema = z.object({
  user_id: z.uuid("invalid"),
  role: z.enum(["owner", "admin"]),
});

export const userIdSchema = z.object({ user_id: z.uuid("invalid") });

export const profileSchema = z.object({
  full_name: z.string().trim().min(2, "required").max(120, "tooLong"),
  phone: optionalPhone,
  locale: z.enum(["pt-BR", "es-ES"]),
});
