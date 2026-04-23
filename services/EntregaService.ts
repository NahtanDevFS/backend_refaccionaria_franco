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
        pd.id_pedido,
        pd.id_venta,
        pd.estado                       AS estado_pedido,
        pd.fecha_visto_cancelacion,
        d.direccion_texto               AS direccion_entrega,
        d.nombre                        AS nombre_contacto,
        d.telefono                      AS telefono_contacto,
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
        ) AS productos
      FROM pedido_domicilio pd
      JOIN venta        v ON pd.id_venta        = v.id_venta
      JOIN destinatario d ON pd.id_destinatario = d.id_destinatario
      WHERE pd.id_repartidor = $1
        AND (
          -- Pedidos activos en ruta (lógica original intacta)
          (
            pd.estado = 'pendiente'
            AND (
              (v.pago_contra_entrega = true AND v.estado IN ('pendiente_cobro_contra_entrega', 'pendiente_pago'))
              OR
              (v.pago_contra_entrega = false AND v.estado = 'pagada')
            )
          )
          OR
          -- Pedidos cancelados que el repartidor aún NO ha confirmado ver
          (
            pd.estado = 'cancelado'
            AND pd.fecha_visto_cancelacion IS NULL
          )
        )
      ORDER BY
        -- Los cancelados aparecen primero para que el repartidor los note
        CASE pd.estado WHEN 'cancelado' THEN 0 ELSE 1 END ASC,
        pd.id_pedido ASC;
    `;

    const result = await this.pool.query(query, [id_repartidor]);
    return result.rows.map((row) => ({ ...row, total: Number(row.total) }));
  }

  async confirmarCancelacion(id_repartidor: number, id_pedido: number) {
    const result = await this.pool.query(
      `UPDATE pedido_domicilio
       SET fecha_visto_cancelacion = NOW(),
           updated_at              = NOW()
       WHERE id_pedido      = $1
         AND id_repartidor  = $2
         AND estado         = 'cancelado'
         AND fecha_visto_cancelacion IS NULL
       RETURNING id_pedido`,
      [id_pedido, id_repartidor],
    );

    if (result.rowCount === 0)
      throw new Error(
        "Pedido no encontrado, no cancelado, o ya fue confirmado.",
      );

    return { id_pedido };
  }

  async marcarExito(id_repartidor: number, data: MarcarEntregaExitosaDTO) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      const pedidoRes = await client.query(
        `SELECT pd.id_venta, pd.estado, v.pago_contra_entrega, v.total, v.id_sucursal
         FROM pedido_domicilio pd
         JOIN venta v ON pd.id_venta = v.id_venta
         WHERE pd.id_pedido = $1 AND pd.id_repartidor = $2
         FOR UPDATE`,
        [data.id_pedido, id_repartidor],
      );

      if (pedidoRes.rows.length === 0)
        throw new Error(
          "Pedido no encontrado o no asignado a este repartidor.",
        );

      const pedido = pedidoRes.rows[0];

      if (pedido.estado !== "pendiente")
        throw new Error("El pedido ya fue procesado previamente.");

      let id_pago_generado = null;

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

        const pagoInsert = await client.query(
          `INSERT INTO pago
             (id_venta, id_cajero, id_repartidor, metodo_pago, monto, referencia)
           VALUES ($1, NULL, $2, 'efectivo', $3, 'Cobro en ruta por repartidor')
           RETURNING id_pago`,
          [pedido.id_venta, id_repartidor, data.monto_cobrado],
        );
        id_pago_generado = pagoInsert.rows[0].id_pago;
      }

      await client.query(
        `UPDATE pedido_domicilio
         SET estado = 'entregado', fecha_entrega = NOW(), monto_cobrado_contra_entrega = $1
         WHERE id_pedido = $2`,
        [data.monto_cobrado || 0, data.id_pedido],
      );

      await client.query("COMMIT");

      return { id_pago: id_pago_generado };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async marcarFallida(id_repartidor: number, data: MarcarEntregaFallidaDTO) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      // Verificar que el pedido existe, pertenece al repartidor y está pendiente
      const pedidoRes = await client.query(
        `SELECT pd.id_pedido, pd.id_venta
         FROM pedido_domicilio pd
         JOIN venta v ON pd.id_venta = v.id_venta
         WHERE pd.id_pedido    = $1
           AND pd.id_repartidor = $2
           AND pd.estado        = 'pendiente'
         FOR UPDATE`,
        [data.id_pedido, id_repartidor],
      );

      if (pedidoRes.rows.length === 0)
        throw new Error(
          "Pedido no encontrado, no asignado a este repartidor o ya procesado.",
        );

      // Solo marcar el pedido como fallido — la venta NO se toca.
      // El supervisor verá la venta en su estado original y decidirá
      // si anularla, reasignarla o dejarla pendiente.
      await client.query(
        `UPDATE pedido_domicilio
         SET estado         = 'fallido',
             motivo_fallido = $1,
             fecha_entrega  = NOW(),
             updated_at     = NOW()
         WHERE id_pedido = $2`,
        [data.motivo_fallido, data.id_pedido],
      );

      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
  async obtenerComprobante(id_pago: number, id_repartidor: number) {
    const seguridadRes = await this.pool.query(
      `SELECT p.id_pago, p.id_venta
       FROM pago p
       JOIN pedido_domicilio pd ON pd.id_venta = p.id_venta
       WHERE p.id_pago = $1 AND pd.id_repartidor = $2
       LIMIT 1`,
      [id_pago, id_repartidor],
    );

    if (seguridadRes.rows.length === 0)
      throw new Error("Comprobante no encontrado o acceso no autorizado.");

    const id_venta = seguridadRes.rows[0].id_venta;

    const pagoRes = await this.pool.query(
      `SELECT
         p.id_pago, p.id_venta, p.fecha_pago, p.metodo_pago, p.monto, p.referencia,
         COALESCE(c.nombre_razon_social, 'Consumidor Final') AS cliente,
         COALESCE(c.nit, 'CF')                               AS nit,
         c.direccion                                         AS direccion_cliente,
         CONCAT(ec.nombre, ' ', ec.apellido)                 AS cajero,
         CONCAT(er.nombre, ' ', er.apellido)                 AS repartidor,
         v.subtotal,
         COALESCE(v.descuento_monto, 0)                      AS descuento_monto,
         v.total
       FROM pago p
       JOIN venta v ON p.id_venta = v.id_venta
       LEFT JOIN cliente c ON v.id_cliente = c.id_cliente
       LEFT JOIN empleado ec ON p.id_cajero = ec.id_empleado
       LEFT JOIN empleado er ON p.id_repartidor = er.id_empleado
       WHERE p.id_pago = $1`,
      [id_pago],
    );

    if (pagoRes.rows.length === 0) throw new Error("Pago no encontrado.");
    const pago = pagoRes.rows[0];

    const detallesRes = await this.pool.query(
      `SELECT
         dv.id_producto, p.nombre AS producto, p.sku,
         dv.cantidad, dv.precio_unitario, dv.subtotal_linea, dv.monto_iva
       FROM detalle_venta dv
       JOIN producto p ON dv.id_producto = p.id_producto
       WHERE dv.id_venta = $1`,
      [id_venta],
    );

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
      repartidor: pago.repartidor?.trim() || null,
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

  async obtenerMiHistorial(
    id_repartidor: number,
    desde: string,
    hasta: string,
  ) {
    const query = `
      SELECT
        pd.id_pedido,
        pd.id_venta,
        pd.estado                              AS estado_pedido,
        d.direccion_texto                      AS direccion_entrega,
        d.nombre                               AS nombre_contacto,
        d.telefono                             AS telefono_contacto,
        pd.fecha_entrega,
        pd.motivo_fallido,
        pd.monto_cobrado_contra_entrega,
        v.total,
        v.pago_contra_entrega,
        -- Subquery en lugar de LEFT JOIN para evitar filas duplicadas
        -- cuando hay más de un pago asociado a la misma venta
        (SELECT pg.id_pago
         FROM pago pg
         WHERE pg.id_venta = v.id_venta
           AND pg.id_repartidor = $1
         LIMIT 1)                              AS id_pago
      FROM pedido_domicilio pd
      JOIN venta        v  ON pd.id_venta        = v.id_venta
      JOIN destinatario d  ON pd.id_destinatario = d.id_destinatario
      WHERE pd.id_repartidor = $1
        AND pd.estado IN ('entregado', 'fallido')
        AND DATE(pd.fecha_entrega) BETWEEN $2 AND $3
      ORDER BY pd.fecha_entrega DESC;
    `;

    const result = await this.pool.query(query, [id_repartidor, desde, hasta]);

    const entregas = result.rows.map((row) => ({
      id_pedido: row.id_pedido,
      id_venta: row.id_venta,
      estado_pedido: row.estado_pedido as "entregado" | "fallido",
      direccion_entrega: row.direccion_entrega,
      nombre_contacto: row.nombre_contacto,
      telefono_contacto: row.telefono_contacto,
      fecha_entrega: row.fecha_entrega,
      motivo_fallido: row.motivo_fallido ?? null,
      monto_cobrado: row.monto_cobrado_contra_entrega
        ? Number(row.monto_cobrado_contra_entrega)
        : null,
      total: Number(row.total),
      pago_contra_entrega: row.pago_contra_entrega,
      id_pago: row.id_pago ?? null,
    }));

    const totalEntregados = entregas.filter(
      (e) => e.estado_pedido === "entregado",
    ).length;
    const totalFallidos = entregas.filter(
      (e) => e.estado_pedido === "fallido",
    ).length;
    const totalCobrado = entregas.reduce(
      (acc, e) => acc + (e.monto_cobrado ?? 0),
      0,
    );

    return {
      resumen: { totalEntregados, totalFallidos, totalCobrado },
      entregas,
    };
  }
}
