// services/ArqueoService.ts
import { Pool } from "pg";
import { ArqueoDTO } from "../dtos/ArqueoDTO";
import { EstadoArqueo } from "../types/arqueo.types";

export class ArqueoService {
  constructor(private readonly pool: Pool) {}

  async procesarCierreDeCaja(
    dto: ArqueoDTO & {
      id_cajero: number;
      id_sucursal: number;
      id_supervisor_verifica?: number;
    },
  ) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      // 1. Efectivo del sistema
      const queryResumen = `
        SELECT COALESCE(SUM(monto), 0) as total FROM pago
        WHERE id_cajero = $1 AND DATE(fecha_pago) = CURRENT_DATE AND metodo_pago = 'efectivo' AND id_arqueo IS NULL;
      `;
      const resResumen = await client.query(queryResumen, [dto.id_cajero]);
      const efectivoSistema = Number(resResumen.rows[0].total);

      // 2. Diferencia y Estado
      const diferencia = dto.efectivo_contado - efectivoSistema;
      const estado =
        diferencia === 0 ? EstadoArqueo.CUADRADO : EstadoArqueo.CON_DIFERENCIA;

      // 3. Guardar Arqueo
      const queryInsert = `
        INSERT INTO arqueo_caja (id_sucursal, id_cajero, id_supervisor_verifica, efectivo_contado, efectivo_segun_sistema, diferencia, observaciones, estado) 
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *;
      `;
      const result = await client.query(queryInsert, [
        dto.id_sucursal,
        dto.id_cajero,
        dto.id_supervisor_verifica || null,
        dto.efectivo_contado,
        efectivoSistema,
        diferencia,
        dto.observaciones,
        estado,
      ]);
      const arqueoRegistrado = result.rows[0];

      // 4. Actualizar pagos
      await client.query(
        `
        UPDATE pago SET id_arqueo = $1 
        WHERE id_cajero = $2 AND DATE(fecha_pago) = CURRENT_DATE AND id_arqueo IS NULL
      `,
        [arqueoRegistrado.id_arqueo, dto.id_cajero],
      );

      await client.query("COMMIT");

      return {
        exito: true,
        mensaje:
          estado === EstadoArqueo.CUADRADO
            ? "Arqueo cuadrado perfectamente."
            : `Arqueo con diferencia detectada de Q${diferencia.toFixed(2)}.`,
        data: arqueoRegistrado,
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}
