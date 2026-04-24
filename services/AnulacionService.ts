// services/AnulacionService.ts
import { Pool } from "pg";

export interface AnularVentaDTO {
  id_venta: number;
  id_usuario: number;
  motivo_anulacion: string;
  monto_devolucion?: number;
}

export class AnulacionService {
  constructor(private readonly pool: Pool) {}

  async anularVenta(data: AnularVentaDTO): Promise<{ id_venta: number }> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      const ventaRes = await client.query(
        `SELECT v.id_venta, v.id_sucursal, ev.nombre AS estado, v.total
         FROM venta v
         JOIN estado_venta ev ON v.id_estado_venta = ev.id_estado_venta
         WHERE v.id_venta = $1 FOR UPDATE`,
        [data.id_venta],
      );

      if (ventaRes.rows.length === 0) throw new Error("Venta no encontrada.");
      const venta = ventaRes.rows[0];

      if (data.monto_devolucion !== undefined && data.monto_devolucion !== 0) {
        if (data.monto_devolucion < 0)
          throw new Error("El monto a devolver no puede ser negativo.");
        if (data.monto_devolucion > Number(venta.total))
          throw new Error(
            `El monto a devolver (Q${data.monto_devolucion.toFixed(2)}) no puede superar el total (Q${Number(venta.total).toFixed(2)}).`,
          );
      }

      if (venta.estado === "anulada")
        throw new Error("Esta venta ya se encuentra anulada.");

      await client.query(
        `UPDATE venta
         SET id_estado_venta = (SELECT id_estado_venta FROM estado_venta WHERE nombre = 'anulada'),
             id_anulado_por   = $1,
             motivo_anulacion = $2,
             monto_devolucion = $3,
             updated_at       = NOW()
         WHERE id_venta = $4`,
        [
          data.id_usuario,
          data.motivo_anulacion,
          data.monto_devolucion ?? 0,
          data.id_venta,
        ],
      );

      // Anular cobros activos (antes UPDATE pago)
      await client.query(
        `UPDATE cobro SET activo = false, updated_at = NOW()
         WHERE id_venta = $1 AND activo = true`,
        [data.id_venta],
      );

      // Cancelar pedido de domicilio pendiente
      await client.query(
        `UPDATE pedido_domicilio
         SET id_estado_pedido = (SELECT id_estado_pedido FROM estado_pedido WHERE nombre = 'cancelado'),
             updated_at = NOW()
         WHERE id_venta = $1
           AND id_estado_pedido = (SELECT id_estado_pedido FROM estado_pedido WHERE nombre = 'pendiente')`,
        [data.id_venta],
      );

      // Reintegrar stock — reorden_producto_sucursal reemplaza producto_sucursal
      const detallesRes = await client.query(
        `SELECT dv.id_detalle, dv.id_producto, dv.cantidad,
                dv.id_producto_reacondicionado, rps.id_reorden
         FROM detalle_venta dv
         JOIN reorden_producto_sucursal rps
           ON dv.id_producto  = rps.id_producto
          AND rps.id_sucursal = $1
          AND rps.activo      = TRUE
         WHERE dv.id_venta = $2 AND dv.activo = true
         FOR UPDATE OF rps`,
        [venta.id_sucursal, data.id_venta],
      );

