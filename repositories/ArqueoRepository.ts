// repositories/ArqueoRepository.ts
import { Pool } from "pg";
import { IArqueoRepository } from "./IArqueoRepository";
import { ArqueoDTO } from "../dtos/ArqueoDTO";

export class ArqueoRepository implements IArqueoRepository {
  private pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  async obtenerResumenCajaDia(id_cajero: number): Promise<any[]> {
    // CORRECCIÓN: Solo sumamos los pagos que NO han sido arqueados aún
    const query = `
      SELECT metodo_pago, COALESCE(SUM(monto), 0) as total
      FROM pago
      WHERE id_cajero = $1 
        AND DATE(fecha_pago) = CURRENT_DATE
        AND id_arqueo IS NULL
      GROUP BY metodo_pago;
    `;
    const result = await this.pool.query(query, [id_cajero]);
    return result.rows.map((row) => ({
      metodo_pago: row.metodo_pago,
      total: Number(row.total),
    }));
  }

  async registrarArqueo(
    id_sucursal: number,
    id_cajero: number,
    data: ArqueoDTO,
    efectivo_sistema: number,
  ): Promise<number> {
    const client = await this.pool.connect();

    try {
      await client.query("BEGIN");

      const diferencia = data.efectivo_contado - efectivo_sistema;
      const estado = diferencia === 0 ? "cuadra" : "con_diferencia";

      // 1. Insertar el registro del Arqueo
      const queryInsert = `
        INSERT INTO arqueo_caja (
          id_sucursal, id_cajero, efectivo_contado, efectivo_segun_sistema, 
          diferencia, observaciones, estado
        ) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id_arqueo;
      `;

      const result = await client.query(queryInsert, [
        id_sucursal,
        id_cajero,
        data.efectivo_contado,
        efectivo_sistema,
        diferencia,
        data.observaciones,
        estado,
      ]);

      const id_arqueo = result.rows[0].id_arqueo;

      // 2. ACTUALIZACIÓN CLAVE: Marcar todos los pagos sueltos de este cajero con este ID de arqueo
      // Esto hace que "desaparezcan" del próximo resumen de caja
      await client.query(
        `
        UPDATE pago 
        SET id_arqueo = $1 
        WHERE id_cajero = $2 
          AND DATE(fecha_pago) = CURRENT_DATE 
          AND id_arqueo IS NULL
      `,
        [id_arqueo, id_cajero],
      );

      await client.query("COMMIT");
      return id_arqueo;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}
