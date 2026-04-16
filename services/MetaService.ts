// services/MetaService.ts
import { Pool } from "pg";
import { AsignarMetaDTO } from "../dtos/MetaDTO";

// Roles que pueden ver/operar sobre cualquier sucursal
const ROLES_GLOBALES = ["ADMINISTRADOR", "GERENTE_REGIONAL"];

export class MetaService {
  constructor(private readonly pool: Pool) {}

  // ─── Asignar meta mensual ───────────────────────────────────────────────
  async asignarMetaMensual(dto: AsignarMetaDTO) {
    // Validar que el empleado exista, esté activo y sea VENDEDOR
    const queryEmpleado = `
      SELECT e.id_empleado, p.nombre AS puesto
      FROM empleado e
      INNER JOIN puesto p ON e.id_puesto = p.id_puesto
      WHERE e.id_empleado = $1 AND e.activo = true;
    `;
    const resEmp = await this.pool.query(queryEmpleado, [dto.id_empleado]);
    if (resEmp.rows.length === 0) {
      throw new Error("El empleado no existe o no está activo");
    }
    if (resEmp.rows[0].puesto.toLowerCase() !== "vendedor") {
      throw new Error(
        "Solo se pueden asignar metas a empleados con puesto 'vendedor'",
      );
    }

    const queryExistente = `SELECT id_meta FROM meta_venta WHERE id_empleado = $1 AND anio = $2 AND mes = $3;`;
    const resultExistente = await this.pool.query(queryExistente, [
      dto.id_empleado,
      dto.anio,
      dto.mes,
    ]);

    if (resultExistente.rows.length > 0) {
      throw new Error(
        `El empleado ID ${dto.id_empleado} ya tiene una meta asignada para el ${dto.mes}/${dto.anio}.`,
      );
    }

    const queryInsert = `
      INSERT INTO meta_venta (id_empleado, anio, mes, monto_meta, comision_base_pct, comision_excedente_pct)
      VALUES ($1, $2, $3, $4, $5, $6) RETURNING *;
    `;
    const resultInsert = await this.pool.query(queryInsert, [
      dto.id_empleado,
      dto.anio,
      dto.mes,
      dto.monto_meta,
      dto.comision_base_pct,
      dto.comision_excedente_pct,
    ]);

    return resultInsert.rows[0];
  }

  // ─── Cálculo de comisiones individual (sin cambios funcionales) ─────────
  async calcularRendimientoYComision(
    id_empleado: number,
    anio: number,
    mes: number,
  ) {
    const metaRes = await this.pool.query(
      `SELECT * FROM meta_venta WHERE id_empleado = $1 AND anio = $2 AND mes = $3;`,
      [id_empleado, anio, mes],
    );
    if (metaRes.rows.length === 0)
      throw new Error(
        `No se encontró una meta asignada para el empleado ID ${id_empleado}.`,
      );
    const meta = metaRes.rows[0];

    const ventasRes = await this.pool.query(
      `
      SELECT COALESCE(SUM(total), 0) AS total_vendido FROM venta
      WHERE id_vendedor = $1 AND estado = 'pagada' AND EXTRACT(YEAR FROM created_at) = $2 AND EXTRACT(MONTH FROM created_at) = $3;
    `,
      [id_empleado, anio, mes],
    );
    const totalVendido = Number(ventasRes.rows[0].total_vendido);

    const montoMeta = Number(meta.monto_meta);
    const pctBase = Number(meta.comision_base_pct) / 100;
    const pctExcedente = Number(meta.comision_excedente_pct) / 100;

    let comisionCalculada = 0;
    let llegoALaMeta = false;

    if (totalVendido < montoMeta) {
      comisionCalculada = totalVendido * pctBase;
    } else {
      llegoALaMeta = true;
      const excedente = totalVendido - montoMeta;
      comisionCalculada = montoMeta * pctBase + excedente * pctExcedente;
    }

    return {
      id_empleado,
      periodo: `${mes}/${anio}`,
      meta_asignada: montoMeta,
      total_vendido: totalVendido,
      llego_a_meta: llegoALaMeta,
      porcentajes_aplicados: {
        base: `${meta.comision_base_pct}%`,
        excedente: `${meta.comision_excedente_pct}%`,
      },
      comision_total_ganada: Number(comisionCalculada.toFixed(2)),
    };
  }

