// services/AuthService.ts
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { AuthRepository } from "../repositories/AuthRepository";
import { LoginDTO, RegistrarUsuarioDTO } from "../dtos/AuthDTO";
import { PayloadToken } from "../types/auth.types";

export class AuthService {
  // Las rondas de Salting determinan qué tan costoso es encriptar (10 es el estándar actual)
  private readonly SALT_ROUNDS = 10;

  constructor(private readonly authRepository: AuthRepository) {}

  async registrar(dto: RegistrarUsuarioDTO) {
    // Hasheamos la contraseña antes de tocar la base de datos
    const passwordHash = await bcrypt.hash(dto.password, this.SALT_ROUNDS);

    const nuevoUsuario = await this.authRepository.registrarUsuarioTransaccion(
      dto.id_empleado,
      dto.id_rol,
      dto.username,
      passwordHash,
    );

    return {
      id_usuario: nuevoUsuario.id_usuario,
      username: nuevoUsuario.username,
    };
  }

  async login(dto: LoginDTO) {
    const secreto = process.env.JWT_SECRET;
    if (!secreto) {
      throw new Error(
        "CONFIG ERROR: JWT_SECRET no está definido en las variables de entorno.",
      );
    }

    // 1. Buscar si el usuario existe
    const usuario = await this.authRepository.buscarUsuarioCompleto(
      dto.username,
    );
    if (!usuario) {
      throw new Error("Credenciales inválidas"); // Mensaje genérico por seguridad
    }

    // 2. Comparar la contraseña en texto plano con el Hash de la BD
    const esPasswordValido = await bcrypt.compare(
      dto.password,
      usuario.password_hash,
    );
    if (!esPasswordValido) {
      throw new Error("Credenciales inválidas");
    }

    // 3. Construir el Payload (La información que viajará dentro del Token)
    const payload: PayloadToken = {
      id_usuario: usuario.id_usuario,
      id_empleado: usuario.id_empleado,
      id_sucursal: usuario.id_sucursal,
      rol: usuario.rol,
    };

    // 4. Firmar el Token (Expira en 8 horas, ideal para un turno laboral)
    const token = jwt.sign(payload, secreto, { expiresIn: "8h" });

    return {
      exito: true,
      mensaje: "Autenticación exitosa",
      token,
      usuario: payload, // Le devolvemos el payload al frontend para que sepa quién se logueó
    };
  }
}
