// services/CajaService.ts
import { Pool } from "pg";
import { RegistrarPagoDTO } from "../dtos/RegistrarPagoDTO";

export class CajaService {
  constructor(private readonly pool: Pool) {}

  // ── Órdenes pendientes de cobro en mostrador ──────────────────────────────
  async obtenerPendientes(id_sucursal: number) {
    const result = await this.pool.query(
      `SELECT
         v.id_venta,
         ev.nombre                                             AS estado,
         cv.nombre                                             AS canal,
         v.total,
         v.pago_contra_entrega,
         v.created_at,
         COALESCE(c.nombre_razon_social, 'Consumidor Final')  AS cliente
       FROM venta v
       JOIN canal_venta  cv ON v.id_canal        = cv.id_canal
       JOIN estado_venta ev ON v.id_estado_venta = ev.id_estado_venta
       LEFT JOIN cliente  c ON v.id_cliente      = c.id_cliente
       WHERE v.id_sucursal         = $1
         AND ev.nombre             = 'pendiente_pago'
         AND v.pago_contra_entrega = false
       ORDER BY v.created_at ASC`,
      [id_sucursal],
    );
    return result.rows.map((row) => ({ ...row, total: Number(row.total) }));
  }

  // ── Registrar cobro (antes registrarPago) ─────────────────────────────────
  async registrarPago(id_cajero: number, data: RegistrarPagoDTO) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      // Leer estado de la venta via JOIN al catálogo
      const ventaRes = await client.query(
        `SELECT ev.nombre AS estado, v.total, v.pago_contra_entrega
         FROM venta v
         JOIN estado_venta ev ON v.id_estado_venta = ev.id_estado_venta
         WHERE v.id_venta = $1 FOR UPDATE`,
        [data.id_venta],
      );

      if (ventaRes.rows.length === 0) throw new Error("Venta no encontrada");
      const venta = ventaRes.rows[0];

      if (venta.estado === "pagada")
        throw new Error("Esta orden ya fue pagada.");

