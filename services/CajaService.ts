// services/CajaService.ts
import { Pool } from "pg";
import { RegistrarPagoDTO } from "../dtos/RegistrarPagoDTO";

export class CajaService {
  constructor(private readonly pool: Pool) {}

  async obtenerPendientes(id_sucursal: number) {
    const result = await this.pool.query(
      `SELECT
         v.id_venta, v.estado, v.canal, v.total, v.pago_contra_entrega, v.created_at,
         COALESCE(c.nombre_razon_social, 'Consumidor Final') AS cliente
       FROM venta v
       LEFT JOIN cliente c ON v.id_cliente = c.id_cliente
       WHERE v.id_sucursal = $1
         AND v.estado IN ('pendiente_pago')
       ORDER BY v.created_at ASC`,
      [id_sucursal],
    );
    return result.rows.map((row) => ({ ...row, total: Number(row.total) }));
  }

  async registrarPago(id_cajero: number, data: RegistrarPagoDTO) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      const ventaRes = await client.query(
        "SELECT estado, total, pago_contra_entrega FROM venta WHERE id_venta = $1 FOR UPDATE",
        [data.id_venta],
      );

      if (ventaRes.rows.length === 0) throw new Error("Venta no encontrada");
      const venta = ventaRes.rows[0];

      if (venta.estado === "pagada")
        throw new Error("Esta orden ya fue pagada.");

      // Bloqueo contra entrega no confirmada
      if (venta.pago_contra_entrega) {
        const pedidoRes = await client.query(
          `SELECT estado FROM pedido_domicilio WHERE id_venta = $1`,
          [data.id_venta],
        );
        const pedido = pedidoRes.rows[0];
        if (!pedido || pedido.estado !== "entregado") {
          throw new Error(
            "Este pedido es pago contra entrega. Solo puede cobrarse una vez que el repartidor lo marque como entregado.",
          );
        }
      }

      if (data.monto < Number(venta.total)) {
        throw new Error(
          `El monto a pagar (Q${data.monto}) es menor al total de la orden (Q${venta.total}).`,
        );
      }

      await client.query(
        `INSERT INTO pago (id_venta, id_cajero, metodo_pago, monto, referencia)
       VALUES ($1, $2, $3, $4, $5)`,
        [
          data.id_venta,
          id_cajero,
          data.metodo_pago,
          data.monto,
          data.referencia,
        ],
      );

