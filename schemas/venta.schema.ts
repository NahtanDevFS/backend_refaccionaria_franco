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
  // ELIMINADOS: id_sucursal y id_vendedor. ¡El frontend ya no debe enviarlos!

  id_cliente: z.number().int().positive().optional(),
  canal: z
    .nativeEnum(CanalVenta, { message: "Canal de venta inválido" })
    .default(CanalVenta.MOSTRADOR),
  detalles: z
    .array(crearDetalleVentaSchema)
    .min(1, "Debe incluir al menos un producto"),
  descuento_porcentaje_solicitado: z.number().min(0).max(100).optional(),

  // ADVERTENCIA DE SEGURIDAD: Aceptamos esto por ahora para no romper el MVP,
  // pero a futuro esto debe validarse con un PIN o endpoint separado.
  id_supervisor_autoriza: z.number().int().positive().optional(),
});
