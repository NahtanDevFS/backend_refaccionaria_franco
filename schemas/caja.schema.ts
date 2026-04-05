// schemas/caja.schema.ts
import { z } from "zod";
import { MetodoPago } from "../types/pago.types";

export const registrarPagoSchema = z.object({
  id_venta: z.number().int().positive("El ID de la venta debe ser válido"),
  //id_cajero: z.number().int().positive("El ID del cajero debe ser válido"),
  metodo_pago: z.nativeEnum(MetodoPago, {
    error: "Método de pago inválido",
  }),
  monto_recibido: z.number().positive("El monto debe ser mayor a 0"),
  referencia: z.string().optional(),
});
