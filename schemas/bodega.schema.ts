// schemas/bodega.schema.ts
import { z } from "zod";

export const detalleDespachoSchema = z.object({
  id_producto: z.number().int().positive(),
  cantidad: z.number().positive("La cantidad debe ser mayor a 0"),
});

export const emitirDespachoSchema = z.object({
  id_sucursal_destino: z
    .number()
    .int()
    .positive("Debe seleccionar una sucursal destino"),
  detalles: z
    .array(detalleDespachoSchema)
    .min(1, "Debe incluir al menos un producto para despachar"),
});

export const ajusteInventarioSchema = z.object({
  id_producto: z.number().int().positive("Debe seleccionar un producto"),
  tipo: z.enum(["ajuste_positivo", "ajuste_negativo"], {
    message: "Tipo de ajuste inválido",
  }),
  cantidad: z.number().positive("La cantidad debe ser mayor a 0"),
  motivo: z
    .string()
    .min(5, "Debe explicar el motivo detalladamente (mínimo 5 caracteres)"),
});
