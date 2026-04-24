// services/AdminService.ts
import bcrypt from "bcrypt";
import { Pool } from "pg";

export class AdminService {
  private readonly SALT_ROUNDS = 10;

  constructor(private readonly pool: Pool) {}

  // Listar empleados activos
  async listarEmpleados(id_sucursal?: number) {
    const filtroSucursal = id_sucursal
      ? `AND e.id_sucursal = ${Number(id_sucursal)}`
      : "";

    const result = await this.pool.query(
      `SELECT
         e.id_empleado,
         e.nombre,
         e.apellido,
         e.dpi,
         e.nit,
         e.telefono,
         e.email,
         e.fecha_ingreso,
         e.activo,
         s.id_sucursal,
         s.nombre   AS sucursal,
         u.id_usuario,
         u.username,
         u.activo   AS usuario_activo,
         r.nombre   AS rol
       FROM empleado e
       INNER JOIN sucursal s ON e.id_sucursal = s.id_sucursal
       LEFT  JOIN usuario  u ON u.id_empleado = e.id_empleado
       LEFT  JOIN rol      r ON u.id_rol      = r.id_rol
       WHERE e.activo = true ${filtroSucursal}
       ORDER BY s.nombre, e.apellido, e.nombre`,
    );

    return result.rows.map((r) => ({
      id_empleado: r.id_empleado,
      nombre: r.nombre,
      apellido: r.apellido,
      nombre_completo: `${r.nombre} ${r.apellido}`,
      dpi: r.dpi,
      nit: r.nit,
      telefono: r.telefono,
      email: r.email,
      fecha_ingreso: r.fecha_ingreso,
      activo: r.activo,
      sucursal: {
        id_sucursal: r.id_sucursal,
        nombre: r.sucursal,
      },
      usuario: r.id_usuario
        ? {
            id_usuario: r.id_usuario,
            username: r.username,
            activo: r.usuario_activo,
            rol: r.rol,
          }
        : null,
    }));
  }

  // Crear empleado + usuario en una sola transacción
  async crearEmpleadoCompleto(data: {
    nombre: string;
    apellido: string;
    id_sucursal: number;
    dpi?: string;
    nit?: string;
    telefono?: string;
    email?: string;
    fecha_ingreso: string;
    username: string;
    password: string;
    id_rol: number;
    id_usuario_creador: number;
  }) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      // Verificar username único
      const usernameExiste = await client.query(
        "SELECT id_usuario FROM usuario WHERE username = $1",
        [data.username],
      );
      if (usernameExiste.rows.length)
        throw new Error(`El username '${data.username}' ya está en uso.`);

      // Verificar DPI único si se provee
      if (data.dpi) {
        const dpiExiste = await client.query(
          "SELECT id_empleado FROM empleado WHERE dpi = $1",
          [data.dpi],
        );
        if (dpiExiste.rows.length)
          throw new Error(`El DPI '${data.dpi}' ya está registrado.`);
      }

      // Insertar empleado — sin id_puesto
      const empRes = await client.query(
        `INSERT INTO empleado
           (id_sucursal, nombre, apellido, dpi, nit,
            telefono, email, fecha_ingreso, activo)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,true)
         RETURNING id_empleado`,
        [
          data.id_sucursal,
          data.nombre.trim(),
          data.apellido.trim(),
          data.dpi || null,
          data.nit || null,
          data.telefono || null,
          data.email || null,
          data.fecha_ingreso,
        ],
      );
      const id_empleado = empRes.rows[0].id_empleado;

      // Hashear contraseña y crear usuario
      const hash = await bcrypt.hash(data.password, this.SALT_ROUNDS);
      const usuRes = await client.query(
        `INSERT INTO usuario (id_empleado, username, password_hash, id_rol, activo)
         VALUES ($1,$2,$3,$4,true)
         RETURNING id_usuario`,
        [id_empleado, data.username.trim(), hash, data.id_rol],
      );
      const id_usuario = usuRes.rows[0].id_usuario;

      await client.query("COMMIT");
      return { id_empleado, id_usuario };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  //Catálogos de apoyo

  async listarSucursales() {
    const r = await this.pool.query(
      "SELECT id_sucursal, nombre FROM sucursal WHERE activo=true ORDER BY nombre",
    );
    return r.rows;
  }

  async listarRoles() {
    const r = await this.pool.query(
      "SELECT id_rol, nombre FROM rol WHERE activo=true ORDER BY nombre",
    );
    return r.rows;
  }

  async listarTiposCliente() {
    const r = await this.pool.query(
      "SELECT id_tipo_cliente, nombre FROM tipo_cliente WHERE activo=true ORDER BY nombre",
    );
    return r.rows;
  }
}