      await client.query(
        `UPDATE venta SET estado = 'pagada', updated_at = NOW() WHERE id_venta = $1`,
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

  async obtenerResumenDia(id_cajero: number) {
    const result = await this.pool.query(
      `SELECT metodo_pago, COALESCE(SUM(monto), 0) AS total
       FROM pago
       WHERE id_cajero = $1
         AND DATE(fecha_pago) = CURRENT_DATE
         AND id_arqueo IS NULL
       GROUP BY metodo_pago`,
      [id_cajero],
    );
    return result.rows.map((row) => ({
      metodo_pago: row.metodo_pago,
      total: Number(row.total),
    }));
  }

  async obtenerCobrosRepartidoresPendientes(id_sucursal: number) {
    const result = await this.pool.query(
      `SELECT
         p.id_pago,
         p.id_venta,
         p.id_repartidor,
         p.monto,
         p.fecha_pago,
         CONCAT(er.nombre, ' ', er.apellido)                    AS repartidor,
         COALESCE(c.nombre_razon_social, 'Consumidor Final')    AS cliente,
         d.direccion_texto                                       AS direccion_entrega
       FROM pago p
       JOIN venta            v  ON p.id_venta      = v.id_venta
       JOIN empleado         er ON p.id_repartidor = er.id_empleado
       LEFT JOIN cliente      c ON v.id_cliente    = c.id_cliente
       LEFT JOIN pedido_domicilio pd ON pd.id_venta       = v.id_venta
       LEFT JOIN destinatario     d  ON pd.id_destinatario = d.id_destinatario
       WHERE p.id_cajero IS NULL
         AND p.id_repartidor IS NOT NULL
         AND v.id_sucursal = $1
       ORDER BY p.fecha_pago ASC`,
      [id_sucursal],
    );
    return result.rows.map((r) => ({
      id_pago: r.id_pago,
      id_venta: r.id_venta,
      id_repartidor: r.id_repartidor,
      monto: Number(r.monto),
      fecha_pago: r.fecha_pago,
      repartidor: r.repartidor,
      cliente: r.cliente,
      direccion_entrega: r.direccion_entrega,
    }));
  }

  async liquidarRepartidor(
    id_cajero: number,
    id_repartidor: number,
    id_pagos: number[],
    id_sucursal: number,
  ) {
    if (!id_pagos.length) throw new Error("No se especificaron pagos.");

    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      const check = await client.query(
        `SELECT COUNT(*) AS total
         FROM pago p
         JOIN venta v ON p.id_venta = v.id_venta
         WHERE p.id_pago = ANY($1::int[])
           AND p.id_repartidor = $2
           AND p.id_cajero IS NULL
           AND v.id_sucursal = $3`,
        [id_pagos, id_repartidor, id_sucursal],
      );

      if (Number(check.rows[0].total) !== id_pagos.length)
        throw new Error(
          "Uno o más pagos no son válidos para liquidar (ya liquidados, de otro repartidor o de otra sucursal).",
        );

      await client.query(
        `UPDATE pago SET id_cajero = $1 WHERE id_pago = ANY($2::int[])`,
        [id_cajero, id_pagos],
      );

      const totalRes = await client.query(
        `SELECT COALESCE(SUM(monto), 0) AS total FROM pago WHERE id_pago = ANY($1::int[])`,
        [id_pagos],
      );

      await client.query("COMMIT");

      return {
        pagos_liquidados: id_pagos.length,
        total_recibido: Number(totalRes.rows[0].total),
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async obtenerHistorial(id_sucursal: number, desde?: string, hasta?: string) {
    const fechaDesde = desde ?? new Date().toISOString().split("T")[0];
    const fechaHasta = hasta ?? new Date().toISOString().split("T")[0];

    const resPagos = await this.pool.query(
      `SELECT
         p.id_pago, p.id_venta, p.fecha_pago, p.metodo_pago,
         p.monto, p.referencia,
         p.id_cajero, p.id_repartidor,
         COALESCE(c.nombre_razon_social, 'Consumidor Final') AS cliente,
         COALESCE(c.nit, 'CF')                               AS nit,
         c.direccion                                          AS direccion_cliente,
         CONCAT(ec.nombre, ' ', ec.apellido)                 AS cajero,
         CONCAT(er.nombre, ' ', er.apellido)                 AS repartidor,
         v.subtotal,
         COALESCE(v.descuento_monto, 0)                      AS descuento_monto,
         v.total
       FROM pago p
       JOIN venta v ON p.id_venta = v.id_venta
       LEFT JOIN cliente   c  ON v.id_cliente    = c.id_cliente
       LEFT JOIN empleado  ec ON p.id_cajero     = ec.id_empleado
       LEFT JOIN empleado  er ON p.id_repartidor = er.id_empleado
       WHERE v.id_sucursal = $1
         AND DATE(p.fecha_pago) BETWEEN $2 AND $3
       ORDER BY p.fecha_pago DESC`,
      [id_sucursal, fechaDesde, fechaHasta],
    );

    if (resPagos.rows.length === 0) return [];

    const idVentas = resPagos.rows.map((r) => r.id_venta);
    const resDetalles = await this.pool.query(
      `SELECT
         dv.id_venta, dv.id_producto,
         pr.nombre AS producto, pr.sku,
         dv.cantidad, dv.precio_unitario, dv.subtotal_linea, dv.monto_iva
       FROM detalle_venta dv
       JOIN producto pr ON dv.id_producto = pr.id_producto
       WHERE dv.id_venta = ANY($1::int[])`,
      [idVentas],
    );

    const detallesPorVenta: Record<number, any[]> = {};
    for (const d of resDetalles.rows) {
      if (!detallesPorVenta[d.id_venta]) detallesPorVenta[d.id_venta] = [];
      detallesPorVenta[d.id_venta].push({
        id_producto: d.id_producto,
        producto: d.producto,
        sku: d.sku,
        cantidad: Number(d.cantidad),
        precio_unitario: Number(d.precio_unitario),
        subtotal_linea: Number(d.subtotal_linea),
        monto_iva: Number(d.monto_iva),
      });
    }

    return resPagos.rows.map((r) => ({
      id_pago: r.id_pago,
      id_venta: r.id_venta,
      fecha_pago: r.fecha_pago,
      metodo_pago: r.metodo_pago,
      monto: Number(r.monto),
      referencia: r.referencia ?? null,
      cliente: r.cliente,
      nit: r.nit,
      direccion_cliente: r.direccion_cliente ?? null,
      cajero: r.cajero ?? null,
      repartidor: r.repartidor ?? null,
      es_cobro_ruta: !!r.id_repartidor,
      subtotal: Number(r.subtotal),
      descuento_monto: Number(r.descuento_monto),
      total: Number(r.total),
      detalles: detallesPorVenta[r.id_venta] ?? [],
    }));
  }
}
