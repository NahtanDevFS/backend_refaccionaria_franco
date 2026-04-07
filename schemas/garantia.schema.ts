// schemas/garantia.schema.ts
import { z } from "zod";

export const crearGarantiaSchema = z.object({
  id_detalle_venta: z
    .number()
    .int()
    .positive("El ID del detalle de venta es obligatorio"),
  cantidad: z.number().positive("La cantidad a reclamar debe ser mayor a 0"),
  motivo_reclamo: z
    .string()
    .min(10, "El motivo del reclamo debe ser detallado (mínimo 10 caracteres)"),
});

export const resolverGarantiaSchema = z.object({
  id_garantia: z.number().int().positive("El ID de la garantía es obligatorio"),
  aprobado: z.boolean({
    message: "Debe especificar si está aprobado o no",
  }),
  resolucion: z.string().min(5, "La resolución debe estar detallada"),
});
