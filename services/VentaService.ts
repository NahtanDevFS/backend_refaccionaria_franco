// services/VentaService.ts
import { Pool } from "pg";
import { CrearVentaDTO } from "../dtos/CrearVentaDTO";

export class VentaService {
  constructor(private readonly pool: Pool) {}

  // ── Helper: resuelve el id_canal a partir del nombre (mostrador/domicilio) ─
  private async resolverIdCanal(
    client: { query: Function },
    nombreCanal: string,
  ): Promise<number> {
    const res = await client.query(
      `SELECT id_canal FROM canal_venta WHERE nombre = $1`,
      [nombreCanal],
    );
    if (res.rows.length === 0)
      throw new Error(`Canal de venta no reconocido: "${nombreCanal}"`);
    return res.rows[0].id_canal;
  }

  async obtenerVentas(filtros?: any): Promise<{ data: any[]; total: number }> {
    let baseQuery = `
      FROM venta v
      LEFT JOIN canal_venta  cv ON v.id_canal    = cv.id_canal
      LEFT JOIN cliente       c ON v.id_cliente  = c.id_cliente
      LEFT JOIN empleado      e ON v.id_vendedor = e.id_empleado
      LEFT JOIN pedido_domicilio pd ON pd.id_venta = v.id_venta
      WHERE 1=1
    `;

    const values: any[] = [];
    let paramIndex = 1;

    if (filtros?.id_sucursal !== undefined) {
      baseQuery += ` AND v.id_sucursal = $${paramIndex}`;
      values.push(Number(filtros.id_sucursal));
      paramIndex++;
    }

    if (filtros?.id_venta) {
      baseQuery += ` AND v.id_venta = $${paramIndex}`;
      values.push(Number(filtros.id_venta));
      paramIndex++;
    } else {
      if (filtros?.fechaInicio) {
        baseQuery += ` AND DATE(v.created_at) >= $${paramIndex}`;
        values.push(filtros.fechaInicio);
        paramIndex++;
      }
      if (filtros?.fechaFin) {
        baseQuery += ` AND DATE(v.created_at) <= $${paramIndex}`;
        values.push(filtros.fechaFin);
        paramIndex++;
      }
      if (filtros?.id_vendedor) {
        baseQuery += ` AND v.id_vendedor = $${paramIndex}`;
        values.push(filtros.id_vendedor);
        paramIndex++;
      }
      if (filtros?.estado) {
        baseQuery += ` AND v.estado = $${paramIndex}`;
        values.push(filtros.estado);
        paramIndex++;
      }
    }

    const countQuery = `SELECT COUNT(*) as total ` + baseQuery;

    const page = filtros?.page ? Number(filtros.page) : 1;
    const limit = filtros?.limit ? Number(filtros.limit) : 20;
    const offset = (page - 1) * limit;

    let dataQuery =
      `SELECT
        v.id_venta,
        v.created_at                                          AS fecha,
        COALESCE(c.nombre_razon_social, 'Consumidor Final')   AS cliente,
        CONCAT(e.nombre, ' ', e.apellido)                     AS vendedor,
        cv.nombre                                             AS canal,
        v.subtotal,
        v.descuento_monto                                     AS descuento,
        v.monto_iva,
        v.total,
        v.estado,
        pd.estado                                             AS estado_pedido,
        pd.motivo_fallido
      ` + baseQuery;

    dataQuery += ` ORDER BY v.created_at DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1};`;
    const dataValues = [...values, limit, offset];

    const [countResult, dataResult] = await Promise.all([
      this.pool.query(countQuery, values),
      this.pool.query(dataQuery, dataValues),
    ]);

    const total = Number(countResult.rows[0].total);
    const data = dataResult.rows.map((row) => ({
      ...row,
      subtotal: Number(row.subtotal),
      descuento: Number(row.descuento),
      monto_iva: Number(row.monto_iva),
      total: Number(row.total),
      estado_pedido: row.estado_pedido ?? null,
      motivo_fallido: row.motivo_fallido ?? null,
    }));

    return { data, total };
  }