      for (const det of detallesRes.rows) {
        const cantidadDevuelta = Number(det.cantidad);

        const stockRes = await client.query(
          `SELECT COALESCE(SUM(cantidad_actual), 0) AS stock
           FROM lote_detalle
           WHERE id_producto = $1 AND id_sucursal = $2
             AND agotado = FALSE AND activo = TRUE`,
          [det.id_producto, venta.id_sucursal],
        );
        const cantidadResultante =
          Number(stockRes.rows[0].stock) + cantidadDevuelta;

        // id_reorden reemplaza id_producto_sucursal
        // id_tipo_movimiento (FK) reemplaza tipo (VARCHAR)
        const movRes = await client.query(
          `INSERT INTO movimiento_inventario
             (id_reorden, id_usuario, id_tipo_movimiento, cantidad,
              cantidad_resultante, id_referencia, tabla_referencia, motivo)
           VALUES (
             $1, $2,
             (SELECT id_tipo_movimiento FROM tipo_movimiento_inventario WHERE nombre = 'ajuste_positivo'),
             $3, $4, $5, 'venta', 'Reintegro por anulación de venta'
           ) RETURNING id_movimiento`,
          [
            det.id_reorden,
            data.id_usuario,
            cantidadDevuelta,
            cantidadResultante,
            data.id_venta,
          ],
        );

        if (!det.id_producto_reacondicionado) {
          // producto_proveedor eliminado en v2 — costo desde último lote activo
          const costoRes = await client.query(
            `SELECT COALESCE(
               (SELECT costo_unitario FROM lote_detalle
                WHERE id_producto = $1 AND id_sucursal = $2 AND activo = TRUE
                ORDER BY fecha_ingreso DESC LIMIT 1),
               0.00) AS costo_unitario`,
            [det.id_producto, venta.id_sucursal],
          );

          // lote_inventario ya no tiene id_orden_compra en v2
          const loteRes = await client.query(
            `INSERT INTO lote_inventario (es_apertura) VALUES (false) RETURNING id_lote`,
          );

          await client.query(
            `INSERT INTO lote_detalle
               (id_lote, id_producto, id_sucursal, costo_unitario,
                cantidad_inicial, cantidad_actual)
             VALUES ($1,$2,$3,$4,$5,$5)`,
            [
              loteRes.rows[0].id_lote,
              det.id_producto,
              venta.id_sucursal,
              Number(costoRes.rows[0].costo_unitario),
              cantidadDevuelta,
            ],
          );
        }
      }

      await client.query("COMMIT");
      return { id_venta: data.id_venta };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async obtenerDatosAnulacion(id_venta: number) {
    const res = await this.pool.query(
      `SELECT v.id_venta, ev.nombre AS estado, v.motivo_anulacion,
              v.monto_devolucion, v.updated_at AS fecha_anulacion,
              CONCAT(e.nombre, ' ', e.apellido) AS anulado_por
       FROM venta v
       JOIN estado_venta ev ON v.id_estado_venta = ev.id_estado_venta
       LEFT JOIN empleado e ON v.id_anulado_por  = e.id_empleado
       WHERE v.id_venta = $1`,
      [id_venta],
    );
    if (res.rows.length === 0) return null;
    return res.rows[0];
  }

  async reagendarEntrega(
    id_venta: number,
    id_repartidor_nuevo: number,
    id_usuario: number,
  ): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      const pedidoRes = await client.query(
        `SELECT pd.id_pedido, v.id_sucursal, ev.nombre AS estado_venta
          FROM pedido_domicilio pd
          JOIN venta         v  ON pd.id_venta         = v.id_venta
          JOIN estado_venta  ev ON v.id_estado_venta   = ev.id_estado_venta
          JOIN estado_pedido ep ON pd.id_estado_pedido  = ep.id_estado_pedido
          WHERE pd.id_venta = $1 AND ep.nombre = 'fallido'
          FOR UPDATE`,
        [id_venta],
      );

      if (pedidoRes.rows.length === 0)
        throw new Error("No se encontró un pedido fallido para esta venta.");

      const { id_pedido, id_sucursal, estado_venta } = pedidoRes.rows[0];

      if (!["pagada", "pendiente_cobro_contra_entrega"].includes(estado_venta))
        throw new Error(
          `La venta está en estado '${estado_venta}' y no puede reagendarse.`,
        );

      // Verificar repartidor — antes usaba puesto, ahora usa rol
      const repRes = await client.query(
        `SELECT e.id_empleado
         FROM empleado e
         INNER JOIN usuario u ON u.id_empleado = e.id_empleado
         INNER JOIN rol     r ON u.id_rol      = r.id_rol
         WHERE e.id_empleado = $1
           AND e.id_sucursal = $2
           AND e.activo      = true
           AND r.nombre      = 'REPARTIDOR'`,
        [id_repartidor_nuevo, id_sucursal],
      );

      if (repRes.rows.length === 0)
        throw new Error(
          "El repartidor seleccionado no existe o no pertenece a esta sucursal.",
        );

      await client.query(
        `UPDATE pedido_domicilio
         SET id_estado_pedido = (SELECT id_estado_pedido FROM estado_pedido WHERE nombre = 'pendiente'),
             id_repartidor    = $1,
             motivo_fallido   = NULL,
             fecha_entrega    = NULL,
             updated_at       = NOW()
         WHERE id_pedido = $2`,
        [id_repartidor_nuevo, id_pedido],
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
