// repositories/AuthRepository.ts
import { Pool } from "pg";

export class AuthRepository {
  constructor(private readonly pool: Pool) {}

  async buscarUsuarioCompleto(username: string): Promise<any> {
    const query = `
      SELECT 
        u.id_usuario, 
        u.password_hash, 
        e.id_empleado, 
        e.id_sucursal, 
        r.nombre AS rol
      FROM usuario u
      INNER JOIN empleado e ON u.id_empleado = e.id_empleado
      INNER JOIN usuario_rol ur ON u.id_usuario = ur.id_usuario
      INNER JOIN rol r ON ur.id_rol = r.id_rol
      WHERE u.username = $1 AND u.activo = true;
    `;
    const result = await this.pool.query(query, [username]);
    return result.rows[0] || null;
  }

  async registrarUsuarioTransaccion(
    id_empleado: number,
    id_rol: number,
    username: string,
    password_hash: string,
  ): Promise<any> {
    const client = await this.pool.connect();

    try {
      await client.query("BEGIN"); // Iniciamos transacción atómica

      // 1. Insertar el usuario
      const insertUserQuery = `
        INSERT INTO usuario (id_empleado, username, password_hash)
        VALUES ($1, $2, $3)
        RETURNING id_usuario, username;
      `;
      const userResult = await client.query(insertUserQuery, [
        id_empleado,
        username,
        password_hash,
      ]);
      const nuevoUsuario = userResult.rows[0];

      // 2. Asignarle el rol
      const insertRolQuery = `
        INSERT INTO usuario_rol (id_usuario, id_rol)
        VALUES ($1, $2);
      `;
      await client.query(insertRolQuery, [nuevoUsuario.id_usuario, id_rol]);

      await client.query("COMMIT"); // Confirmamos los cambios
      return nuevoUsuario;
    } catch (error) {
      await client.query("ROLLBACK"); // Si algo falla, revertimos todo
      throw new Error(
        `Error en base de datos al registrar usuario: ${(error as Error).message}`,
      );
    } finally {
      client.release();
    }
  }
}