  async obtenerVendedores(id_sucursal: number): Promise<any[]> {
    const query = `
      SELECT e.id_empleado, e.nombre, e.apellido
      FROM empleado e
      INNER JOIN puesto p ON e.id_puesto = p.id_puesto
      WHERE e.id_sucursal = $1
        AND p.nombre ILIKE '%vendedor%'
        AND e.activo = true;
    `;
    const result = await this.pool.query(query, [id_sucursal]);
    return result.rows;
  }

  async crearOrdenVenta(
    data: CrearVentaDTO,
    id_usuario: number,
  ): Promise<number> {
    const client = await this.pool.connect();

    try {
      await client.query("BEGIN");

      // ── Resolver canal ──────────────────────────────────────────────────────
      const id_canal = await this.resolverIdCanal(client, data.canal);

      // ── Resolver cliente ────────────────────────────────────────────────────
      let id_cliente = null;

      if (data.nit !== "CF") {
        const clienteRes = await client.query(
          "SELECT id_cliente FROM cliente WHERE nit = $1",
          [data.nit],
        );
        if (clienteRes.rows.length > 0) {
          id_cliente = clienteRes.rows[0].id_cliente;
        } else if (data.cliente_nuevo) {
          const tipoRes = await client.query(
            `SELECT id_tipo_cliente FROM tipo_cliente
             WHERE LOWER(nombre) = LOWER($1) AND activo = true
             LIMIT 1`,
            [data.cliente_nuevo.tipo_cliente ?? "particular"],
          );

          let id_tipo_cliente: number;
          if (tipoRes.rows.length > 0) {
            id_tipo_cliente = tipoRes.rows[0].id_tipo_cliente;
          } else {
            const fallbackRes = await client.query(
              `SELECT id_tipo_cliente FROM tipo_cliente
               WHERE nombre = 'particular' LIMIT 1`,
            );
            id_tipo_cliente = fallbackRes.rows[0].id_tipo_cliente;
          }

          const insertCliente = await client.query(
            `INSERT INTO cliente
               (nombre_razon_social, nit, id_tipo_cliente, telefono, email,
                direccion, id_municipio, notas_internas)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id_cliente`,
            [
              data.cliente_nuevo.nombre_razon_social,
              data.nit,
              id_tipo_cliente,
              data.cliente_nuevo.telefono,
              data.cliente_nuevo.email,
              data.cliente_nuevo.direccion,
              data.cliente_nuevo.id_municipio,
              data.cliente_nuevo.notas_internas,
            ],
          );
          id_cliente = insertCliente.rows[0].id_cliente;
        }
      }

      // ── Validar stock y calcular precios ────────────────────────────────────
      const pctDescuento = data.descuento_porcentaje ?? 0;
      const esContraEntrega = data.pago_contra_entrega ?? false;

      const estadoVenta =
        pctDescuento > 5 ? "pendiente_autorizacion" : "pendiente_pago";

      const detallesCalculados: {
        id_producto: number;
        id_producto_reacondicionado?: number;
        cantidad: number;
        precioUnitario: number;
        id_inventario?: number;
        esReacondicionado: boolean;
      }[] = [];

      for (const det of data.detalles) {
        if (det.id_producto_reacondicionado) {
          const loteRes = await client.query(
            `SELECT lr.precio_venta_reac, lr.cantidad
             FROM lote_reacondicionado lr
             WHERE lr.id_lote = $1
               AND lr.id_sucursal = $2
               AND lr.estado = 'disponible'
             FOR UPDATE`,
            [det.id_producto_reacondicionado, data.id_sucursal],
          );
          if (loteRes.rows.length === 0)
            throw new Error(
              `Lote reacondicionado ${det.id_producto_reacondicionado} no disponible`,
            );
          if (Number(loteRes.rows[0].cantidad) < det.cantidad)
            throw new Error(
              `Stock insuficiente en lote reacondicionado ${det.id_producto_reacondicionado}`,
            );

          detallesCalculados.push({
            id_producto: det.id_producto,
            id_producto_reacondicionado: det.id_producto_reacondicionado,
            cantidad: det.cantidad,
            precioUnitario: Number(loteRes.rows[0].precio_venta_reac),
            esReacondicionado: true,
          });
        } else {
          const invRes = await client.query(
            `SELECT i.id_inventario, i.cantidad_actual, p.precio_venta
             FROM inventario_sucursal i
             JOIN producto p ON i.id_producto = p.id_producto
             WHERE i.id_producto = $1 AND i.id_sucursal = $2
             FOR UPDATE`,
            [det.id_producto, data.id_sucursal],
          );
          if (invRes.rows.length === 0)
            throw new Error(
              `Producto ${det.id_producto} sin inventario en esta sucursal`,
            );
          if (Number(invRes.rows[0].cantidad_actual) < det.cantidad)
            throw new Error(
              `Stock insuficiente para producto ${det.id_producto}`,
            );

          detallesCalculados.push({
            id_producto: det.id_producto,
            cantidad: det.cantidad,
            precioUnitario: Number(invRes.rows[0].precio_venta),
            id_inventario: invRes.rows[0].id_inventario,
            esReacondicionado: false,
          });
        }
      }

      // ── Insertar venta ──────────────────────────────────────────────────────
      const ventaRes = await client.query(
        `INSERT INTO venta
           (id_sucursal, id_vendedor, id_cliente, id_canal, pago_contra_entrega,
            estado, subtotal, descuento_monto, monto_iva, total)
         VALUES ($1,$2,$3,$4,$5,$6, 0,$7, 0, 0)
         RETURNING id_venta`,
        [
          data.id_sucursal,
          data.id_vendedor,
          id_cliente,
          id_canal,
          esContraEntrega,
          estadoVenta,
          0,
        ],
      );

      const id_venta = ventaRes.rows[0].id_venta;

      // ── Insertar detalles (trigger recalcula subtotal/total de venta) ───────
      for (const det of detallesCalculados) {
        await client.query(
          `INSERT INTO detalle_venta
             (id_venta, id_producto, id_producto_reacondicionado,
              cantidad, precio_unitario, porcentaje_iva)
           VALUES ($1,$2,$3,$4,$5, 12.00)`,
          [
            id_venta,
            det.id_producto,
            det.id_producto_reacondicionado || null,
            det.cantidad,
            det.precioUnitario,
          ],
        );
      }

      // ── Aplicar descuento sobre el subtotal ya calculado por el trigger ─────
      if (pctDescuento > 0) {
        await client.query(
          `UPDATE venta
           SET descuento_monto = ROUND(subtotal * $1 / 100, 2),
               total           = ROUND(subtotal * (1 - $1 / 100), 2)
           WHERE id_venta = $2`,
          [pctDescuento, id_venta],
        );
      }

      // ── FIFO: registrar movimiento y consumir lotes para productos normales ─
      for (const det of detallesCalculados) {
        if (det.esReacondicionado) continue;

        const nuevaCantidad = await client.query(
          `SELECT cantidad_actual FROM inventario_sucursal
           WHERE id_inventario = $1`,
          [det.id_inventario],
        );

        const cantidadResultante = Number(
          nuevaCantidad.rows[0].cantidad_actual,
        );

        const movRes = await client.query(
          `INSERT INTO movimiento_inventario
             (id_inventario, id_usuario, tipo, cantidad, cantidad_resultante,
              id_referencia, tabla_referencia, motivo)
           VALUES ($1, $2, 'salida_venta', $3, $4, $5, 'venta',
                   'Venta registrada en mostrador o domicilio')
           RETURNING id_movimiento`,
          [
            det.id_inventario,
            id_usuario,
            det.cantidad,
            cantidadResultante,
            id_venta,
          ],
        );

        const id_movimiento = movRes.rows[0].id_movimiento;

        await client.query(`SELECT fn_consumir_lotes_fifo($1, $2, $3, $4)`, [
          det.id_producto,
          data.id_sucursal,
          det.cantidad,
          id_movimiento,
        ]);
      }

      // ── Descontar lotes reacondicionados ────────────────────────────────────
      for (const det of detallesCalculados) {
        if (!det.esReacondicionado) continue;
        await client.query(
          `UPDATE lote_reacondicionado
           SET cantidad = cantidad - $1
           WHERE id_lote = $2`,
          [det.cantidad, det.id_producto_reacondicionado],
        );
      }

      // ── Pedido a domicilio ──────────────────────────────────────────────────
      if (data.canal === "domicilio" && data.direccion_entrega) {
        const destRes = await client.query(
          `INSERT INTO destinatario
             (nombre, telefono, direccion_texto, id_municipio)
           VALUES ($1,$2,$3,$4)
           RETURNING id_destinatario`,
          [
            data.nombre_contacto ?? null,
            data.telefono_contacto ?? null,
            data.direccion_entrega,
            data.id_municipio_entrega ?? null,
          ],
        );

        await client.query(
          `INSERT INTO pedido_domicilio
             (id_venta, id_repartidor, estado, id_destinatario)
           VALUES ($1,$2,'pendiente',$3)`,
          [id_venta, data.id_repartidor, destRes.rows[0].id_destinatario],
        );
      }

      await client.query("COMMIT");
      return id_venta;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async obtenerRepartidores(id_sucursal: number): Promise<
    {
      id_empleado: number;
      nombre: string;
      apellido: string;
      disponible: boolean;
      pedidos_activos: number;
    }[]
  > {
    const query = `
      SELECT
        e.id_empleado,
        e.nombre,
        e.apellido,
        e.disponible,
        COALESCE(
          (
            SELECT COUNT(*)::int
            FROM pedido_domicilio pd
            WHERE pd.id_repartidor = e.id_empleado
              AND pd.estado = 'pendiente'
          ),
          0
        ) AS pedidos_activos
      FROM empleado e
      INNER JOIN puesto p ON e.id_puesto = p.id_puesto
      WHERE e.id_sucursal = $1
        AND p.nombre ILIKE '%repartidor%'
        AND e.activo = true
      ORDER BY e.disponible DESC, pedidos_activos ASC, e.nombre ASC;
    `;
    const result = await this.pool.query(query, [id_sucursal]);
    return result.rows.map((r) => ({
      id_empleado: r.id_empleado,
      nombre: r.nombre,
      apellido: r.apellido,
      disponible: r.disponible,
      pedidos_activos: Number(r.pedidos_activos),
    }));
  }

  async obtenerPendientesAutorizacion(id_sucursal: number): Promise<any[]> {
    const query = `
      SELECT
        v.id_venta,
        v.created_at                                                AS fecha,
        COALESCE(c.nombre_razon_social, 'Consumidor Final')         AS cliente,
        COALESCE(CONCAT(e.nombre, ' ', e.apellido), 'Sin vendedor') AS vendedor,
        v.subtotal,
        v.descuento_monto,
        v.total,
        ROUND((v.descuento_monto / NULLIF(v.subtotal, 0)) * 100, 2) AS pct_descuento
      FROM venta v
      LEFT JOIN cliente  c ON v.id_cliente  = c.id_cliente
      LEFT JOIN empleado e ON v.id_vendedor = e.id_empleado
      WHERE v.id_sucursal = $1
        AND v.estado = 'pendiente_autorizacion'
      ORDER BY v.created_at ASC;
    `;
    const result = await this.pool.query(query, [id_sucursal]);
    return result.rows.map((row) => ({
      ...row,
      subtotal: Number(row.subtotal),
      descuento_monto: Number(row.descuento_monto),
      total: Number(row.total),
      pct_descuento: Number(row.pct_descuento),
    }));
  }

  async resolverAutorizacion(
    id_venta: number,
    id_supervisor: number,
    id_usuario_log: number,
    aprobado: boolean,
  ): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      const ventaRes = await client.query(
        `SELECT v.estado, cv.nombre AS canal, v.pago_contra_entrega,
              v.id_sucursal, v.subtotal
       FROM venta v
       JOIN canal_venta cv ON v.id_canal = cv.id_canal
       WHERE v.id_venta = $1 FOR UPDATE`,
        [id_venta],
      );
      if (ventaRes.rows.length === 0) throw new Error("Venta no encontrada");

      const venta = ventaRes.rows[0];
      if (venta.estado !== "pendiente_autorizacion")
        throw new Error("La venta no está pendiente de autorización");

      const estadoDestino =
        venta.canal === "domicilio" && venta.pago_contra_entrega
          ? "pendiente_cobro_contra_entrega"
          : "pendiente_pago";

      let nuevoDescuento: number | null = null;
      let nuevoTotal: number | null = null;

      if (!aprobado) {
        nuevoDescuento = Number((Number(venta.subtotal) * 0.05).toFixed(2));
        nuevoTotal = Number((Number(venta.subtotal) * 0.95).toFixed(2));
      }

      if (!aprobado && nuevoDescuento !== null) {
        await client.query(
          `UPDATE venta
         SET estado                 = $1,
             id_supervisor_autoriza = $2,
             descuento_monto        = $3,
             total                  = $4,
             updated_by             = $5
         WHERE id_venta = $6`,
          [
            estadoDestino,
            id_supervisor,
            nuevoDescuento,
            nuevoTotal,
            id_usuario_log,
            id_venta,
          ],
        );
      } else {
        await client.query(
          `UPDATE venta
         SET estado                 = $1,
             id_supervisor_autoriza = $2,
             updated_by             = $3
         WHERE id_venta = $4`,
          [estadoDestino, id_supervisor, id_usuario_log, id_venta],
        );
      }

      await client.query(
        `INSERT INTO log_auditoria
         (id_usuario, tabla_afectada, accion, id_registro, datos_nuevos)
       VALUES ($1, 'venta', $2, $3, $4)`,
        [
          id_usuario_log,
          aprobado ? "aprobacion_descuento" : "rechazo_con_descuento_base",
          id_venta,
          JSON.stringify({
            estado: estadoDestino,
            id_supervisor_autoriza: id_supervisor,
            descuento_aplicado: nuevoDescuento,
            total_resultante: nuevoTotal,
            motivo: aprobado
              ? "Descuento aprobado por supervisor"
              : "Descuento solicitado rechazado — se aplica 5% base automáticamente",
          }),
        ],
      );

      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
  async obtenerVentaPorId(
    id_venta: number,
  ): Promise<{ venta: any; detalles: any[] } | null> {
    // Usa v.* pero el canal ahora viene del JOIN con canal_venta
    const queryVenta = `
      SELECT
        v.id_venta, v.id_sucursal, v.id_vendedor, v.id_cliente,
        v.id_supervisor_autoriza, v.estado, v.subtotal, v.descuento_monto,
        v.total, v.created_at, v.updated_at, v.pago_contra_entrega,
        v.monto_iva, v.created_by, v.updated_by, v.id_anulado_por,
        v.motivo_anulacion, v.monto_devolucion,
        cv.nombre                                            AS canal,
        COALESCE(c.nombre_razon_social, 'Consumidor Final') AS cliente,
        CONCAT(ev.nombre, ' ', ev.apellido)                  AS vendedor,
        CONCAT(ea.nombre, ' ', ea.apellido)                  AS anulado_por,
        pd.id_pedido,
        pd.estado                                            AS estado_pedido,
        pd.motivo_fallido,
        pd.id_repartidor                                     AS id_repartidor_actual,
        CONCAT(er.nombre, ' ', er.apellido)                  AS repartidor_actual
      FROM venta v
      JOIN canal_venta   cv ON v.id_canal      = cv.id_canal
      LEFT JOIN cliente   c ON v.id_cliente    = c.id_cliente
      LEFT JOIN empleado ev ON v.id_vendedor   = ev.id_empleado
      LEFT JOIN empleado ea ON v.id_anulado_por = ea.id_empleado
      LEFT JOIN pedido_domicilio pd ON pd.id_venta = v.id_venta
      LEFT JOIN empleado er ON pd.id_repartidor = er.id_empleado
      WHERE v.id_venta = $1;
    `;

    const queryDetalles = `
      SELECT dv.id_detalle, dv.id_producto, p.nombre AS producto, p.sku, p.garantia_dias,
             dv.cantidad, dv.precio_unitario, dv.subtotal_linea, dv.monto_iva,
             EXISTS (
               SELECT 1 FROM garantia g
               WHERE g.id_detalle_venta = dv.id_detalle
                 AND g.estado IN ('en_revision', 'aprobada', 'rechazada')
             ) AS tiene_garantia
      FROM detalle_venta dv
      JOIN producto p ON dv.id_producto = p.id_producto
      WHERE dv.id_venta = $1;
    `;

    const resVenta = await this.pool.query(queryVenta, [id_venta]);
    if (resVenta.rows.length === 0) return null;

    const resDetalles = await this.pool.query(queryDetalles, [id_venta]);
    return {
      venta: resVenta.rows[0],
      detalles: resDetalles.rows.map((row) => ({
        ...row,
        cantidad: Number(row.cantidad),
        precio_unitario: Number(row.precio_unitario),
        subtotal_linea: Number(row.subtotal_linea),
        monto_iva: Number(row.monto_iva),
        garantia_dias: Number(row.garantia_dias),
        tiene_garantia: row.tiene_garantia === true,
      })),
    };
  }

  async obtenerHistorialDescuentos(
    id_sucursal: number,
    desde?: string,
    hasta?: string,
    id_vendedor?: number,
  ): Promise<any[]> {
    const fechaDesde = desde ?? new Date().toISOString().split("T")[0];
    const fechaHasta = hasta ?? new Date().toISOString().split("T")[0];

    const values: any[] = [id_sucursal, fechaDesde, fechaHasta];
    let filtroVendedor = "";

    if (id_vendedor) {
      values.push(id_vendedor);
      filtroVendedor = `AND v.id_vendedor = $${values.length}`;
    }

    const query = `
      SELECT
        v.id_venta,
        v.created_at                                                 AS fecha,
        v.estado,
        v.subtotal,
        v.descuento_monto,
        v.total,
        ROUND((v.descuento_monto / NULLIF(v.subtotal, 0)) * 100, 2) AS pct_descuento,
        COALESCE(c.nombre_razon_social, 'Consumidor Final')          AS cliente,
        COALESCE(CONCAT(ev.nombre, ' ', ev.apellido), 'Sin asignar') AS vendedor,
        CASE
          WHEN v.descuento_monto / NULLIF(v.subtotal, 0) > 0.05 THEN 'requirio_aprobacion'
          ELSE 'automatico'
        END                                                           AS tipo_descuento,
        COALESCE(CONCAT(es.nombre, ' ', es.apellido), NULL)          AS aprobado_por
      FROM venta v
      LEFT JOIN cliente  c  ON v.id_cliente             = c.id_cliente
      LEFT JOIN empleado ev ON v.id_vendedor            = ev.id_empleado
      LEFT JOIN empleado es ON v.id_supervisor_autoriza = es.id_empleado
      WHERE v.id_sucursal  = $1
        AND v.descuento_monto > 0
        AND DATE(v.created_at) BETWEEN $2 AND $3
        ${filtroVendedor}
      ORDER BY v.created_at DESC;
    `;

    const result = await this.pool.query(query, values);

    return result.rows.map((row) => ({
      id_venta: row.id_venta,
      fecha: row.fecha,
      estado: row.estado,
      cliente: row.cliente,
      vendedor: row.vendedor,
      subtotal: Number(row.subtotal),
      descuento_monto: Number(row.descuento_monto),
      total: Number(row.total),
      pct_descuento: Number(row.pct_descuento),
      tipo_descuento: row.tipo_descuento,
      aprobado_por: row.aprobado_por ?? null,
    }));
  }
}
