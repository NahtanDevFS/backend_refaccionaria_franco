// repositories/MetaRepository.ts
import { Pool } from "pg";
import { AsignarMetaDTO } from "../dtos/MetaDTO";

export class MetaRepository {
  constructor(private readonly pool: Pool) {}

  // 1. Guardar la meta mensual del vendedor
  async asignarMeta(data: AsignarMetaDTO): Promise<any> {
    const query = `
      INSERT INTO meta_venta (id_empleado, anio, mes, monto_meta, comision_base_pct, comision_excedente_pct)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *;
    `;
    const values = [
      data.id_empleado,
      data.anio,
      data.mes,
      data.monto_meta,
      data.comision_base_pct,
      data.comision_excedente_pct,
    ];

    const result = await this.pool.query(query, values);
    return result.rows[0];
  }

  // 2. Utilidad para evitar que el gerente asigne dos metas al mismo vendedor en el mismo mes
  async obtenerMetaVendedor(
    id_empleado: number,
    anio: number,
    mes: number,
  ): Promise<any> {
    const query = `
      SELECT * FROM meta_venta 
      WHERE id_empleado = $1 AND anio = $2 AND mes = $3;
    `;
    const result = await this.pool.query(query, [id_empleado, anio, mes]);
    return result.rows[0] || null;
  }

  // 3. El motor de cálculo: Sumar TODAS las ventas PAGADAS del mes
  async obtenerTotalVendido(
    id_empleado: number,
    anio: number,
    mes: number,
  ): Promise<number> {
    const query = `
      SELECT COALESCE(SUM(total), 0) AS total_vendido
      FROM venta
      WHERE id_vendedor = $1 
        AND estado = 'pagada'
        AND EXTRACT(YEAR FROM created_at) = $2
        AND EXTRACT(MONTH FROM created_at) = $3;
    `;
    const result = await this.pool.query(query, [id_empleado, anio, mes]);
    return Number(result.rows[0].total_vendido);
  }

  async obtenerRendimientoMensual(): Promise<any[]> {
    // Esta consulta extrae el mes y año actual, busca la meta de los empleados
    // y suma todas sus ventas del mes en curso para sacar el porcentaje.
    const query = `
      SELECT 
        e.id_empleado, 
        CONCAT(e.nombre, ' ', e.apellido) as nombre_vendedor,
        m.monto_meta,
        COALESCE(SUM(v.total), 0) as monto_vendido,
        CASE 
          WHEN m.monto_meta > 0 THEN (COALESCE(SUM(v.total), 0) / m.monto_meta) * 100 
          ELSE 0 
        END as porcentaje_cumplimiento
      FROM empleado e
      INNER JOIN meta_venta m ON e.id_empleado = m.id_empleado
      LEFT JOIN venta v ON v.id_vendedor = e.id_empleado 
         AND EXTRACT(MONTH FROM v.created_at) = m.mes 
         AND EXTRACT(YEAR FROM v.created_at) = m.anio
      WHERE m.mes = EXTRACT(MONTH FROM CURRENT_DATE) 
        AND m.anio = EXTRACT(YEAR FROM CURRENT_DATE)
      GROUP BY e.id_empleado, e.nombre, e.apellido, m.monto_meta;
    `;

    try {
      // Como estás usando PostgreSQL, usa 'this.pool.query' (asumiendo tu estructura)
      const result = await this.pool.query(query);

      // PostgreSQL suele devolver los campos NUMERIC como strings,
      // los parseamos a números para que el frontend no tenga errores de cálculo.
      return result.rows.map((row) => ({
        id_empleado: row.id_empleado,
        nombre_vendedor: row.nombre_vendedor,
        monto_meta: Number(row.monto_meta),
        monto_vendido: Number(row.monto_vendido),
        porcentaje_cumplimiento: Number(row.porcentaje_cumplimiento),
      }));
    } catch (error) {
      throw new Error(
        `Error al obtener rendimiento mensual: ${(error as Error).message}`,
      );
    }
  }
}
