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
}
