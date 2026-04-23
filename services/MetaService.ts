// services/MetaService.ts
import { Pool } from "pg";
import { AsignarMetaDTO } from "../dtos/MetaDTO";

const ROLES_GLOBALES = ["ADMINISTRADOR", "GERENTE_REGIONAL"];
const ROL_GERENTE_REG = "GERENTE_REGIONAL";

export class MetaService {
  constructor(private readonly pool: Pool) {}

  //Asignar meta mensual
  async asignarMetaMensual(dto: AsignarMetaDTO) {
    const queryEmpleado = `
      SELECT e.id_empleado, p.nombre AS puesto
      FROM empleado e
      INNER JOIN puesto p ON e.id_puesto = p.id_puesto
      WHERE e.id_empleado = $1 AND e.activo = true;
    `;
    const resEmp = await this.pool.query(queryEmpleado, [dto.id_empleado]);
    if (resEmp.rows.length === 0)
      throw new Error("El empleado no existe o no está activo");
    if (resEmp.rows[0].puesto.toLowerCase() !== "vendedor")
      throw new Error(
        "Solo se pueden asignar metas a empleados con puesto 'vendedor'",
      );

    const queryExistente = `SELECT id_meta FROM meta_venta WHERE id_empleado = $1 AND anio = $2 AND mes = $3;`;
    const resultExistente = await this.pool.query(queryExistente, [
      dto.id_empleado,
      dto.anio,
      dto.mes,
    ]);
    if (resultExistente.rows.length > 0)
      throw new Error(
        `El empleado ID ${dto.id_empleado} ya tiene una meta asignada para el ${dto.mes}/${dto.anio}.`,
      );

    const base = dto.comision_base_pct ?? 2.0;
    const exc = dto.comision_excedente_pct ?? 4.0;
    const id_esquema = await this._resolverEsquema(base, exc);

    const queryInsert = `
      INSERT INTO meta_venta (id_empleado, anio, mes, monto_meta, id_esquema)
      VALUES ($1, $2, $3, $4, $5) RETURNING *;
    `;
    const resultInsert = await this.pool.query(queryInsert, [
      dto.id_empleado,
      dto.anio,
      dto.mes,
      dto.monto_meta,
      id_esquema,
    ]);

    const meta = resultInsert.rows[0];
    return { ...meta, comision_base_pct: base, comision_excedente_pct: exc };
  }

  //Helper: resolver o crear esquema de comisión
  private async _resolverEsquema(base: number, exc: number): Promise<number> {
    const buscar = await this.pool.query(
      `SELECT id_esquema FROM esquema_comision
       WHERE comision_base_pct = $1 AND comision_excedente_pct = $2 AND activo = true
       LIMIT 1`,
      [base, exc],
    );
    if (buscar.rows.length > 0) return buscar.rows[0].id_esquema;

    const crear = await this.pool.query(
      `INSERT INTO esquema_comision (nombre, comision_base_pct, comision_excedente_pct)
       VALUES ($1, $2, $3) RETURNING id_esquema`,
      [`Esquema ${base}/${exc}`, base, exc],
    );
    return crear.rows[0].id_esquema;
  }

