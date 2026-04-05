// schemas/garantia.schema.ts
import { z } from "zod";
import { EstadoGarantia } from "../types/garantia.types";

export const solicitarGarantiaSchema = z.object({
  id_detalle_venta: z.number().int().positive(),
  motivo_reclamo: z
    .string()
    .min(10, "El motivo de reclamo debe ser detallado (min. 10 caracteres)"),
});

export const resolverGarantiaSchema = z.object({
  id_supervisor_aprueba: z.number().int().positive(),
  estado: z.enum([EstadoGarantia.APROBADA, EstadoGarantia.RECHAZADA]),
  resolucion: z.string().min(5, "Debe proveer una resolución o justificación"),
});
