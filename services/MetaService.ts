// services/MetaService.ts
import { Pool } from "pg";
import { AsignarMetaDTO } from "../dtos/MetaDTO";

const ROLES_GLOBALES = ["ADMINISTRADOR", "GERENTE_REGIONAL"];
const ROL_GERENTE_REG = "GERENTE_REGIONAL";

export class MetaService {
  constructor(private readonly pool: Pool) {}

  // ── Asignar meta mensual ──────────────────────────────────────────────────
  // MIGRACIÓN:
  //  - Ya no existe esquema_comision — comision_base_pct y comision_excedente_pct
  //    van directamente en meta_venta
  //  - Verificación de puesto 'vendedor' → rol 'VENDEDOR' via usuario + rol
  async asignarMetaMensual(dto: AsignarMetaDTO) {
    // Verificar que el empleado existe, está activo y tiene rol VENDEDOR
    const resEmp = await this.pool.query(
      `SELECT e.id_empleado
       FROM empleado e
       INNER JOIN usuario u ON u.id_empleado = e.id_empleado
       INNER JOIN rol     r ON u.id_rol      = r.id_rol
       WHERE e.id_empleado = $1
         AND e.activo      = true
         AND r.nombre      = 'VENDEDOR'`,
      [dto.id_empleado],
    );

    if (!resEmp.rows.length)
      throw new Error(
        "El empleado no existe, no está activo, o no tiene rol de vendedor.",
      );

    // Verificar que no tenga ya una meta para ese mes/año
    const resExistente = await this.pool.query(
      `SELECT id_meta FROM meta_venta
       WHERE id_empleado = $1 AND anio = $2 AND mes = $3`,
      [dto.id_empleado, dto.anio, dto.mes],
    );
    if (resExistente.rows.length)
      throw new Error(
        `El empleado ID ${dto.id_empleado} ya tiene una meta asignada para el ${dto.mes}/${dto.anio}.`,
      );

    const base = dto.comision_base_pct ?? 2.0;
    const exc = dto.comision_excedente_pct ?? 4.0;

    // comision_base_pct y comision_excedente_pct van directo — ya no existe id_esquema
    const resInsert = await this.pool.query(
      `INSERT INTO meta_venta
         (id_empleado, anio, mes, monto_meta, comision_base_pct, comision_excedente_pct)
       VALUES ($1,$2,$3,$4,$5,$6)
       RETURNING *`,
      [dto.id_empleado, dto.anio, dto.mes, dto.monto_meta, base, exc],
    );

    const meta = resInsert.rows[0];
    return { ...meta, comision_base_pct: base, comision_excedente_pct: exc };
  }

  // ── Helper: construir cláusula de filtro por sucursal/región ─────────────
  private _buildFiltroSucursal(
    rolUsuario: string,
    idSucursalToken: number | null,
    idRegionToken: number | null,
    idSucursalQuery: number | undefined,
    paramsBase: any[],
  ): { clause: string; params: any[] } {
    const params = [...paramsBase];

    if (rolUsuario === "ADMINISTRADOR") {
      if (idSucursalQuery) {
        params.push(idSucursalQuery);
        return { clause: `AND e.id_sucursal = $${params.length}`, params };
      }
      return { clause: "", params };
    }

    if (rolUsuario === ROL_GERENTE_REG) {
      if (idSucursalQuery) {
        params.push(idSucursalQuery);
        params.push(idRegionToken);
        return {
          clause: `AND e.id_sucursal = $${params.length - 1}
                   AND s.id_region   = $${params.length}`,
          params,
        };
      }
      params.push(idRegionToken);
      return { clause: `AND s.id_region = $${params.length}`, params };
    }

    // Roles locales: solo su sucursal
    params.push(idSucursalToken);
    return { clause: `AND e.id_sucursal = $${params.length}`, params };
  }

