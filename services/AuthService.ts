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

    // LEFT JOIN a sucursal y a region porque el GERENTE_REGIONAL
    // tiene id_sucursal = NULL y usa id_region en su lugar.
    const query = `
      SELECT 
        u.id_usuario,
        u.username,
        u.password_hash,
        e.id_empleado,
        e.id_sucursal,
        e.id_region,
        s.nombre  AS nombre_sucursal,
        rg.nombre AS nombre_region,
        r.nombre  AS rol
      FROM usuario u
      INNER JOIN empleado     e  ON u.id_empleado  = e.id_empleado
      LEFT  JOIN sucursal     s  ON e.id_sucursal  = s.id_sucursal
      LEFT  JOIN region       rg ON e.id_region    = rg.id_region
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
      id_sucursal: usuario.id_sucursal ?? null, // null para GERENTE_REGIONAL
      id_region: usuario.id_region ?? null, // null para todos los demás
      rol: usuario.rol,
    };

    const token = jwt.sign(payload, secreto, { expiresIn: "30m" });

    // El nombre de contexto que se muestra en el sidebar:
    // sucursal para roles locales, región para el gerente regional.
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
