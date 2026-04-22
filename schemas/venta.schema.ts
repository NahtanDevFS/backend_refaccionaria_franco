// schemas/venta.schema.ts
import { z } from "zod";

export const crearVentaSchema = z
  .object({
    // ── Identidad de la transacción (inyectados por el frontend, verificados
    //    por el controller contra el token JWT) ────────────────────────────────
    id_sucursal: z
      .number({ message: "id_sucursal es obligatorio" })
      .int()
      .positive("id_sucursal debe ser un entero positivo"),

    id_vendedor: z
      .number({ message: "id_vendedor es obligatorio" })
      .int()
      .positive("id_vendedor debe ser un entero positivo"),

    // ── Datos del cliente ─────────────────────────────────────────────────────
    nit: z
      .string()
      .min(1, "El NIT es obligatorio")
      .max(9, "El NIT no puede exceder 9 dígitos"),

    cliente_nuevo: z
      .object({
        nombre_razon_social: z.string(),
        // tipo_cliente llega como string desde el frontend (ej. 'particular').
        // El service lo resuelve a id_tipo_cliente internamente.
        tipo_cliente: z.string().optional().default("particular"),
        // Estos campos pueden llegar como null desde el frontend
        telefono: z.string().nullable().optional(),
        email: z
          .string()
          .email("Correo electrónico inválido")
          .nullable()
          .optional()
          .or(z.literal("")),
        direccion: z.string().nullable().optional(),
        id_municipio: z.number().nullable().optional(),
        notas_internas: z.string().nullable().optional(),
      })
      .nullable()
      .optional(),

    // ── Datos del canal y entrega ─────────────────────────────────────────────
    canal: z.enum(["mostrador", "domicilio"]),
    pago_contra_entrega: z.boolean().optional().default(false),
    descuento_porcentaje: z.number().min(0).max(100).optional().default(0),
    id_repartidor: z.number().nullable().optional(),
    direccion_entrega: z.string().nullable().optional(),
    nombre_contacto: z.string().nullable().optional(),
    telefono_contacto: z.string().nullable().optional(),
    id_municipio_entrega: z.number().nullable().optional(),

    // ── Productos ─────────────────────────────────────────────────────────────
    detalles: z
      .array(
        z.object({
          id_producto: z.number().int().positive(),
          id_producto_reacondicionado: z.number().int().positive().optional(),
          cantidad: z.number().positive(),
        }),
      )
      .min(1, "Debe incluir al menos un producto"),
  })
  .refine(
    (data) => {
      // Validación estricta: si es a domicilio, exige datos de entrega
      if (data.canal === "domicilio") {
        return (
          !!data.direccion_entrega &&
          !!data.nombre_contacto &&
          !!data.telefono_contacto
        );
      }
      return true;
    },
    {
      message:
        "La dirección, nombre y teléfono de contacto son obligatorios para entregas a domicilio.",
      path: ["canal"],
    },
  );
