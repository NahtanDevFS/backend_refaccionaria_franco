// schemas/arqueo.schema.ts
import { z } from "zod";

export const generarArqueoSchema = z.object({
  id_sucursal: z.number().int().positive(),
  id_cajero: z.number().int().positive(),
  id_supervisor_verifica: z.number().int().positive(),
  efectivo_contado: z
    .number()
    .nonnegative("El efectivo contado no puede ser negativo"),
  observaciones: z.string().optional(),
});
