// services/MetaService.ts
import { Pool } from "pg";
import { AsignarMetaDTO } from "../dtos/MetaDTO";

export class MetaService {
  constructor(private readonly pool: Pool) {}

  async asignarMetaMensual(dto: AsignarMetaDTO) {
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

  async calcularRendimientoYComision(
    id_empleado: number,
    anio: number,
    mes: number,
  ) {
    // 1. Obtener Meta
    const metaRes = await this.pool.query(
      `SELECT * FROM meta_venta WHERE id_empleado = $1 AND anio = $2 AND mes = $3;`,
      [id_empleado, anio, mes],
    );
    if (metaRes.rows.length === 0)
      throw new Error(
        `No se encontró una meta asignada para el empleado ID ${id_empleado}.`,
      );
    const meta = metaRes.rows[0];

    // 2. Obtener Ventas
    const ventasRes = await this.pool.query(
      `
      SELECT COALESCE(SUM(total), 0) AS total_vendido FROM venta
      WHERE id_vendedor = $1 AND estado = 'pagada' AND EXTRACT(YEAR FROM created_at) = $2 AND EXTRACT(MONTH FROM created_at) = $3;
    `,
      [id_empleado, anio, mes],
    );
    const totalVendido = Number(ventasRes.rows[0].total_vendido);

    // 3. Matemáticas
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

  async obtenerRendimientoMensual() {
    const query = `
      SELECT 
        e.id_empleado, CONCAT(e.nombre, ' ', e.apellido) as nombre_vendedor, m.monto_meta,
        COALESCE(SUM(v.total), 0) as monto_vendido,
        CASE WHEN m.monto_meta > 0 THEN (COALESCE(SUM(v.total), 0) / m.monto_meta) * 100 ELSE 0 END as porcentaje_cumplimiento
      FROM empleado e
      INNER JOIN meta_venta m ON e.id_empleado = m.id_empleado
      LEFT JOIN venta v ON v.id_vendedor = e.id_empleado AND EXTRACT(MONTH FROM v.created_at) = m.mes AND EXTRACT(YEAR FROM v.created_at) = m.anio
      WHERE m.mes = EXTRACT(MONTH FROM CURRENT_DATE) AND m.anio = EXTRACT(YEAR FROM CURRENT_DATE)
      GROUP BY e.id_empleado, e.nombre, e.apellido, m.monto_meta;
    `;

    const result = await this.pool.query(query);
    return result.rows.map((row) => ({
      id_empleado: row.id_empleado,
      nombre_vendedor: row.nombre_vendedor,
      monto_meta: Number(row.monto_meta),
      monto_vendido: Number(row.monto_vendido),
      porcentaje_cumplimiento: Number(row.porcentaje_cumplimiento),
    }));
  }
}
