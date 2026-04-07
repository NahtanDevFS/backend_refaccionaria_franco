// repositories/PagoRepository.ts

import { Pool } from "pg";
import { IPagoRepository } from "./IPagoRepository";
import { RegistrarPagoDTO } from "../dtos/RegistrarPagoDTO";

export class PagoRepository implements IPagoRepository {
  private pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  async obtenerPendientesDePago(id_sucursal: number): Promise<any[]> {
    const query = `
      SELECT 
        v.id_venta, 
        v.estado, 
        v.total, 
        v.pago_contra_entrega,
        v.created_at,
        COALESCE(c.nombre_razon_social, 'Consumidor Final') as cliente
      FROM venta v
      LEFT JOIN cliente c ON v.id_cliente = c.id_cliente
      WHERE v.id_sucursal = $1 
        AND v.estado IN ('pendiente_pago', 'pendiente_cobro_contra_entrega')
      ORDER BY v.created_at ASC;
    `;
    const result = await this.pool.query(query, [id_sucursal]);
    return result.rows.map((row) => ({
      ...row,
      total: Number(row.total),
    }));
  }

  async registrarPago(
    id_cajero: number,
    data: RegistrarPagoDTO,
  ): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      // 1. Validar la venta
      const ventaRes = await client.query(
        "SELECT estado, total FROM venta WHERE id_venta = $1 FOR UPDATE",
        [data.id_venta],
      );

      if (ventaRes.rows.length === 0) throw new Error("Venta no encontrada");

      const venta = ventaRes.rows[0];
      if (venta.estado === "pagada")
        throw new Error("Esta orden ya fue pagada.");

      if (data.monto < Number(venta.total)) {
        throw new Error(
          `El monto a pagar (Q${data.monto}) es menor al total de la orden (Q${venta.total}).`,
        );
      }

      // 2. Registrar el pago
      await client.query(
        `
        INSERT INTO pago (id_venta, id_cajero, metodo_pago, monto, referencia)
        VALUES ($1, $2, $3, $4, $5)
      `,
        [
          data.id_venta,
          id_cajero,
          data.metodo_pago,
          data.monto,
          data.referencia,
        ],
      );

      // 3. Actualizar estado de la venta
      await client.query(
        `
        UPDATE venta SET estado = 'pagada', updated_at = NOW() WHERE id_venta = $1
      `,
        [data.id_venta],
      );

      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}
