// services/EntregaService.ts
import { Pool } from "pg";
import {
  MarcarEntregaExitosaDTO,
  MarcarEntregaFallidaDTO,
} from "../dtos/EntregaDTO";

export class EntregaService {
  constructor(private readonly pool: Pool) {}

  // ── Pedidos activos del repartidor ────────────────────────────────────────
  async obtenerMisPedidos(id_repartidor: number) {
    const query = `
      SELECT
        pd.id_pedido,
        pd.id_venta,
        ep.nombre                       AS estado_pedido,
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
      JOIN venta         v  ON pd.id_venta        = v.id_venta
      JOIN destinatario  d  ON pd.id_destinatario = d.id_destinatario
      JOIN estado_pedido ep ON pd.id_estado_pedido = ep.id_estado_pedido
      JOIN estado_venta  ev ON v.id_estado_venta   = ev.id_estado_venta
      WHERE pd.id_repartidor = $1
        AND (
          (
            ep.nombre = 'pendiente'
            AND (
              (
                v.pago_contra_entrega = true
                AND ev.nombre IN ('pendiente_cobro_contra_entrega', 'pendiente_pago')
              )
              OR
              (
                v.pago_contra_entrega = false
                AND ev.nombre = 'pagada'
              )
            )
          )
          OR
          (
            ep.nombre = 'cancelado'
            AND pd.fecha_visto_cancelacion IS NULL
          )
        )
      ORDER BY
        CASE ep.nombre WHEN 'cancelado' THEN 0 ELSE 1 END ASC,
        pd.id_pedido ASC
    `;

    const result = await this.pool.query(query, [id_repartidor]);
    return result.rows.map((row) => ({ ...row, total: Number(row.total) }));
  }