  // ─── Rendimiento mensual con filtro por sucursal ────────────────────────
  async obtenerRendimientoMensual(
    rolUsuario: string,
    idSucursalUsuario: number,
    idSucursalFiltro?: number,
  ) {
    // Determinamos qué sucursal aplicar
    let idSucursalEfectiva: number | null = null;

    if (ROLES_GLOBALES.includes(rolUsuario)) {
      // Admin/Gerente: pueden filtrar por sucursal o ver todas (null = todas)
      idSucursalEfectiva = idSucursalFiltro || null;
    } else {
      // Cualquier otro rol: forzamos su propia sucursal
      idSucursalEfectiva = idSucursalUsuario;
    }

    const params: any[] = [];
    let filtroSucursal = "";
    if (idSucursalEfectiva !== null) {
      params.push(idSucursalEfectiva);
      filtroSucursal = `AND e.id_sucursal = $${params.length}`;
    }

    const query = `
      SELECT 
        e.id_empleado,
        e.id_sucursal,
        s.nombre AS nombre_sucursal,
        CONCAT(e.nombre, ' ', e.apellido) AS nombre_vendedor,
        m.monto_meta,
        COALESCE(SUM(v.total) FILTER (WHERE v.estado = 'pagada'), 0) AS monto_vendido,
        CASE 
          WHEN m.monto_meta > 0 
          THEN (COALESCE(SUM(v.total) FILTER (WHERE v.estado = 'pagada'), 0) / m.monto_meta) * 100 
          ELSE 0 
        END AS porcentaje_cumplimiento
      FROM empleado e
      INNER JOIN sucursal s ON e.id_sucursal = s.id_sucursal
      INNER JOIN meta_venta m ON e.id_empleado = m.id_empleado
      LEFT JOIN venta v 
        ON v.id_vendedor = e.id_empleado 
       AND EXTRACT(MONTH FROM v.created_at) = m.mes 
       AND EXTRACT(YEAR FROM v.created_at) = m.anio
      WHERE m.mes = EXTRACT(MONTH FROM CURRENT_DATE) 
        AND m.anio = EXTRACT(YEAR FROM CURRENT_DATE)
        AND e.activo = true
        ${filtroSucursal}
      GROUP BY e.id_empleado, e.id_sucursal, s.nombre, e.nombre, e.apellido, m.monto_meta
      ORDER BY s.nombre, e.nombre;
    `;

    const result = await this.pool.query(query, params);
    return result.rows.map((row) => ({
      id_empleado: row.id_empleado,
      id_sucursal: row.id_sucursal,
      nombre_sucursal: row.nombre_sucursal,
      nombre_vendedor: row.nombre_vendedor,
      monto_meta: Number(row.monto_meta),
      monto_vendido: Number(row.monto_vendido),
      porcentaje_cumplimiento: Number(row.porcentaje_cumplimiento),
    }));
  }

