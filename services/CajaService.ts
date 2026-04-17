// services/CajaService.ts
import { Pool } from "pg";
import { RegistrarPagoDTO } from "../dtos/RegistrarPagoDTO";

export class CajaService {
  constructor(private readonly pool: Pool) {}

  async obtenerPendientes(id_sucursal: number) {
    const query = `
      SELECT 
        v.id_venta, v.estado, v.total, v.pago_contra_entrega, v.created_at,
        COALESCE(c.nombre_razon_social, 'Consumidor Final') as cliente
      FROM venta v
      LEFT JOIN cliente c ON v.id_cliente = c.id_cliente
      WHERE v.id_sucursal = $1 
        AND v.estado IN ('pendiente_pago', 'pendiente_cobro_contra_entrega')
      ORDER BY v.created_at ASC;
    `;
    const result = await this.pool.query(query, [id_sucursal]);
    return result.rows.map((row) => ({ ...row, total: Number(row.total) }));
  }

  async registrarPago(id_cajero: number, data: RegistrarPagoDTO) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      const ventaRes = await client.query(
        "SELECT estado, total FROM venta WHERE id_venta = $1 FOR UPDATE",
        [data.id_venta],
      );

      if (ventaRes.rows.length === 0) throw new Error("Venta no encontrada");
      const venta = ventaRes.rows[0];

      if (venta.estado === "pagada")
        throw new Error("Esta orden ya fue pagada.");
      if (data.monto < Number(venta.total))
        throw new Error(
          `El monto (Q${data.monto}) es menor al total (Q${venta.total}).`,
        );

      await client.query(
        `INSERT INTO pago (id_venta, id_cajero, metodo_pago, monto, referencia)
         VALUES ($1,$2,$3,$4,$5)`,
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
      `SELECT metodo_pago, COALESCE(SUM(monto), 0) as total
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

  // ─── Historial de cobros (pagos individuales para facturación) ────────────
  async obtenerHistorial(id_sucursal: number, desde?: string, hasta?: string) {
    const fechaDesde = desde ?? new Date().toISOString().split("T")[0];
    const fechaHasta = hasta ?? new Date().toISOString().split("T")[0];

    const resPagos = await this.pool.query(
      `SELECT
         p.id_pago, p.id_venta, p.fecha_pago, p.metodo_pago, p.monto, p.referencia,
         COALESCE(c.nombre_razon_social, 'Consumidor Final') AS cliente,
         COALESCE(c.nit, 'CF')                               AS nit,
         c.direccion                                          AS direccion_cliente,
         CONCAT(e.nombre, ' ', e.apellido)                   AS cajero,
         v.subtotal,
         COALESCE(v.descuento_monto, 0)                      AS descuento_monto,
         v.total
       FROM pago p
       JOIN venta   v ON p.id_venta   = v.id_venta
       LEFT JOIN cliente c ON v.id_cliente = c.id_cliente
       JOIN empleado e ON p.id_cajero  = e.id_empleado
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
         p.nombre AS producto, p.sku,
         dv.cantidad, dv.precio_unitario, dv.subtotal_linea, dv.monto_iva
       FROM detalle_venta dv
       JOIN producto p ON dv.id_producto = p.id_producto
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
      cajero: r.cajero,
      subtotal: Number(r.subtotal),
      descuento_monto: Number(r.descuento_monto),
      total: Number(r.total),
      detalles: detallesPorVenta[r.id_venta] ?? [],
    }));
  }
}
