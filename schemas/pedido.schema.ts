// schemas/pedido.schema.ts
import { z } from "zod";
import { EstadoPedido } from "../types/pedido.types";

export const programarPedidoSchema = z.object({
  id_venta: z.number().int().positive("El ID de la venta es obligatorio"),
  direccion_entrega: z
    .string()
    .min(5, "La dirección debe ser clara y descriptiva"),
  id_repartidor: z.number().int().positive().optional(),
});

export const resultadoEntregaSchema = z
  .object({
    estado: z.enum([EstadoPedido.ENTREGADO, EstadoPedido.FALLIDO]),
    monto_cobrado_contra_entrega: z.number().nonnegative().optional(),
    motivo_fallido: z.string().optional(),
  })
  .refine(
    (data) => {
      //Regla de validación estricta cruzada
      if (
        data.estado === EstadoPedido.FALLIDO &&
        (!data.motivo_fallido || data.motivo_fallido.length < 5)
      ) {
        return false;
      }
      return true;
    },
    { message: "Si el pedido es fallido, debe proveer un motivo válido" },
  );
