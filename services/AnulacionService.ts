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

      //Obtener y bloquear la venta
      const ventaRes = await client.query(
        `SELECT v.id_venta, v.id_sucursal, v.estado, v.total
        FROM venta v
        WHERE v.id_venta = $1
        FOR UPDATE`,
        [data.id_venta],
      );

      if (ventaRes.rows.length === 0) throw new Error("Venta no encontrada.");

      const venta = ventaRes.rows[0];

      if (data.monto_devolucion !== undefined && data.monto_devolucion !== 0) {
        if (data.monto_devolucion < 0)
          throw new Error("El monto a devolver no puede ser negativo.");

        if (data.monto_devolucion > Number(venta.total))
          throw new Error(
            `El monto a devolver (Q${data.monto_devolucion.toFixed(2)}) no puede superar el total de la venta (Q${Number(venta.total).toFixed(2)}).`,
          );
      }

      if (venta.estado === "anulada")
        throw new Error("Esta venta ya se encuentra anulada.");

      //Marcar la venta como anulada
      await client.query(
        `UPDATE venta
         SET estado           = 'anulada',
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

      //Anular pagos activos asociados
      await client.query(
        `UPDATE pago
         SET activo     = false,
             updated_at = NOW()
         WHERE id_venta = $1
           AND activo   = true`,
        [data.id_venta],
      );

      //Cancelar pedido de domicilio si está pendiente
      await client.query(
        `UPDATE pedido_domicilio
         SET estado     = 'cancelado',
             updated_at = NOW()
         WHERE id_venta = $1
           AND estado   = 'pendiente'`,
        [data.id_venta],
      );

      //Reintegrar stock por cada detalle de la venta
      //reemplaza JOIN inventario_sucursal con JOIN producto_sucursal.
      //Ya no se lee ni actualiza cantidad_actual en ninguna tabla agregada.
      const detallesRes = await client.query(
        `SELECT
           dv.id_detalle,
           dv.id_producto,
           dv.cantidad,
           dv.id_producto_reacondicionado,
           ps.id_producto_sucursal
         FROM detalle_venta dv
         JOIN producto_sucursal ps
           ON dv.id_producto  = ps.id_producto
          AND ps.id_sucursal  = $1
          AND ps.activo       = TRUE
         WHERE dv.id_venta = $2
           AND dv.activo   = true
         FOR UPDATE OF ps`,
        [venta.id_sucursal, data.id_venta],
      );

      for (const det of detallesRes.rows) {
        const cantidadDevuelta = Number(det.cantidad);
        const id_producto_sucursal = det.id_producto_sucursal;

        //Stock actual desde lote_detalle (antes del reintegro)
        const stockRes = await client.query(
          `SELECT COALESCE(SUM(cantidad_actual), 0) AS stock
           FROM lote_detalle
           WHERE id_producto = $1
             AND id_sucursal = $2
             AND agotado = FALSE
             AND activo  = TRUE`,
          [det.id_producto, venta.id_sucursal],
        );
        const cantidadResultante =
          Number(stockRes.rows[0].stock) + cantidadDevuelta;

        //Registrar movimiento de inventario para trazabilidad
        const movRes = await client.query(
          `INSERT INTO movimiento_inventario
             (id_producto_sucursal, id_usuario, tipo, cantidad, cantidad_resultante,
              id_referencia, tabla_referencia, motivo)
           VALUES ($1, $2, 'ajuste_positivo', $3, $4, $5, 'venta',
                   'Reintegro por anulación de venta')
           RETURNING id_movimiento`,
          [
            id_producto_sucursal,
            data.id_usuario,
            cantidadDevuelta,
            cantidadResultante,
            data.id_venta,
          ],
        );

        //Solo para productos normales (no reacondicionados):
        //crear un lote de reingreso con el costo del proveedor principal.
        if (!det.id_producto_reacondicionado) {
          const costoRes = await client.query(
            `SELECT COALESCE(
               (SELECT precio_costo
                FROM   producto_proveedor
                WHERE  id_producto  = $1
                  AND  es_principal = TRUE
                  AND  activo       = TRUE
                LIMIT 1),
               0.00
             ) AS costo_unitario`,
            [det.id_producto],
          );

          const costoUnitario = Number(costoRes.rows[0].costo_unitario);

          const loteRes = await client.query(
            `INSERT INTO lote_inventario
               (id_orden_compra, es_apertura)
             VALUES (NULL, false)
             RETURNING id_lote`,
          );
          const id_lote = loteRes.rows[0].id_lote;

          await client.query(
            `INSERT INTO lote_detalle
               (id_lote, id_producto, id_sucursal, costo_unitario,
                cantidad_inicial, cantidad_actual)
             VALUES ($1, $2, $3, $4, $5, $5)`,
            [
              id_lote,
              det.id_producto,
              venta.id_sucursal,
              costoUnitario,
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

  //Obtener datos enriquecidos de una venta para el detalle en frontend ────
  async obtenerDatosAnulacion(id_venta: number) {
    const res = await this.pool.query(
      `SELECT
         v.id_venta,
         v.estado,
         v.motivo_anulacion,
         v.monto_devolucion,
         v.updated_at          AS fecha_anulacion,
         CONCAT(e.nombre, ' ', e.apellido) AS anulado_por
       FROM venta v
       LEFT JOIN empleado e ON v.id_anulado_por = e.id_empleado
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

      //Verificar que existe el pedido fallido para esta venta
      const pedidoRes = await client.query(
        `SELECT pd.id_pedido, v.id_sucursal, v.estado
         FROM pedido_domicilio pd
         JOIN venta v ON pd.id_venta = v.id_venta
         WHERE pd.id_venta = $1
           AND pd.estado   = 'fallido'
         FOR UPDATE`,
        [id_venta],
      );

      if (pedidoRes.rows.length === 0)
        throw new Error("No se encontró un pedido fallido para esta venta.");

      const { id_pedido, id_sucursal, estado: estadoVenta } = pedidoRes.rows[0];

      //Verificar que la venta sigue en estado entregable
      const estadosValidos = ["pagada", "pendiente_cobro_contra_entrega"];
      if (!estadosValidos.includes(estadoVenta))
        throw new Error(
          `La venta está en estado '${estadoVenta}' y no puede reagendarse.`,
        );

      //Verificar que el repartidor existe, pertenece a la sucursal y está activo
      const repRes = await client.query(
        `SELECT e.id_empleado
         FROM empleado e
         JOIN puesto p ON e.id_puesto = p.id_puesto
         WHERE e.id_empleado = $1
           AND e.id_sucursal = $2
           AND e.activo      = true
           AND p.nombre ILIKE '%repartidor%'`,
        [id_repartidor_nuevo, id_sucursal],
      );

      if (repRes.rows.length === 0)
        throw new Error(
          "El repartidor seleccionado no existe o no pertenece a esta sucursal.",
        );

      //Resetear el pedido — como si fuera nuevo
      await client.query(
        `UPDATE pedido_domicilio
         SET estado         = 'pendiente',
             id_repartidor  = $1,
             motivo_fallido = NULL,
             fecha_entrega  = NULL,
             updated_at     = NOW()
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
