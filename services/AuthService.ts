// services/AuthService.ts
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { Pool } from "pg";
import { LoginDTO, RegistrarUsuarioDTO } from "../dtos/AuthDTO";
import { PayloadToken } from "../types/auth.types";

export class AuthService {
  private readonly SALT_ROUNDS = 10;

  constructor(private readonly pool: Pool) {}

  async registrar(dto: RegistrarUsuarioDTO) {
    const passwordHash = await bcrypt.hash(dto.password, this.SALT_ROUNDS);

    // id_rol va directo en usuario
    const result = await this.pool.query(
      `INSERT INTO usuario (id_empleado, username, password_hash, id_rol)
       VALUES ($1, $2, $3, $4)
       RETURNING id_usuario, username`,
      [dto.id_empleado, dto.username, passwordHash, dto.id_rol],
    );

    return {
      id_usuario: result.rows[0].id_usuario,
      username: result.rows[0].username,
    };
  }

  // Login
  async login(dto: LoginDTO) {
    const secreto = process.env.JWT_SECRET;
    if (!secreto) throw new Error("CONFIG ERROR: JWT_SECRET no está definido.");

    const query = `
      SELECT
        u.id_usuario,
        u.username,
        u.password_hash,
        e.id_empleado,
        e.id_sucursal,
        s.id_region,
        s.nombre   AS nombre_sucursal,
        rg.nombre  AS nombre_region,
        r.nombre   AS rol
      FROM usuario u
      INNER JOIN empleado  e  ON u.id_empleado = e.id_empleado
      INNER JOIN rol       r  ON u.id_rol      = r.id_rol
      LEFT  JOIN sucursal  s  ON e.id_sucursal = s.id_sucursal
      LEFT  JOIN region    rg ON s.id_region   = rg.id_region
      WHERE u.username = $1
        AND u.activo   = true
    `;

    const result = await this.pool.query(query, [dto.username]);
    const usuario = result.rows[0] ?? null;

    if (!usuario) throw new Error("Credenciales inválidas");

    const esPasswordValido = await bcrypt.compare(
      dto.password,
      usuario.password_hash,
    );
    if (!esPasswordValido) throw new Error("Credenciales inválidas");

    const payload: PayloadToken = {
      id_usuario: usuario.id_usuario,
      id_empleado: usuario.id_empleado,
      id_sucursal: usuario.id_sucursal ?? null,
      // Para GERENTE_REGIONAL: su scope regional llega desde su sucursal
      id_region: usuario.id_region ?? null,
      rol: usuario.rol,
    };

    const token = jwt.sign(payload, secreto, { expiresIn: "30m" });

    const nombre_contexto =
      usuario.nombre_sucursal ?? `Región ${usuario.nombre_region}`;

    return {
      exito: true,
      mensaje: "Autenticación exitosa",
      token,
      usuario: {
        ...payload,
        username: usuario.username,
        nombre_sucursal: nombre_contexto,
      },
    };
  }
}
