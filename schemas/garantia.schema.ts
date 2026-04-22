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

// Catálogo de condiciones válidas — debe mantenerse sincronizado con el
// CHECK constraint chk_condicion_recibido de la BD y con CONDICION_OPTIONS
// en el frontend (aprobaciones/page.tsx).
const CONDICIONES_VALIDAS = [
  "buena",
  "dañado_leve",
  "dañado_grave",
  "muy_dañada",
] as const;

export const resolverGarantiaSchema = z
  .object({
    id_garantia: z
      .number()
      .int()
      .positive("El ID de la garantía es obligatorio"),
    aprobado: z.boolean({ message: "Debe especificar si está aprobado o no" }),
    resolucion: z.string().min(5, "La resolución debe estar detallada"),
    // condicion_recibido es opcional en el schema base:
    //   - Al APROBAR: se vuelve obligatorio por el .refine() de abajo.
    //   - Al RECHAZAR: es opcional (solo si el cliente entregó la pieza).
    condicion_recibido: z.enum(CONDICIONES_VALIDAS).optional(),
    notas_inspeccion: z.string().optional(),
  })
  .refine(
    (data) => {
      // Si se aprueba, condicion_recibido es obligatorio
      if (data.aprobado && !data.condicion_recibido) return false;
      return true;
    },
    {
      message:
        "Al aprobar una garantía debe indicar la condición de la pieza recibida",
      path: ["condicion_recibido"],
    },
  );
