// schemas/venta.schema.ts
import { z } from "zod";

export const crearVentaSchema = z
  .object({
    // Validación de NIT (Máximo 9 caracteres)
    nit: z
      .string()
      .min(1, "El NIT es obligatorio")
      .max(9, "El NIT no puede exceder 9 dígitos"),
    cliente_nuevo: z
      .object({
        nombre_razon_social: z.string(),
        tipo_cliente: z.string(),
        telefono: z.string().optional(),
        email: z
          .string()
          .email("Correo electrónico inválido")
          .optional()
          .or(z.literal("")),
        direccion: z.string().optional(),
        id_municipio: z.number().optional(),
        notas_internas: z.string().optional(),
      })
      .nullable()
      .optional(),
    canal: z.enum(["mostrador", "domicilio"]),
    pago_contra_entrega: z.boolean().optional().default(false),
    descuento_porcentaje: z.number().min(0).max(100).optional().default(0),
    id_repartidor: z.number().nullable().optional(),
    direccion_entrega: z.string().nullable().optional(),
    nombre_contacto: z.string().nullable().optional(),
    telefono_contacto: z.string().nullable().optional(),
    id_municipio_entrega: z.number().nullable().optional(),
    detalles: z
      .array(
        z.object({
          id_producto: z.number().int().positive(),
          cantidad: z.number().positive(),
        }),
      )
      .min(1, "Debe incluir al menos un producto"),
  })
  .refine(
    (data) => {
      // Validación estricta: Si es a domicilio, exige datos de entrega
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