  // ── Rendimiento mensual (mes actual) ─────────────────────────────────────
  async obtenerRendimientoMensual(
    rolUsuario: string,
    idSucursalToken: number | null,
    idRegionToken: number | null,
    idSucursalQuery?: number,
  ) {
    const { clause, params } = this._buildFiltroSucursal(
      rolUsuario,
      idSucursalToken,
      idRegionToken,
      idSucursalQuery,
      [],
    );

    const result = await this.pool.query(
      `SELECT
         e.id_empleado, e.id_sucursal,
         s.nombre                               AS nombre_sucursal,
         CONCAT(e.nombre,' ',e.apellido)        AS nombre_vendedor,
         m.monto_meta,
         COALESCE(SUM(v.total) FILTER (
           WHERE ev.nombre = 'pagada'
         ), 0)                                  AS monto_vendido,
         CASE
           WHEN m.monto_meta > 0
           THEN (COALESCE(SUM(v.total) FILTER (WHERE ev.nombre='pagada'),0)
                 / m.monto_meta) * 100
           ELSE 0
         END                                    AS porcentaje_cumplimiento
       FROM empleado e
       INNER JOIN sucursal   s ON e.id_sucursal = s.id_sucursal
       INNER JOIN meta_venta m ON e.id_empleado = m.id_empleado
       LEFT  JOIN venta       v
         ON  v.id_vendedor = e.id_empleado
         AND EXTRACT(MONTH FROM v.created_at) = m.mes
         AND EXTRACT(YEAR  FROM v.created_at) = m.anio
       LEFT JOIN estado_venta ev ON v.id_estado_venta = ev.id_estado_venta
       WHERE m.mes  = EXTRACT(MONTH FROM CURRENT_DATE)
         AND m.anio = EXTRACT(YEAR  FROM CURRENT_DATE)
         AND e.activo = true
         ${clause}
       GROUP BY e.id_empleado, e.id_sucursal, s.nombre, e.nombre, e.apellido, m.monto_meta
       ORDER BY s.nombre, e.nombre`,
      params,
    );

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

  // ── Consolidado de la sucursal/región (mes actual) ────────────────────────
  async obtenerConsolidadoSucursal(
    rolUsuario: string,
    idSucursalToken: number | null,
    idRegionToken: number | null,
    idSucursalQuery?: number,
  ) {
    const { clause, params } = this._buildFiltroSucursal(
      rolUsuario,
      idSucursalToken,
      idRegionToken,
      idSucursalQuery,
      [],
    );

    const result = await this.pool.query(
      `SELECT
         COALESCE(SUM(m.monto_meta), 0)         AS total_meta,
         COALESCE(SUM(ventas_emp.total_vendido), 0) AS total_vendido,
         COUNT(DISTINCT e.id_empleado)           AS empleados_con_meta
       FROM empleado e
       INNER JOIN sucursal   s ON e.id_sucursal = s.id_sucursal
       INNER JOIN meta_venta m ON e.id_empleado = m.id_empleado
       LEFT  JOIN (
         SELECT v.id_vendedor, SUM(v.total) AS total_vendido
         FROM venta v
         JOIN estado_venta ev ON v.id_estado_venta = ev.id_estado_venta
         WHERE ev.nombre = 'pagada'
           AND EXTRACT(MONTH FROM v.created_at) = EXTRACT(MONTH FROM CURRENT_DATE)
           AND EXTRACT(YEAR  FROM v.created_at) = EXTRACT(YEAR  FROM CURRENT_DATE)
         GROUP BY v.id_vendedor
       ) ventas_emp ON ventas_emp.id_vendedor = e.id_empleado
       WHERE m.mes  = EXTRACT(MONTH FROM CURRENT_DATE)
         AND m.anio = EXTRACT(YEAR  FROM CURRENT_DATE)
         AND e.activo = true
         ${clause}`,
      params,
    );

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

  // ── Vendedores disponibles para asignar meta ──────────────────────────────
  // MIGRACIÓN: puesto 'vendedor' → rol 'VENDEDOR'
  async obtenerVendedoresParaAsignar(
    rolUsuario: string,
    idSucursalToken: number | null,
    idRegionToken: number | null,
    anio: number,
    mes: number,
    idSucursalQuery?: number,
  ) {
    const { clause, params } = this._buildFiltroSucursal(
      rolUsuario,
      idSucursalToken,
      idRegionToken,
      idSucursalQuery,
      [anio, mes],
    );

    const result = await this.pool.query(
      `SELECT
         e.id_empleado,
         CONCAT(e.nombre,' ',e.apellido) AS nombre,
         e.id_sucursal,
         s.nombre                        AS nombre_sucursal,
         CASE WHEN m.id_meta IS NOT NULL THEN true ELSE false END AS ya_tiene_meta,
         m.monto_meta                    AS meta_actual
       FROM empleado e
       INNER JOIN usuario    u ON u.id_empleado = e.id_empleado
       INNER JOIN rol        r ON u.id_rol      = r.id_rol
       INNER JOIN sucursal   s ON e.id_sucursal = s.id_sucursal
       LEFT  JOIN meta_venta m
         ON  m.id_empleado = e.id_empleado
         AND m.anio = $1 AND m.mes = $2
       WHERE r.nombre   = 'VENDEDOR'
         AND e.activo   = true
         ${clause}
       ORDER BY s.nombre, e.nombre`,
      params,
    );

    return result.rows.map((row) => ({
      id_empleado: row.id_empleado,
      nombre: row.nombre,
      id_sucursal: row.id_sucursal,
      nombre_sucursal: row.nombre_sucursal,
      ya_tiene_meta: row.ya_tiene_meta,
      meta_actual: row.meta_actual ? Number(row.meta_actual) : null,
    }));
  }

  // ── Sugerencia automática de meta para un vendedor ────────────────────────
  // MIGRACIÓN: ya no hace JOIN a esquema_comision —
  //  lee comision_base_pct y comision_excedente_pct directamente de meta_venta
  async obtenerSugerenciaMeta(id_empleado: number) {
    const hoy = new Date();
    let anioRef = hoy.getFullYear();
    let mesRef = hoy.getMonth(); // 0=enero, entonces getMonth() da el mes anterior al actual
    if (mesRef === 0) {
      mesRef = 12;
      anioRef -= 1;
    }

    const metaRes = await this.pool.query(
      `SELECT monto_meta, comision_base_pct, comision_excedente_pct
       FROM meta_venta
       WHERE id_empleado = $1 AND anio = $2 AND mes = $3`,
      [id_empleado, anioRef, mesRef],
    );

    if (!metaRes.rows.length) {
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

    const { monto_meta } = metaRes.rows[0];

    const ventasRes = await this.pool.query(
      `SELECT COALESCE(SUM(v.total), 0) AS total_vendido
       FROM venta v
       JOIN estado_venta ev ON v.id_estado_venta = ev.id_estado_venta
       WHERE v.id_vendedor = $1
         AND ev.nombre     = 'pagada'
         AND EXTRACT(MONTH FROM v.created_at) = $2
         AND EXTRACT(YEAR  FROM v.created_at) = $3`,
      [id_empleado, mesRef, anioRef],
    );

    const vendido = Number(ventasRes.rows[0].total_vendido);
    const meta = Number(monto_meta);
    const superoMeta = vendido >= meta;
    const sugerencia = superoMeta
      ? Math.ceil(vendido * 1.1)
      : Math.ceil(meta * 0.95);

    return {
      meta_anterior: meta,
      vendido_anterior: vendido,
      supero_meta: superoMeta,
      sugerencia,
      mes_referencia: `${mesRef}/${anioRef}`,
      explicacion: superoMeta
        ? `Superó la meta anterior. Se sugiere un 10% más sobre lo vendido (Q${vendido.toFixed(2)}).`
        : `No alcanzó la meta anterior. Se sugiere un 5% menos sobre la meta (Q${meta.toFixed(2)}).`,
    };
  }

  // ── Historial de metas de un empleado ─────────────────────────────────────
  // MIGRACIÓN: JOIN esquema_comision eliminado — lee comisiones directo de meta_venta
  async obtenerHistorialMetas(id_empleado: number) {
    const result = await this.pool.query(
      `SELECT
         mv.id_meta, mv.anio, mv.mes, mv.monto_meta,
         mv.comision_base_pct, mv.comision_excedente_pct,
         mv.created_at,
         COALESCE(SUM(v.total) FILTER (
           WHERE ev.nombre = 'pagada'
         ), 0) AS monto_vendido
       FROM meta_venta mv
       LEFT JOIN venta v
         ON  v.id_vendedor = mv.id_empleado
         AND EXTRACT(MONTH FROM v.created_at) = mv.mes
         AND EXTRACT(YEAR  FROM v.created_at) = mv.anio
       LEFT JOIN estado_venta ev ON v.id_estado_venta = ev.id_estado_venta
       WHERE mv.id_empleado = $1
       GROUP BY mv.id_meta, mv.anio, mv.mes, mv.monto_meta,
                mv.comision_base_pct, mv.comision_excedente_pct, mv.created_at
       ORDER BY mv.anio DESC, mv.mes DESC`,
      [id_empleado],
    );

    const hoy = new Date();
    const mesActual = hoy.getMonth() + 1;
    const anioActual = hoy.getFullYear();

    return result.rows.map((r) => {
      const anio = Number(r.anio);
      const mes = Number(r.mes);
      const monto_meta = Number(r.monto_meta);
      const monto_vendido = Number(r.monto_vendido);
      const pct =
        monto_meta > 0
          ? Number(((monto_vendido / monto_meta) * 100).toFixed(2))
          : 0;

      const esFuturoOActual =
        anio > anioActual || (anio === anioActual && mes >= mesActual);

      let estado: "en_curso" | "cumplió" | "no_cumplió";
      if (esFuturoOActual) estado = "en_curso";
      else if (pct >= 100) estado = "cumplió";
      else estado = "no_cumplió";

      return {
        id_meta: r.id_meta,
        anio,
        mes,
        monto_meta,
        monto_vendido,
        comision_base_pct: Number(r.comision_base_pct),
        comision_excedente_pct: Number(r.comision_excedente_pct),
        porcentaje_cumplimiento: pct,
        estado,
        created_at: r.created_at,
      };
    });
  }

  // ── Cálculo de rendimiento y comisión individual ──────────────────────────
  // MIGRACIÓN: JOIN esquema_comision eliminado — lee comisiones directo de meta_venta
  async calcularRendimientoYComision(
    id_empleado: number,
    anio: number,
    mes: number,
  ) {
    const metaRes = await this.pool.query(
      `SELECT monto_meta, comision_base_pct, comision_excedente_pct
       FROM meta_venta
       WHERE id_empleado = $1 AND anio = $2 AND mes = $3`,
      [id_empleado, anio, mes],
    );
    if (!metaRes.rows.length)
      throw new Error(
        `No hay meta asignada para el empleado ${id_empleado} en ${mes}/${anio}`,
      );

    const { monto_meta, comision_base_pct, comision_excedente_pct } =
      metaRes.rows[0];

    const ventasRes = await this.pool.query(
      `SELECT COALESCE(SUM(v.total), 0) AS total_vendido
       FROM venta v
       JOIN estado_venta ev ON v.id_estado_venta = ev.id_estado_venta
       WHERE v.id_vendedor = $1
         AND ev.nombre     = 'pagada'
         AND EXTRACT(MONTH FROM v.created_at) = $2
         AND EXTRACT(YEAR  FROM v.created_at) = $3`,
      [id_empleado, mes, anio],
    );

    const meta = Number(monto_meta);
    const vendido = Number(ventasRes.rows[0].total_vendido);
    const base_pct = Number(comision_base_pct) / 100;
    const exc_pct = Number(comision_excedente_pct) / 100;

    const comisionBase = Math.min(vendido, meta) * base_pct;
    const excedente = Math.max(0, vendido - meta);
    const comisionExc = excedente * exc_pct;
    const comisionTotal = comisionBase + comisionExc;

    return {
      id_empleado,
      anio,
      mes,
      monto_meta: meta,
      monto_vendido: vendido,
      excedente,
      comision_base: Number(comisionBase.toFixed(2)),
      comision_excedente: Number(comisionExc.toFixed(2)),
      comision_total: Number(comisionTotal.toFixed(2)),
      porcentaje_cumplimiento:
        meta > 0 ? Number(((vendido / meta) * 100).toFixed(2)) : 0,
    };
  }

  // ── Sucursales disponibles para el selector en frontend ───────────────────
  async obtenerSucursales(rolUsuario: string, idRegionToken: number | null) {
    if (rolUsuario === ROL_GERENTE_REG && idRegionToken) {
      const r = await this.pool.query(
        `SELECT id_sucursal, nombre FROM sucursal
         WHERE activo = true AND id_region = $1
         ORDER BY nombre`,
        [idRegionToken],
      );
      return r.rows;
    }
    const r = await this.pool.query(
      `SELECT id_sucursal, nombre FROM sucursal
       WHERE activo = true ORDER BY nombre`,
    );
    return r.rows;
  }
}
