// schemas/auth.schema.ts
import { z } from "zod";

export const loginSchema = z.object({
  username: z.string().min(4, "El usuario debe tener al menos 4 caracteres"),
  password: z.string().min(6, "La contraseña es obligatoria"),
});

export const registrarUsuarioSchema = z.object({
  id_empleado: z.number().int().positive(),
  id_rol: z.number().int().positive(),
  username: z.string().min(4),
  password: z.string().min(6, "La contraseña debe tener al menos 6 caracteres"),
});
