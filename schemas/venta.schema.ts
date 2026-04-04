// schemas/venta.schema.ts
import { z } from "zod";
import { CanalVenta } from "../types/venta.types";

export const crearDetalleVentaSchema = z.object({
  id_producto: z
    .number()
    .int()
    .positive("El ID del producto debe ser un entero positivo"),
  cantidad: z.number().positive("La cantidad debe ser mayor a 0"),
});

export const crearVentaSchema = z.object({
  id_sucursal: z.number().int().positive(),
  id_vendedor: z.number().int().positive(),
  id_cliente: z.number().int().positive().optional(),
  canal: z.nativeEnum(CanalVenta, { message: "Canal de venta inválido" }),
  detalles: z
    .array(crearDetalleVentaSchema)
    .min(1, "Debe incluir al menos un producto"),
  descuento_porcentaje_solicitado: z.number().min(0).max(100).optional(),
  id_supervisor_autoriza: z.number().int().positive().optional(),
});
