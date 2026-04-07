import { Pool } from "pg";
import { IEntregaRepository } from "./IEntregaRepository";

export class EntregaRepository implements IEntregaRepository {
  private pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  async obtenerPedidosAsignados(id_repartidor: number): Promise<any[]> {
    // Usamos json_agg para traer los productos anidados dentro de la misma fila del pedido
    const query = `
      SELECT 
        pd.id_pedido, 
        pd.id_venta, 
        pd.direccion_entrega, 
        pd.estado as estado_pedido, 
        pd.nombre_contacto, 
        pd.telefono_contacto,
        v.total, 
        v.pago_contra_entrega,
        (
          SELECT json_agg(json_build_object(
            'producto', p.nombre,
            'cantidad', dv.cantidad
          ))
          FROM detalle_venta dv
          JOIN producto p ON dv.id_producto = p.id_producto
          WHERE dv.id_venta = v.id_venta
        ) as productos
      FROM pedido_domicilio pd
      JOIN venta v ON pd.id_venta = v.id_venta
      WHERE pd.id_repartidor = $1 AND pd.estado = 'pendiente'
      ORDER BY pd.id_pedido ASC;
    `;

    const result = await this.pool.query(query, [id_repartidor]);
    return result.rows.map((row) => ({
      ...row,
      total: Number(row.total),
    }));
  }

  async marcarComoEntregado(
    id_pedido: number,
    id_repartidor: number,
    monto_cobrado?: number,
  ): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      // 1. Validar el pedido
      const pedidoRes = await client.query(
        `
        SELECT pd.id_venta, pd.estado, v.pago_contra_entrega, v.total 
        FROM pedido_domicilio pd
        JOIN venta v ON pd.id_venta = v.id_venta
        WHERE pd.id_pedido = $1 AND pd.id_repartidor = $2 FOR UPDATE
      `,
        [id_pedido, id_repartidor],
      );

      if (pedidoRes.rows.length === 0)
        throw new Error(
          "Pedido no encontrado o no asignado a este repartidor.",
        );

      const pedido = pedidoRes.rows[0];
      if (pedido.estado !== "pendiente")
        throw new Error("El pedido ya fue procesado previamente.");

      // 2. Validar cobro si es contra entrega
      if (pedido.pago_contra_entrega) {
        if (
          monto_cobrado === undefined ||
          monto_cobrado < Number(pedido.total)
        ) {
          throw new Error(
            `Debe registrar el cobro completo. El total es Q${pedido.total}`,
          );
        }

        // Actualizar estado de la venta a pagada
        await client.query(
          `UPDATE venta SET estado = 'pagada', updated_at = NOW() WHERE id_venta = $1`,
          [pedido.id_venta],
        );

        // Registrar el pago usando al repartidor como el "cajero" que recibe el efectivo en ruta
        await client.query(
          `
          INSERT INTO pago (id_venta, id_cajero, metodo_pago, monto, referencia)
          VALUES ($1, $2, 'efectivo', $3, 'Cobro en ruta por repartidor')
        `,
          [pedido.id_venta, id_repartidor, monto_cobrado],
        );
      }

      // 3. Actualizar el pedido
      await client.query(
        `
        UPDATE pedido_domicilio 
        SET estado = 'entregado', fecha_entrega = NOW(), monto_cobrado_contra_entrega = $1
        WHERE id_pedido = $2
      `,
        [monto_cobrado || 0, id_pedido],
      );

      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async marcarComoFallido(
    id_pedido: number,
    id_repartidor: number,
    motivo: string,
  ): Promise<void> {
    const query = `
      UPDATE pedido_domicilio 
      SET estado = 'fallido', motivo_fallido = $1
      WHERE id_pedido = $2 AND id_repartidor = $3 AND estado = 'pendiente'
      RETURNING id_pedido;
    `;
    const res = await this.pool.query(query, [
      motivo,
      id_pedido,
      id_repartidor,
    ]);
    if (res.rows.length === 0) {
      throw new Error(
        "Pedido no encontrado, no asignado a este repartidor o ya procesado.",
      );
    }
  }
}
