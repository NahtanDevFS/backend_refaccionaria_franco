// schemas/caja.schema.ts
import { z } from "zod";

export const registrarPagoSchema = z.object({
  id_venta: z.number().int().positive("El ID de la venta es obligatorio"),
  metodo_pago: z.enum(["efectivo", "tarjeta", "transferencia"], {
    message: "Método de pago inválido",
  }),
  monto: z.number().positive("El monto debe ser mayor a 0"),
  referencia: z.string().optional(),
});

export const registrarArqueoSchema = z.object({
  efectivo_contado: z.number().nonnegative("El efectivo no puede ser negativo"),
  observaciones: z.string().optional(),
});
