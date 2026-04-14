import { Pool } from "pg";
import {
  MarcarEntregaExitosaDTO,
  MarcarEntregaFallidaDTO,
} from "../dtos/EntregaDTO";

export class EntregaService {
  constructor(private readonly pool: Pool) {}

  async obtenerMisPedidos(id_repartidor: number) {
    const query = `
      SELECT 
        pd.id_pedido, pd.id_venta, pd.direccion_entrega, pd.estado as estado_pedido, 
        pd.nombre_contacto, pd.telefono_contacto, v.total, v.pago_contra_entrega,
        (SELECT json_agg(json_build_object('producto', p.nombre, 'cantidad', dv.cantidad))
         FROM detalle_venta dv JOIN producto p ON dv.id_producto = p.id_producto WHERE dv.id_venta = v.id_venta) as productos
      FROM pedido_domicilio pd
      JOIN venta v ON pd.id_venta = v.id_venta
      WHERE pd.id_repartidor = $1 AND pd.estado = 'pendiente'
      ORDER BY pd.id_pedido ASC;
    `;
    const result = await this.pool.query(query, [id_repartidor]);
    return result.rows.map((row) => ({ ...row, total: Number(row.total) }));
  }

  async marcarExito(id_repartidor: number, data: MarcarEntregaExitosaDTO) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      const pedidoRes = await client.query(
        `
        SELECT pd.id_venta, pd.estado, v.pago_contra_entrega, v.total 
        FROM pedido_domicilio pd JOIN venta v ON pd.id_venta = v.id_venta
        WHERE pd.id_pedido = $1 AND pd.id_repartidor = $2 FOR UPDATE
      `,
        [data.id_pedido, id_repartidor],
      );

      if (pedidoRes.rows.length === 0)
        throw new Error(
          "Pedido no encontrado o no asignado a este repartidor.",
        );
      const pedido = pedidoRes.rows[0];
      if (pedido.estado !== "pendiente")
        throw new Error("El pedido ya fue procesado previamente.");

      if (pedido.pago_contra_entrega) {
        if (
          data.monto_cobrado === undefined ||
          data.monto_cobrado < Number(pedido.total)
        ) {
          throw new Error(
            `Debe registrar el cobro completo. El total es Q${pedido.total}`,
          );
        }
        await client.query(
          `UPDATE venta SET estado = 'pagada', updated_at = NOW() WHERE id_venta = $1`,
          [pedido.id_venta],
        );
        await client.query(
          `
          INSERT INTO pago (id_venta, id_cajero, metodo_pago, monto, referencia)
          VALUES ($1, $2, 'efectivo', $3, 'Cobro en ruta por repartidor')
        `,
          [pedido.id_venta, id_repartidor, data.monto_cobrado],
        );
      }

      await client.query(
        `
        UPDATE pedido_domicilio SET estado = 'entregado', fecha_entrega = NOW(), monto_cobrado_contra_entrega = $1 WHERE id_pedido = $2
      `,
        [data.monto_cobrado || 0, data.id_pedido],
      );

      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async marcarFallida(id_repartidor: number, data: MarcarEntregaFallidaDTO) {
    const query = `
      UPDATE pedido_domicilio SET estado = 'fallido', motivo_fallido = $1
      WHERE id_pedido = $2 AND id_repartidor = $3 AND estado = 'pendiente' RETURNING id_pedido;
    `;
    const res = await this.pool.query(query, [
      data.motivo_fallido,
      data.id_pedido,
      id_repartidor,
    ]);
    if (res.rows.length === 0) {
      throw new Error(
        "Pedido no encontrado, no asignado a este repartidor o ya procesado.",
      );
    }
  }
}
