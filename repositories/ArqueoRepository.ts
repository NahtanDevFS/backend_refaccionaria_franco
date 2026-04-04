// repositories/ArqueoRepository.ts
import { Pool } from "pg";
import { GenerarArqueoDTO } from "../dtos/ArqueoDTO";

export class ArqueoRepository {
  constructor(private readonly pool: Pool) {}

  /**
   * Obtiene la suma total de efectivo recibido por un cajero en el día actual.
   */
  async obtenerEfectivoDelDiaPorCajero(id_cajero: number): Promise<number> {
    const query = `
      SELECT COALESCE(SUM(monto), 0) AS total_efectivo
      FROM pago
      WHERE id_cajero = $1 
        AND metodo_pago = 'efectivo'
        AND DATE(fecha_pago) = CURRENT_DATE;
    `;

    try {
      const result = await this.pool.query(query, [id_cajero]);
      return Number(result.rows[0].total_efectivo);
    } catch (error) {
      throw new Error(
        `Error al calcular el efectivo del sistema: ${(error as Error).message}`,
      );
    }
  }

  /**
   * Registra el acta de arqueo en la base de datos.
   */
  async guardarArqueo(
    data: GenerarArqueoDTO,
    efectivo_sistema: number,
    diferencia: number,
    estado: string,
  ): Promise<any> {
    const query = `
      INSERT INTO arqueo_caja (
        id_sucursal, id_cajero, id_supervisor_verifica, 
        efectivo_contado, efectivo_segun_sistema, diferencia, 
        observaciones, estado, fecha_cierre
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CURRENT_DATE)
      RETURNING *;
    `;

    const values = [
      data.id_sucursal,
      data.id_cajero,
      data.id_supervisor_verifica,
      data.efectivo_contado,
      efectivo_sistema,
      diferencia,
      data.observaciones || null,
      estado,
    ];

    try {
      const result = await this.pool.query(query, values);
      return result.rows[0];
    } catch (error) {
      throw new Error(
        `Error al guardar el registro del arqueo: ${(error as Error).message}`,
      );
    }
  }
}