  // ─── Consolidado de la sucursal (mes actual) ────────────────────────────
  async obtenerConsolidadoSucursal(
    rolUsuario: string,
    idSucursalUsuario: number,
    idSucursalFiltro?: number,
  ) {
    let idSucursalEfectiva: number | null = null;

    if (ROLES_GLOBALES.includes(rolUsuario)) {
      idSucursalEfectiva = idSucursalFiltro || null;
    } else {
      idSucursalEfectiva = idSucursalUsuario;
    }

    const params: any[] = [];
    let filtroSucursal = "";
    if (idSucursalEfectiva !== null) {
      params.push(idSucursalEfectiva);
      filtroSucursal = `AND e.id_sucursal = $${params.length}`;
    }

    const query = `
      SELECT 
        COALESCE(SUM(m.monto_meta), 0) AS total_meta,
        COALESCE(SUM(ventas_emp.total_vendido), 0) AS total_vendido,
        COUNT(DISTINCT e.id_empleado) AS empleados_con_meta
      FROM empleado e
      INNER JOIN meta_venta m ON e.id_empleado = m.id_empleado
      LEFT JOIN (
        SELECT id_vendedor, SUM(total) AS total_vendido
        FROM venta
        WHERE estado = 'pagada'
          AND EXTRACT(MONTH FROM created_at) = EXTRACT(MONTH FROM CURRENT_DATE)
          AND EXTRACT(YEAR FROM created_at) = EXTRACT(YEAR FROM CURRENT_DATE)
        GROUP BY id_vendedor
      ) ventas_emp ON ventas_emp.id_vendedor = e.id_empleado
      WHERE m.mes = EXTRACT(MONTH FROM CURRENT_DATE)
        AND m.anio = EXTRACT(YEAR FROM CURRENT_DATE)
        AND e.activo = true
        ${filtroSucursal};
    `;

    const result = await this.pool.query(query, params);
    const row = result.rows[0];
    const totalMeta = Number(row.total_meta);
    const totalVendido = Number(row.total_vendido);
    const porcentaje = totalMeta > 0 ? (totalVendido / totalMeta) * 100 : 0;

    return {
      total_meta: totalMeta,
      total_vendido: totalVendido,
      porcentaje_cumplimiento: Number(porcentaje.toFixed(2)),
      empleados_con_meta: Number(row.empleados_con_meta),
    };
  }

  // ─── Vendedores disponibles para asignar meta ───────────────────────────
  async obtenerVendedoresParaAsignar(
    rolUsuario: string,
    idSucursalUsuario: number,
    anio: number,
    mes: number,
    idSucursalFiltro?: number,
  ) {
    let idSucursalEfectiva: number | null = null;

    if (ROLES_GLOBALES.includes(rolUsuario)) {
      idSucursalEfectiva = idSucursalFiltro || null;
    } else {
      idSucursalEfectiva = idSucursalUsuario;
    }

    const params: any[] = [anio, mes];
    let filtroSucursal = "";
    if (idSucursalEfectiva !== null) {
      params.push(idSucursalEfectiva);
      filtroSucursal = `AND e.id_sucursal = $${params.length}`;
    }

    const query = `
      SELECT 
        e.id_empleado,
        CONCAT(e.nombre, ' ', e.apellido) AS nombre,
        e.id_sucursal,
        s.nombre AS nombre_sucursal,
        CASE WHEN m.id_meta IS NOT NULL THEN true ELSE false END AS ya_tiene_meta,
        m.monto_meta AS meta_actual
      FROM empleado e
      INNER JOIN puesto p ON e.id_puesto = p.id_puesto
      INNER JOIN sucursal s ON e.id_sucursal = s.id_sucursal
      LEFT JOIN meta_venta m 
        ON m.id_empleado = e.id_empleado 
       AND m.anio = $1 AND m.mes = $2
      WHERE LOWER(p.nombre) = 'vendedor'
        AND e.activo = true
        ${filtroSucursal}
      ORDER BY s.nombre, e.nombre;
    `;

    const result = await this.pool.query(query, params);
    return result.rows.map((row) => ({
      id_empleado: row.id_empleado,
      nombre: row.nombre,
      id_sucursal: row.id_sucursal,
      nombre_sucursal: row.nombre_sucursal,
      ya_tiene_meta: row.ya_tiene_meta,
      meta_actual: row.meta_actual ? Number(row.meta_actual) : null,
    }));
  }

