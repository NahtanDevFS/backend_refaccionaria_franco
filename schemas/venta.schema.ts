// schemas/venta.schema.ts
import { z } from "zod";

export const crearVentaSchema = z.object({
  nit: z.string().min(1, "El NIT es obligatorio"),
  cliente_nuevo: z
    .object({
      nombre_razon_social: z.string(),
      tipo_cliente: z.string(),
      telefono: z.string().optional(),
      direccion: z.string().optional(),
      id_municipio: z.number().optional(),
    })
    .nullable()
    .optional(),
  canal: z.enum(["mostrador", "domicilio"]),
  id_repartidor: z.number().nullable().optional(),
  direccion_entrega: z.string().nullable().optional(),
  detalles: z
    .array(
      z.object({
        id_producto: z.number().int().positive(),
        cantidad: z.number().positive(),
      }),
    )
    .min(1, "Debe incluir al menos un producto en la venta"),
});
