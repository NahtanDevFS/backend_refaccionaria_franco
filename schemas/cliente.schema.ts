// schemas/cliente.schema.ts
import { z } from "zod";
import { TipoCliente } from "../types/cliente.types";

export const crearClienteSchema = z.object({
  nombre_razon_social: z
    .string()
    .min(3, "El nombre debe tener al menos 3 caracteres"),
  // Si no envían NIT, la regla de negocio dicta que asuma 'CF'
  nit: z.string().optional().default("CF"),
  tipo_cliente: z
    .nativeEnum(TipoCliente, { message: "Tipo de cliente inválido" })
    .default(TipoCliente.PARTICULAR),
  telefono: z.string().min(8).max(20).optional(),
  email: z.string().email("Email inválido").optional().or(z.literal("")),
  direccion: z.string().optional(),
  id_municipio: z.number().int().positive().optional(),
  notas_internas: z.string().optional(),
});