      // Para contra-entrega: el pedido debe estar entregado primero
      if (venta.pago_contra_entrega) {
        const pedidoRes = await client.query(
          `SELECT ep.nombre AS estado
           FROM pedido_domicilio pd
           JOIN estado_pedido ep ON pd.id_estado_pedido = ep.id_estado_pedido
           WHERE pd.id_venta = $1`,
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

      // Insertar en cobro (antes tabla pago)
      // metodo_pago → id_metodo_cobro vía subquery al catálogo
      await client.query(
        `INSERT INTO cobro
           (id_venta, id_cajero, id_metodo_cobro, monto, referencia, cobro_en_ruta)
         VALUES (
           $1, $2,
           (SELECT id_metodo_cobro FROM metodo_cobro WHERE nombre = $3),
           $4, $5, false
         )`,
        [
          data.id_venta,
          id_cajero,
          data.metodo_pago,
          data.monto,
          data.referencia ?? null,
        ],
      );

      // Marcar venta como pagada
      await client.query(
        `UPDATE venta
         SET id_estado_venta = (SELECT id_estado_venta FROM estado_venta WHERE nombre = 'pagada'),
             updated_at      = NOW()
         WHERE id_venta = $1`,
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

  // ── Resumen de cobros del día (para el arqueo) ────────────────────────────
  async obtenerResumenDia(id_cajero: number) {
    const result = await this.pool.query(
      `SELECT mc.nombre AS metodo_pago, COALESCE(SUM(c.monto), 0) AS total
       FROM cobro c
       JOIN metodo_cobro mc ON c.id_metodo_cobro = mc.id_metodo_cobro
       WHERE c.id_cajero        = $1
         AND DATE(c.fecha_cobro) = CURRENT_DATE
         AND c.id_arqueo        IS NULL
         AND c.activo            = true
       GROUP BY mc.nombre`,
      [id_cajero],
    );
    return result.rows.map((row) => ({
      metodo_pago: row.metodo_pago,
      total: Number(row.total),
    }));
  }

  // ── Cobros de repartidores pendientes de liquidar ─────────────────────────
  async obtenerCobrosRepartidoresPendientes(id_sucursal: number) {
    const result = await this.pool.query(
      `SELECT
         c.id_cobro                                           AS id_pago,
         c.id_venta,
         c.id_repartidor,
         c.monto,
         c.fecha_cobro                                        AS fecha_pago,
         CONCAT(er.nombre, ' ', er.apellido)                  AS repartidor,
         COALESCE(cl.nombre_razon_social, 'Consumidor Final') AS cliente,
         d.direccion_texto                                    AS direccion_entrega
       FROM cobro c
       JOIN venta              v  ON c.id_venta         = v.id_venta
       JOIN empleado           er ON c.id_repartidor    = er.id_empleado
       LEFT JOIN cliente       cl ON v.id_cliente       = cl.id_cliente
       LEFT JOIN pedido_domicilio pd ON pd.id_venta     = v.id_venta
       LEFT JOIN destinatario  d  ON pd.id_destinatario = d.id_destinatario
       WHERE c.id_cajero    IS NULL
         AND c.cobro_en_ruta = true
         AND c.activo        = true
         AND v.id_sucursal   = $1
       ORDER BY c.fecha_cobro ASC`,
      [id_sucursal],
    );
    return result.rows.map((r) => ({
      id_pago: r.id_pago, // alias de id_cobro para compat. frontend
      id_venta: r.id_venta,
      id_repartidor: r.id_repartidor,
      monto: Number(r.monto),
      fecha_pago: r.fecha_pago, // alias de fecha_cobro
      repartidor: r.repartidor,
      cliente: r.cliente,
      direccion_entrega: r.direccion_entrega,
    }));
  }

  // ── Liquidar cobros de un repartidor ──────────────────────────────────────
  async liquidarRepartidor(
    id_cajero: number,
    id_repartidor: number,
    id_pagos: number[], // contiene id_cobro — alias mantenido para compat. frontend
    id_sucursal: number,
  ) {
    if (!id_pagos.length) throw new Error("No se especificaron cobros.");

    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      // Validar que todos los cobros son del repartidor, están pendientes
      // y pertenecen a esta sucursal
      const check = await client.query(
        `SELECT COUNT(*) AS total
         FROM cobro c
         JOIN venta v ON c.id_venta = v.id_venta
         WHERE c.id_cobro      = ANY($1::int[])
           AND c.id_repartidor = $2
           AND c.id_cajero    IS NULL
           AND c.activo        = true
           AND v.id_sucursal   = $3`,
        [id_pagos, id_repartidor, id_sucursal],
      );

      if (Number(check.rows[0].total) !== id_pagos.length)
        throw new Error(
          "Uno o más cobros no son válidos para liquidar (ya liquidados, de otro repartidor o de otra sucursal).",
        );

      await client.query(
        `UPDATE cobro SET id_cajero = $1 WHERE id_cobro = ANY($2::int[])`,
        [id_cajero, id_pagos],
      );

      const totalRes = await client.query(
        `SELECT COALESCE(SUM(monto), 0) AS total FROM cobro WHERE id_cobro = ANY($1::int[])`,
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

  // ── Historial de cobros ───────────────────────────────────────────────────
  async obtenerHistorial(id_sucursal: number, desde?: string, hasta?: string) {
    const fechaDesde = desde ?? new Date().toISOString().split("T")[0];
    const fechaHasta = hasta ?? new Date().toISOString().split("T")[0];

    const resCobros = await this.pool.query(
      `SELECT
         c.id_cobro                                           AS id_pago,
         c.id_venta,
         c.fecha_cobro                                        AS fecha_pago,
         mc.nombre                                            AS metodo_pago,
         c.monto,
         c.referencia,
         c.id_cajero,
         c.id_repartidor,
         c.cobro_en_ruta                                      AS es_cobro_ruta,
         COALESCE(cl.nombre_razon_social, 'Consumidor Final') AS cliente,
         COALESCE(cl.nit, 'CF')                               AS nit,
         cl.direccion                                         AS direccion_cliente,
         CONCAT(ec.nombre, ' ', ec.apellido)                  AS cajero,
         CONCAT(er.nombre, ' ', er.apellido)                  AS repartidor,
         v.subtotal,
         COALESCE(v.descuento_monto, 0)                       AS descuento_monto,
         v.total
       FROM cobro c
       JOIN venta        v  ON c.id_venta        = v.id_venta
       JOIN metodo_cobro mc ON c.id_metodo_cobro = mc.id_metodo_cobro
       LEFT JOIN cliente  cl ON v.id_cliente     = cl.id_cliente
       LEFT JOIN empleado ec ON c.id_cajero      = ec.id_empleado
       LEFT JOIN empleado er ON c.id_repartidor  = er.id_empleado
       WHERE v.id_sucursal         = $1
         AND DATE(c.fecha_cobro)  BETWEEN $2 AND $3
         AND c.activo              = true
       ORDER BY c.fecha_cobro DESC`,
      [id_sucursal, fechaDesde, fechaHasta],
    );

    if (resCobros.rows.length === 0) return [];

    const idVentas = resCobros.rows.map((r) => r.id_venta);
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

    return resCobros.rows.map((r) => ({
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
      es_cobro_ruta: r.es_cobro_ruta,
      subtotal: Number(r.subtotal),
      descuento_monto: Number(r.descuento_monto),
      total: Number(r.total),
      detalles: detallesPorVenta[r.id_venta] ?? [],
    }));
  }
}