  //Helper central: construir filtro SQL de sucursal/región
  //Devuelve { clause, params } para insertar en cualquier query.
  // - ADMINISTRADOR sin filtro: ve todo → sin restricción
  // - ADMINISTRADOR con id_sucursal_query: filtra esa sucursal
  // - GERENTE_REGIONAL sin filtro: ve todas las sucursales de su región
  // - GERENTE_REGIONAL con id_sucursal_query: filtra esa sucursal dentro de su región
  // - Cualquier otro rol: solo su propia sucursal (id_sucursal del token)
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
      //Sin filtro: ve todo
      return { clause: "", params };
    }

    if (rolUsuario === ROL_GERENTE_REG) {
      if (idSucursalQuery) {
        //Filtra sucursal específica pero valida que pertenezca a su región
        params.push(idSucursalQuery);
        params.push(idRegionToken);
        return {
          clause: `AND e.id_sucursal = $${params.length - 1}
                   AND s.id_region   = $${params.length}`,
          params,
        };
      }
      // Sin filtro de sucursal: ve todas las sucursales de su región
      params.push(idRegionToken);
      return { clause: `AND s.id_region = $${params.length}`, params };
    }

    // Roles locales (SUPERVISOR, VENDEDOR, etc.) solo su sucursal
    params.push(idSucursalToken);
    return { clause: `AND e.id_sucursal = $${params.length}`, params };
  }

  //Rendimiento mensual (mes actual)
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
      INNER JOIN sucursal    s ON e.id_sucursal = s.id_sucursal
      INNER JOIN meta_venta  m ON e.id_empleado = m.id_empleado
      LEFT  JOIN venta        v
        ON  v.id_vendedor = e.id_empleado
        AND EXTRACT(MONTH FROM v.created_at) = m.mes
        AND EXTRACT(YEAR  FROM v.created_at) = m.anio
      WHERE m.mes  = EXTRACT(MONTH FROM CURRENT_DATE)
        AND m.anio = EXTRACT(YEAR  FROM CURRENT_DATE)
        AND e.activo = true
        ${clause}
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

  //Consolidado de la sucursal/región (mes actual)
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

    const query = `
      SELECT 
        COALESCE(SUM(m.monto_meta), 0) AS total_meta,
        COALESCE(SUM(ventas_emp.total_vendido), 0) AS total_vendido,
        COUNT(DISTINCT e.id_empleado) AS empleados_con_meta
      FROM empleado e
      INNER JOIN sucursal   s ON e.id_sucursal = s.id_sucursal
      INNER JOIN meta_venta m ON e.id_empleado = m.id_empleado
      LEFT  JOIN (
        SELECT id_vendedor, SUM(total) AS total_vendido
        FROM venta
        WHERE estado = 'pagada'
          AND EXTRACT(MONTH FROM created_at) = EXTRACT(MONTH FROM CURRENT_DATE)
          AND EXTRACT(YEAR  FROM created_at) = EXTRACT(YEAR  FROM CURRENT_DATE)
        GROUP BY id_vendedor
      ) ventas_emp ON ventas_emp.id_vendedor = e.id_empleado
      WHERE m.mes  = EXTRACT(MONTH FROM CURRENT_DATE)
        AND m.anio = EXTRACT(YEAR  FROM CURRENT_DATE)
        AND e.activo = true
        ${clause};
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

  //Vendedores disponibles para asignar meta
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

    const query = `
      SELECT 
        e.id_empleado,
        CONCAT(e.nombre, ' ', e.apellido) AS nombre,
        e.id_sucursal,
        s.nombre AS nombre_sucursal,
        CASE WHEN m.id_meta IS NOT NULL THEN true ELSE false END AS ya_tiene_meta,
        m.monto_meta AS meta_actual
      FROM empleado e
      INNER JOIN puesto     p ON e.id_puesto   = p.id_puesto
      INNER JOIN sucursal   s ON e.id_sucursal  = s.id_sucursal
      LEFT  JOIN meta_venta m
        ON  m.id_empleado = e.id_empleado
        AND m.anio = $1 AND m.mes = $2
      WHERE LOWER(p.nombre) = 'vendedor'
        AND e.activo = true
        ${clause}
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

  //Sugerencia de meta para un vendedor
  async obtenerSugerenciaMeta(id_empleado: number) {
    const hoy = new Date();
    let anioRef = hoy.getFullYear();
    let mesRef = hoy.getMonth();
    if (mesRef === 0) {
      mesRef = 12;
      anioRef -= 1;
    }

    const metaRes = await this.pool.query(
      `SELECT mv.monto_meta, ec.comision_base_pct, ec.comision_excedente_pct
       FROM meta_venta mv
       JOIN esquema_comision ec ON mv.id_esquema = ec.id_esquema
       WHERE mv.id_empleado = $1 AND mv.anio = $2 AND mv.mes = $3;`,
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

    const { monto_meta } = metaRes.rows[0];

    const ventasRes = await this.pool.query(
      `SELECT COALESCE(SUM(total), 0) AS total_vendido
       FROM venta
       WHERE id_vendedor = $1
         AND estado = 'pagada'
         AND EXTRACT(MONTH FROM created_at) = $2
         AND EXTRACT(YEAR  FROM created_at) = $3`,
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

  //Historial de metas de un empleado
  async obtenerHistorialMetas(id_empleado: number) {
    const result = await this.pool.query(
      `SELECT
         mv.id_meta,
         mv.anio,
         mv.mes,
         mv.monto_meta,
         ec.comision_base_pct,
         ec.comision_excedente_pct,
         mv.created_at,
         COALESCE(SUM(v.total) FILTER (WHERE v.estado = 'pagada'), 0) AS monto_vendido
       FROM meta_venta mv
       JOIN esquema_comision ec ON mv.id_esquema = ec.id_esquema
       LEFT JOIN venta v
         ON  v.id_vendedor = mv.id_empleado
         AND EXTRACT(MONTH FROM v.created_at) = mv.mes
         AND EXTRACT(YEAR  FROM v.created_at) = mv.anio
       WHERE mv.id_empleado = $1
       GROUP BY mv.id_meta, mv.anio, mv.mes, mv.monto_meta,
                ec.comision_base_pct, ec.comision_excedente_pct, mv.created_at
       ORDER BY mv.anio DESC, mv.mes DESC`,
      [id_empleado],
    );

    const hoy = new Date();
    const mesActual = hoy.getMonth() + 1; // 1–12
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

      //Mes actual o futuro es en curso (independiente del % vendido)
      const esFuturoOActual =
        anio > anioActual || (anio === anioActual && mes >= mesActual);

      let estado: "en_curso" | "cumplió" | "no_cumplió";
      if (esFuturoOActual) {
        estado = "en_curso";
      } else if (pct >= 100) {
        estado = "cumplió";
      } else {
        estado = "no_cumplió";
      }

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

  //Cálculo de rendimiento y comisión individual
  async calcularRendimientoYComision(
    id_empleado: number,
    anio: number,
    mes: number,
  ) {
    const metaRes = await this.pool.query(
      `SELECT mv.monto_meta, ec.comision_base_pct, ec.comision_excedente_pct
       FROM meta_venta mv
       JOIN esquema_comision ec ON mv.id_esquema = ec.id_esquema
       WHERE mv.id_empleado = $1 AND mv.anio = $2 AND mv.mes = $3`,
      [id_empleado, anio, mes],
    );
    if (metaRes.rows.length === 0)
      throw new Error(
        `No hay meta asignada para el empleado ${id_empleado} en ${mes}/${anio}`,
      );

    const { monto_meta, comision_base_pct, comision_excedente_pct } =
      metaRes.rows[0];

    const ventasRes = await this.pool.query(
      `SELECT COALESCE(SUM(total), 0) AS total_vendido
       FROM venta
       WHERE id_vendedor = $1
         AND estado = 'pagada'
         AND EXTRACT(MONTH FROM created_at) = $2
         AND EXTRACT(YEAR  FROM created_at) = $3`,
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

  //Sucursales disponibles (para selector en frontend)
  async obtenerSucursales(rolUsuario: string, idRegionToken: number | null) {
    // GERENTE_REGIONAL: solo las sucursales de su región
    // ADMINISTRADOR: todas
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
      "SELECT id_sucursal, nombre FROM sucursal WHERE activo = true ORDER BY nombre",
    );
    return r.rows;
  }
}
