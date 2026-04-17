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

  // Retorna { id_pedido, id_pago } — id_pago se usa para mostrar el comprobante
  async marcarExito(
    id_repartidor: number,
    data: MarcarEntregaExitosaDTO,
  ): Promise<{ id_pedido: number; id_pago: number | null }> {
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

      let id_pago: number | null = null;

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
        // RETURNING id_pago para devolverlo al frontend
        const pagoRes = await client.query(
          `
          INSERT INTO pago (id_venta, id_cajero, metodo_pago, monto, referencia)
          VALUES ($1, $2, 'efectivo', $3, 'Cobro en ruta por repartidor')
          RETURNING id_pago
        `,
          [pedido.id_venta, id_repartidor, data.monto_cobrado],
        );
        id_pago = pagoRes.rows[0].id_pago;
      }

      await client.query(
        `
        UPDATE pedido_domicilio 
        SET estado = 'entregado', fecha_entrega = NOW(), monto_cobrado_contra_entrega = $1 
        WHERE id_pedido = $2
      `,
        [data.monto_cobrado || 0, data.id_pedido],
      );

      await client.query("COMMIT");
      return { id_pedido: data.id_pedido, id_pago };
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

  // ─── NUEVO: Obtener comprobante por id_pago ───────────────────────────────
  // Solo accesible si el pago pertenece a un pedido de este repartidor
  async obtenerComprobante(id_pago: number, id_repartidor: number) {
    // 1. Verificar que el pago le pertenece (el repartidor hizo ese cobro)
    const seguridadRes = await this.pool.query(
      `
      SELECT p.id_pago, p.id_venta
      FROM pago p
      JOIN pedido_domicilio pd ON pd.id_venta = p.id_venta
      WHERE p.id_pago = $1 AND pd.id_repartidor = $2
      LIMIT 1
    `,
      [id_pago, id_repartidor],
    );

    if (seguridadRes.rows.length === 0) {
      throw new Error("Comprobante no encontrado o acceso no autorizado.");
    }

    const id_venta = seguridadRes.rows[0].id_venta;

    // 2. Traer datos de cabecera del pago (mismo formato que historial del cajero)
    const pagoRes = await this.pool.query(
      `
      SELECT
        p.id_pago,
        p.id_venta,
        p.fecha_pago,
        p.metodo_pago,
        p.monto,
        p.referencia,
        COALESCE(c.nombre_razon_social, 'Consumidor Final') AS cliente,
        COALESCE(c.nit, 'CF')                               AS nit,
        c.direccion                                          AS direccion_cliente,
        CONCAT(e.nombre, ' ', e.apellido)                   AS cajero,
        v.subtotal,
        COALESCE(v.descuento_monto, 0)                      AS descuento_monto,
        v.total
      FROM pago p
      JOIN venta v ON p.id_venta = v.id_venta
      LEFT JOIN cliente c ON v.id_cliente = c.id_cliente
      JOIN empleado e ON p.id_cajero = e.id_empleado
      WHERE p.id_pago = $1
    `,
      [id_pago],
    );

    if (pagoRes.rows.length === 0) throw new Error("Pago no encontrado.");
    const pago = pagoRes.rows[0];

    // 3. Traer detalles de la venta
    const detallesRes = await this.pool.query(
      `
      SELECT
        dv.id_venta,
        dv.id_producto,
        p.nombre        AS producto,
        p.sku,
        dv.cantidad,
        dv.precio_unitario,
        dv.subtotal_linea,
        dv.monto_iva
      FROM detalle_venta dv
      JOIN producto p ON dv.id_producto = p.id_producto
      WHERE dv.id_venta = $1
    `,
      [id_venta],
    );

    // 4. Ensamblar respuesta (estructura idéntica a HistorialCobro del cajero)
    return {
      id_pago: pago.id_pago,
      id_venta: pago.id_venta,
      fecha_pago: pago.fecha_pago,
      metodo_pago: pago.metodo_pago,
      monto: Number(pago.monto),
      referencia: pago.referencia,
      cliente: pago.cliente,
      nit: pago.nit,
      direccion_cliente: pago.direccion_cliente,
      cajero: pago.cajero,
      subtotal: Number(pago.subtotal ?? pago.total),
      descuento_monto: Number(pago.descuento_monto),
      total: Number(pago.total),
      detalles: detallesRes.rows.map((d) => ({
        id_producto: d.id_producto,
        producto: d.producto,
        sku: d.sku,
        cantidad: Number(d.cantidad),
        precio_unitario: Number(d.precio_unitario),
        subtotal_linea: Number(d.subtotal_linea),
        monto_iva: Number(d.monto_iva),
      })),
    };
  }
}
