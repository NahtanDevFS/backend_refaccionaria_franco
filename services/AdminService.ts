// services/AdminService.ts
import bcrypt from "bcrypt";
import { Pool } from "pg";

export class AdminService {
  private readonly SALT_ROUNDS = 10;

  constructor(private readonly pool: Pool) {}

  // ─── Listar todos los empleados con salario actual y usuario ─────────────
  async listarEmpleados(id_sucursal?: number) {
    const filtroSucursal = id_sucursal
      ? `AND e.id_sucursal = ${Number(id_sucursal)}`
      : "";

    // LEFT JOIN a sucursal y region porque el GERENTE_REGIONAL no tiene sucursal
    const query = `
      SELECT
        e.id_empleado,
        e.nombre,
        e.apellido,
        e.dpi,
        e.nit,
        e.telefono,
        e.email,
        e.fecha_ingreso,
        e.activo,
        e.id_sucursal,
        s.nombre                              AS sucursal,
        e.id_region,
        rg.nombre                             AS region,
        p.id_puesto,
        p.nombre                              AS puesto,
        u.id_usuario,
        u.username,
        u.activo                              AS usuario_activo,
        r.nombre                              AS rol,
        hs.salario_base,
        hs.tipo_contrato,
        hs.fecha_vigencia                     AS salario_desde
      FROM empleado e
      LEFT  JOIN sucursal    s  ON e.id_sucursal = s.id_sucursal
      LEFT  JOIN region      rg ON e.id_region   = rg.id_region
      INNER JOIN puesto      p  ON e.id_puesto   = p.id_puesto
      LEFT  JOIN usuario     u  ON u.id_empleado = e.id_empleado
      LEFT  JOIN usuario_rol ur ON ur.id_usuario = u.id_usuario
      LEFT  JOIN rol         r  ON r.id_rol      = ur.id_rol
      LEFT  JOIN LATERAL (
          SELECT salario_base, tipo_contrato, fecha_vigencia
          FROM   historial_salario
          WHERE  id_empleado = e.id_empleado
          ORDER  BY fecha_vigencia DESC
          LIMIT  1
      ) hs ON true
      WHERE e.activo = true ${filtroSucursal}
      ORDER BY COALESCE(s.nombre, rg.nombre), e.apellido, e.nombre;
    `;

    const result = await this.pool.query(query);
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
      // Para empleados de sucursal: sucursal presente, region null
      // Para gerente regional: sucursal null, region presente
      sucursal: r.id_sucursal
        ? { id_sucursal: r.id_sucursal, nombre: r.sucursal }
        : null,
      region: r.id_region ? { id_region: r.id_region, nombre: r.region } : null,
      puesto: {
        id_puesto: r.id_puesto,
        nombre: r.puesto,
      },
      usuario: r.id_usuario
        ? {
            id_usuario: r.id_usuario,
            username: r.username,
            activo: r.usuario_activo,
            rol: r.rol,
          }
        : null,
      salario_actual: r.salario_base
        ? {
            monto: Number(r.salario_base),
            tipo_contrato: r.tipo_contrato,
            desde: r.salario_desde,
          }
        : null,
    }));
  }

  // ─── Crear empleado + salario + usuario en una sola transacción ──────────
  async crearEmpleadoCompleto(data: {
    // Datos del empleado
    nombre: string;
    apellido: string;
    // Exactamente uno de los dos debe estar presente (ver constraint en BD)
    id_sucursal?: number | null;
    id_region?: number | null;
    id_puesto: number;
    dpi?: string;
    nit?: string;
    telefono?: string;
    email?: string;
    fecha_ingreso: string;
    // Salario
    salario_base: number;
    tipo_contrato: "planilla" | "honorarios";
    // Usuario
    username: string;
    password: string;
    id_rol: number;
    // Para auditoría
    id_usuario_creador: number;
  }) {
    // Validar que venga exactamente uno de los dos
    const tieneSucursal = !!data.id_sucursal;
    const tieneRegion = !!data.id_region;
    if (tieneSucursal === tieneRegion) {
      throw new Error(
        "Debe especificarse id_sucursal O id_region, nunca ambos ni ninguno.",
      );
    }

    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      // 1. Verificar que el username no exista
      const usernameExiste = await client.query(
        "SELECT id_usuario FROM usuario WHERE username = $1",
        [data.username],
      );
      if (usernameExiste.rows.length > 0) {
        throw new Error(`El username '${data.username}' ya está en uso.`);
      }

      // 2. Verificar DPI único si se provee
      if (data.dpi) {
        const dpiExiste = await client.query(
          "SELECT id_empleado FROM empleado WHERE dpi = $1",
          [data.dpi],
        );
        if (dpiExiste.rows.length > 0) {
          throw new Error(`El DPI '${data.dpi}' ya está registrado.`);
        }
      }

      // 3. Insertar empleado (id_sucursal o id_region, el que corresponda)
      const empRes = await client.query(
        `INSERT INTO empleado
           (id_sucursal, id_region, id_puesto, nombre, apellido, dpi, nit,
            telefono, email, fecha_ingreso, activo)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,true)
         RETURNING id_empleado`,
        [
          data.id_sucursal || null,
          data.id_region || null,
          data.id_puesto,
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

      // 4. Insertar salario inicial en historial
      await client.query(
        `INSERT INTO historial_salario
           (id_empleado, salario_base, tipo_contrato,
            fecha_vigencia, motivo_cambio, registrado_por)
         VALUES ($1,$2,$3,$4,'Contratación inicial',$5)`,
        [
          id_empleado,
          data.salario_base,
          data.tipo_contrato,
          data.fecha_ingreso,
          data.id_usuario_creador,
        ],
      );

      // 5. Hashear contraseña y crear usuario
      const hash = await bcrypt.hash(data.password, this.SALT_ROUNDS);
      const usuRes = await client.query(
        `INSERT INTO usuario (id_empleado, username, password_hash, activo)
         VALUES ($1,$2,$3,true)
         RETURNING id_usuario`,
        [id_empleado, data.username.trim(), hash],
      );
      const id_usuario = usuRes.rows[0].id_usuario;

      // 6. Asignar rol
      await client.query(
        "INSERT INTO usuario_rol (id_usuario, id_rol) VALUES ($1,$2)",
        [id_usuario, data.id_rol],
      );

      await client.query("COMMIT");

      return { id_empleado, id_usuario };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  // ─── Registrar cambio de salario (historial) ─────────────────────────────
  async actualizarSalario(data: {
    id_empleado: number;
    salario_base: number;
    tipo_contrato: "planilla" | "honorarios";
    fecha_vigencia: string;
    motivo_cambio: string;
    id_usuario_creador: number;
  }) {
    const empRes = await this.pool.query(
      "SELECT id_empleado FROM empleado WHERE id_empleado = $1 AND activo = true",
      [data.id_empleado],
    );
    if (empRes.rows.length === 0) {
      throw new Error("Empleado no encontrado o inactivo.");
    }

    const result = await this.pool.query(
      `INSERT INTO historial_salario
         (id_empleado, salario_base, tipo_contrato,
          fecha_vigencia, motivo_cambio, registrado_por)
       VALUES ($1,$2,$3,$4,$5,$6)
       RETURNING id_historial`,
      [
        data.id_empleado,
        data.salario_base,
        data.tipo_contrato,
        data.fecha_vigencia,
        data.motivo_cambio,
        data.id_usuario_creador,
      ],
    );
    return { id_historial: result.rows[0].id_historial };
  }

  // ─── Historial de salarios de un empleado ────────────────────────────────
  async obtenerHistorialSalario(id_empleado: number) {
    const result = await this.pool.query(
      `SELECT
         hs.id_historial,
         hs.salario_base,
         hs.tipo_contrato,
         hs.fecha_vigencia,
         hs.motivo_cambio,
         hs.created_at,
         CONCAT(u_reg.nombre_display) AS registrado_por
       FROM historial_salario hs
       LEFT JOIN LATERAL (
           SELECT CONCAT(e.nombre, ' ', e.apellido) AS nombre_display
           FROM   usuario u
           INNER JOIN empleado e ON e.id_empleado = u.id_empleado
           WHERE  u.id_usuario = hs.registrado_por
           LIMIT 1
       ) u_reg ON true
       WHERE hs.id_empleado = $1
       ORDER BY hs.fecha_vigencia DESC, hs.created_at DESC`,
      [id_empleado],
    );
    return result.rows.map((r) => ({
      id_historial: r.id_historial,
      salario_base: Number(r.salario_base),
      tipo_contrato: r.tipo_contrato,
      fecha_vigencia: r.fecha_vigencia,
      motivo_cambio: r.motivo_cambio,
      registrado_por: r.registrado_por ?? "Sistema",
      created_at: r.created_at,
    }));
  }

  // ─── Catálogos de apoyo ──────────────────────────────────────────────────
  async listarSucursales() {
    const r = await this.pool.query(
      "SELECT id_sucursal, nombre FROM sucursal WHERE activo=true ORDER BY nombre",
    );
    return r.rows;
  }

  async listarRegiones() {
    const r = await this.pool.query(
      "SELECT id_region, nombre FROM region WHERE activo=true ORDER BY nombre",
    );
    return r.rows;
  }

  async listarPuestos() {
    const r = await this.pool.query(
      "SELECT id_puesto, nombre FROM puesto WHERE activo=true ORDER BY nombre",
    );
    return r.rows;
  }

  async listarRoles() {
    const r = await this.pool.query(
      "SELECT id_rol, nombre FROM rol WHERE activo=true ORDER BY nombre",
    );
    return r.rows;
  }
}
