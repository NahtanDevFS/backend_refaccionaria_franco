import { z } from "zod";

export const entregaExitosaSchema = z.object({
  monto_cobrado: z.number().nonnegative().optional(),
});

export const entregaFallidaSchema = z.object({
  motivo_fallido: z
    .string()
    .min(5, "Debe explicar el motivo de la falla (mínimo 5 caracteres)"),
});