  // ── Confirmar que el repartidor vio la cancelación ────────────────────────
  async confirmarCancelacion(id_repartidor: number, id_pedido: number) {
    const result = await this.pool.query(
      `UPDATE pedido_domicilio
       SET fecha_visto_cancelacion = NOW(),
           updated_at              = NOW()
       WHERE id_pedido      = $1
         AND id_repartidor  = $2
         AND id_estado_pedido = (
               SELECT id_estado_pedido FROM estado_pedido WHERE nombre = 'cancelado'
             )
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

  // ── Marcar entrega como exitosa ───────────────────────────────────────────
  async marcarExito(id_repartidor: number, data: MarcarEntregaExitosaDTO) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      const pedidoRes = await client.query(
        `SELECT pd.id_venta, ep.nombre AS estado, v.pago_contra_entrega, v.total, v.id_sucursal
         FROM pedido_domicilio pd
         JOIN venta         v  ON pd.id_venta        = v.id_venta
         JOIN estado_pedido ep ON pd.id_estado_pedido = ep.id_estado_pedido
         WHERE pd.id_pedido     = $1
           AND pd.id_repartidor = $2
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

      let id_cobro_generado: number | null = null;

      if (pedido.pago_contra_entrega) {
        if (
          data.monto_cobrado === undefined ||
          data.monto_cobrado < Number(pedido.total)
        ) {
          throw new Error(
            `Debe registrar el cobro completo. El total es Q${pedido.total}`,
          );
        }

        // Marcar venta como pagada
        await client.query(
          `UPDATE venta
           SET id_estado_venta = (
                 SELECT id_estado_venta FROM estado_venta WHERE nombre = 'pagada'
               ),
               updated_at = NOW()
           WHERE id_venta = $1`,
          [pedido.id_venta],
        );

        // Insertar cobro en ruta
        const cobroInsert = await client.query(
          `INSERT INTO cobro
            (id_venta, id_cajero, id_repartidor, id_metodo_cobro,
              monto, referencia, cobro_en_ruta)
          VALUES (
            $1, NULL, $2,
            (SELECT id_metodo_cobro FROM metodo_cobro WHERE nombre = 'efectivo'),
            $3, NULL, true
          )
          RETURNING id_cobro`,
          [pedido.id_venta, id_repartidor, data.monto_cobrado],
        );
        id_cobro_generado = cobroInsert.rows[0].id_cobro;
      }

      // Marcar pedido como entregado
      await client.query(
        `UPDATE pedido_domicilio
         SET id_estado_pedido = (
               SELECT id_estado_pedido FROM estado_pedido WHERE nombre = 'entregado'
             ),
             fecha_entrega                 = NOW(),
             monto_cobrado_contra_entrega  = $1
         WHERE id_pedido = $2`,
        [data.monto_cobrado || 0, data.id_pedido],
      );

      await client.query("COMMIT");

      // id_cobro se expone como id_pago para compat. con el frontend
      return { id_pago: id_cobro_generado };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  // ── Marcar entrega como fallida ───────────────────────────────────────────
  async marcarFallida(id_repartidor: number, data: MarcarEntregaFallidaDTO) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      const pedidoRes = await client.query(
        `SELECT pd.id_pedido, pd.id_venta
         FROM pedido_domicilio pd
         JOIN estado_pedido ep ON pd.id_estado_pedido = ep.id_estado_pedido
         WHERE pd.id_pedido     = $1
           AND pd.id_repartidor = $2
           AND ep.nombre        = 'pendiente'
         FOR UPDATE`,
        [data.id_pedido, id_repartidor],
      );

      if (pedidoRes.rows.length === 0)
        throw new Error(
          "Pedido no encontrado, no asignado a este repartidor o ya procesado.",
        );

      await client.query(
        `UPDATE pedido_domicilio
         SET id_estado_pedido = (
               SELECT id_estado_pedido FROM estado_pedido WHERE nombre = 'fallido'
             ),
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

  // ── Comprobante de cobro (para el repartidor) ─────────────────────────────
  async obtenerComprobante(id_cobro: number, id_repartidor: number) {
    // Seguridad: verificar que el cobro pertenece a un pedido del repartidor
    const seguridadRes = await this.pool.query(
      `SELECT c.id_cobro AS id_pago, c.id_venta
       FROM cobro c
       JOIN pedido_domicilio pd ON pd.id_venta = c.id_venta
       WHERE c.id_cobro      = $1
         AND pd.id_repartidor = $2
       LIMIT 1`,
      [id_cobro, id_repartidor],
    );

    if (seguridadRes.rows.length === 0)
      throw new Error("Comprobante no encontrado o acceso no autorizado.");

    const id_venta = seguridadRes.rows[0].id_venta;

    const cobroRes = await this.pool.query(
      `SELECT
         c.id_cobro                                           AS id_pago,
         c.id_venta,
         c.fecha_cobro                                        AS fecha_pago,
         mc.nombre                                            AS metodo_pago,
         c.monto,
         c.referencia,
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
       WHERE c.id_cobro = $1`,
      [id_cobro],
    );

    if (cobroRes.rows.length === 0) throw new Error("Cobro no encontrado.");
    const cobro = cobroRes.rows[0];

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
      id_pago: cobro.id_pago,
      id_venta: cobro.id_venta,
      fecha_pago: cobro.fecha_pago,
      metodo_pago: cobro.metodo_pago,
      monto: Number(cobro.monto),
      referencia: cobro.referencia,
      cliente: cobro.cliente,
      nit: cobro.nit,
      direccion_cliente: cobro.direccion_cliente,
      cajero: cobro.cajero,
      repartidor: cobro.repartidor?.trim() || null,
      subtotal: Number(cobro.subtotal ?? cobro.total),
      descuento_monto: Number(cobro.descuento_monto),
      total: Number(cobro.total),
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

  // ── Historial de entregas del repartidor ──────────────────────────────────
  async obtenerMiHistorial(
    id_repartidor: number,
    desde: string,
    hasta: string,
  ) {
    const query = `
      SELECT
        pd.id_pedido,
        pd.id_venta,
        ep.nombre                             AS estado_pedido,
        d.direccion_texto                     AS direccion_entrega,
        d.nombre                              AS nombre_contacto,
        d.telefono                            AS telefono_contacto,
        pd.fecha_entrega,
        pd.motivo_fallido,
        pd.monto_cobrado_contra_entrega,
        v.total,
        v.pago_contra_entrega,
        (SELECT c.id_cobro
         FROM cobro c
         WHERE c.id_venta      = v.id_venta
           AND c.id_repartidor = $1
         LIMIT 1)                             AS id_pago
      FROM pedido_domicilio pd
      JOIN venta         v  ON pd.id_venta        = v.id_venta
      JOIN destinatario  d  ON pd.id_destinatario = d.id_destinatario
      JOIN estado_pedido ep ON pd.id_estado_pedido = ep.id_estado_pedido
      WHERE pd.id_repartidor = $1
        AND ep.nombre IN ('entregado', 'fallido')
        AND DATE(pd.fecha_entrega) BETWEEN $2 AND $3
      ORDER BY pd.fecha_entrega DESC
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
      id_pago: row.id_pago ?? null, // id_cobro aliasado
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
