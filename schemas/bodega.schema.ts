// schemas/bodega.schema.ts
import { z } from "zod";
import { TipoMovimientoBodega } from "../types/bodega.types";

export const movimientoBodegaSchema = z.object({
  id_producto: z.number().int().positive("ID de producto inválido"),
  tipo_movimiento: z.nativeEnum(TipoMovimientoBodega),
  cantidad: z.number().positive("La cantidad debe ser mayor a 0"),
  motivo: z
    .string()
    .min(5, "Debe especificar un motivo claro para la auditoría"),
});
