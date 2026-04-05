// schemas/meta.schema.ts
import { z } from "zod";

export const asignarMetaSchema = z.object({
  id_empleado: z.number().int().positive("El ID del empleado es inválido"),
  anio: z.number().int().min(2020).max(2100),
  mes: z.number().int().min(1).max(12, "El mes debe ser entre 1 y 12"),
  monto_meta: z.number().positive("La meta debe ser mayor a 0"),
  // Usamos los valores por defecto que tú definiste en la base de datos (2% y 4%)
  comision_base_pct: z.number().min(0).max(100).optional().default(2.0),
  comision_excedente_pct: z.number().min(0).max(100).optional().default(4.0),
});