  // ─── Sugerencia de meta basada en el mes anterior ───────────────────────
  async obtenerSugerenciaMeta(id_empleado: number) {
    const hoy = new Date();
    let anioRef = hoy.getFullYear();
    let mesRef = hoy.getMonth(); // mes anterior (getMonth() ya da 0-11; mes anterior en 1-12 sería este)
    if (mesRef === 0) {
      mesRef = 12;
      anioRef -= 1;
    }

    // Buscar meta del mes anterior
    const metaRes = await this.pool.query(
      `SELECT monto_meta FROM meta_venta WHERE id_empleado = $1 AND anio = $2 AND mes = $3;`,
      [id_empleado, anioRef, mesRef],
    );

    if (metaRes.rows.length === 0) {
      return {
        meta_anterior: null,
        vendido_anterior: null,
        supero_meta: null,
        sugerencia: null,
        mes_referencia: `${mesRef}/${anioRef}`,
        explicacion:
          "No hay historial de meta del mes anterior. Ingrese el monto manualmente.",
      };
    }

    const metaAnterior = Number(metaRes.rows[0].monto_meta);

    // Sumar ventas pagadas del mes anterior
    const ventasRes = await this.pool.query(
      `
      SELECT COALESCE(SUM(total), 0) AS total_vendido
      FROM venta
      WHERE id_vendedor = $1 
        AND estado = 'pagada'
        AND EXTRACT(YEAR FROM created_at) = $2 
        AND EXTRACT(MONTH FROM created_at) = $3;
      `,
      [id_empleado, anioRef, mesRef],
    );
    const vendidoAnterior = Number(ventasRes.rows[0].total_vendido);

    let sugerencia: number;
    let supero: boolean;
    let explicacion: string;

    if (vendidoAnterior >= metaAnterior) {
      supero = true;
      sugerencia = metaAnterior * 1.1;
      explicacion =
        "Superó la meta del mes anterior. Sugerencia: meta anterior + 10%.";
    } else {
      supero = false;
      sugerencia = (vendidoAnterior + metaAnterior) / 2;
      explicacion =
        "No alcanzó la meta del mes anterior. Sugerencia: promedio entre lo vendido y la meta.";
    }

    return {
      meta_anterior: metaAnterior,
      vendido_anterior: vendidoAnterior,
      supero_meta: supero,
      sugerencia: Number(sugerencia.toFixed(2)),
      mes_referencia: `${mesRef}/${anioRef}`,
      explicacion,
    };
  }

  // ─── Listar sucursales (para selector de Admin/Gerente) ─────────────────
  async listarSucursales() {
    const query = `
      SELECT id_sucursal, nombre 
      FROM sucursal 
      WHERE activo = true
      ORDER BY nombre;
    `;
    const result = await this.pool.query(query);
    return result.rows.map((row) => ({
      id_sucursal: row.id_sucursal,
      nombre: row.nombre,
    }));
  }

  // ─── Historial completo de metas de un empleado ─────────────────────────
  async obtenerHistorialEmpleado(id_empleado: number) {
    const query = `
      SELECT 
        m.anio,
        m.mes,
        m.monto_meta,
        COALESCE(SUM(v.total) FILTER (WHERE v.estado = 'pagada'), 0) AS monto_vendido,
        CASE 
          WHEN m.monto_meta > 0 
          THEN (COALESCE(SUM(v.total) FILTER (WHERE v.estado = 'pagada'), 0) / m.monto_meta) * 100 
          ELSE 0 
        END AS porcentaje_cumplimiento
      FROM meta_venta m
      LEFT JOIN venta v 
        ON v.id_vendedor = m.id_empleado
       AND EXTRACT(MONTH FROM v.created_at) = m.mes
       AND EXTRACT(YEAR FROM v.created_at) = m.anio
      WHERE m.id_empleado = $1
      GROUP BY m.anio, m.mes, m.monto_meta
      ORDER BY m.anio DESC, m.mes DESC;
    `;

    const result = await this.pool.query(query, [id_empleado]);
    return result.rows.map((row) => {
      const pct = Number(row.porcentaje_cumplimiento);
      return {
        anio: row.anio,
        mes: row.mes,
        monto_meta: Number(row.monto_meta),
        monto_vendido: Number(row.monto_vendido),
        porcentaje_cumplimiento: Number(pct.toFixed(2)),
        cumplio: pct >= 100,
      };
    });
  }
}
