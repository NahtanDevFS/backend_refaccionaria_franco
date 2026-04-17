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
    const client = await this.pool.connect();

    try {
      await client.query("BEGIN");

      const insertUserQuery = `
        INSERT INTO usuario (id_empleado, username, password_hash)
        VALUES ($1, $2, $3)
        RETURNING id_usuario, username;
      `;
      const userResult = await client.query(insertUserQuery, [
        dto.id_empleado,
        dto.username,
        passwordHash,
      ]);
      const nuevoUsuario = userResult.rows[0];

      const insertRolQuery = `
        INSERT INTO usuario_rol (id_usuario, id_rol)
        VALUES ($1, $2);
      `;
      await client.query(insertRolQuery, [nuevoUsuario.id_usuario, dto.id_rol]);

      await client.query("COMMIT");
      return {
        id_usuario: nuevoUsuario.id_usuario,
        username: nuevoUsuario.username,
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw new Error(
        `Error al registrar usuario: ${(error as Error).message}`,
      );
    } finally {
      client.release();
    }
  }

  async login(dto: LoginDTO) {
    const secreto = process.env.JWT_SECRET;
    if (!secreto) throw new Error("CONFIG ERROR: JWT_SECRET no está definido.");

    // ── CAMBIO: se agrega u.username y s.nombre (sucursal) al SELECT ──────────
    const query = `
      SELECT 
        u.id_usuario,
        u.username,
        u.password_hash,
        e.id_empleado,
        e.id_sucursal,
        s.nombre  AS nombre_sucursal,
        r.nombre  AS rol
      FROM usuario u
      INNER JOIN empleado     e  ON u.id_empleado = e.id_empleado
      INNER JOIN sucursal     s  ON e.id_sucursal  = s.id_sucursal
      INNER JOIN usuario_rol  ur ON u.id_usuario   = ur.id_usuario
      INNER JOIN rol          r  ON ur.id_rol       = r.id_rol
      WHERE u.username = $1 AND u.activo = true;
    `;
    const result = await this.pool.query(query, [dto.username]);
    const usuario = result.rows[0] || null;

    if (!usuario) throw new Error("Credenciales inválidas");

    const esPasswordValido = await bcrypt.compare(
      dto.password,
      usuario.password_hash,
    );
    if (!esPasswordValido) throw new Error("Credenciales inválidas");

    const payload: PayloadToken = {
      id_usuario: usuario.id_usuario,
      id_empleado: usuario.id_empleado,
      id_sucursal: usuario.id_sucursal,
      rol: usuario.rol,
    };

    const token = jwt.sign(payload, secreto, { expiresIn: "8h" });

    // ── CAMBIO: el objeto `usuario` ahora incluye username y nombre_sucursal ──
    return {
      exito: true,
      mensaje: "Autenticación exitosa",
      token,
      usuario: {
        ...payload,
        username: usuario.username,
        nombre_sucursal: usuario.nombre_sucursal,
      },
    };
  }
}
