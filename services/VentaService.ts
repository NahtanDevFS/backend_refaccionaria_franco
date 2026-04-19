import { Pool } from "pg";
import { CrearVentaDTO } from "../dtos/CrearVentaDTO";

export class VentaService {
  constructor(private readonly pool: Pool) {}

  async obtenerVentas(filtros?: any): Promise<{ data: any[]; total: number }> {
    let baseQuery = `
      FROM venta v
      LEFT JOIN cliente  c ON v.id_cliente  = c.id_cliente
      LEFT JOIN empleado e ON v.id_vendedor = e.id_empleado
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
      `
      SELECT
        v.id_venta,
        v.created_at as fecha,
        COALESCE(c.nombre_razon_social, 'Consumidor Final') as cliente,
        CONCAT(e.nombre, ' ', e.apellido) as vendedor,
        v.canal,
        v.subtotal,
        v.descuento_monto as descuento,
        v.monto_iva,
        v.total,
        v.estado
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

  async crearOrdenVenta(data: CrearVentaDTO): Promise<number> {
    const client = await this.pool.connect();

    try {
      await client.query("BEGIN");

      let id_cliente = null;

      if (data.nit !== "CF") {
        const clienteRes = await client.query(
          "SELECT id_cliente FROM cliente WHERE nit = $1",
          [data.nit],
        );
        if (clienteRes.rows.length > 0) {
          id_cliente = clienteRes.rows[0].id_cliente;
        } else if (data.cliente_nuevo) {
          const insertCliente = await client.query(
            `INSERT INTO cliente (nombre_razon_social, nit, tipo_cliente, telefono, email, direccion, id_municipio, notas_internas) 
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id_cliente`,
            [
              data.cliente_nuevo.nombre_razon_social,
              data.nit,
              data.cliente_nuevo.tipo_cliente,
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

      // ── PUNTO 1 y 2: Los totales de venta y los campos calculados de
      //    detalle_venta son manejados por triggers de BD. La app solo
      //    envía cantidad y precio_unitario; NO envía subtotal_linea,
      //    monto_iva, subtotal de venta, ni total de venta.
      //    El trigger trg_sync_totales_venta recalcula venta automáticamente.

      const detallesCalculados = [];

      for (const det of data.detalles) {
        let precioUnitario = 0;

        if (det.id_producto_reacondicionado) {
          const reacRes = await client.query(
            `SELECT precio_venta_reac, cantidad 
             FROM lote_reacondicionado 
             WHERE id_lote = $1 AND id_sucursal = $2 AND estado = 'disponible' FOR UPDATE`,
            [det.id_producto_reacondicionado, data.id_sucursal],
          );

          if (
            reacRes.rows.length === 0 ||
            reacRes.rows[0].cantidad < det.cantidad
          ) {
            throw new Error(
              `Stock insuficiente para el producto reacondicionado ID ${det.id_producto_reacondicionado}`,
            );
          }

          precioUnitario = Number(reacRes.rows[0].precio_venta_reac);

          await client.query(
            `UPDATE lote_reacondicionado 
             SET cantidad = cantidad - $1, 
                 estado = CASE WHEN cantidad - $1 <= 0 THEN 'vendido' ELSE 'disponible' END
             WHERE id_lote = $2`,
            [det.cantidad, det.id_producto_reacondicionado],
          );
        } else {
          const prodRes = await client.query(
            `SELECT p.precio_venta, i.cantidad_actual 
             FROM producto p 
             JOIN inventario_sucursal i ON p.id_producto = i.id_producto 
             WHERE p.id_producto = $1 AND i.id_sucursal = $2 FOR UPDATE`,
            [det.id_producto, data.id_sucursal],
          );

          if (
            prodRes.rows.length === 0 ||
            prodRes.rows[0].cantidad_actual < det.cantidad
          ) {
            throw new Error(
              `Stock insuficiente para el producto ID ${det.id_producto}`,
            );
          }

          precioUnitario = Number(prodRes.rows[0].precio_venta);

          await client.query(
            `UPDATE inventario_sucursal SET cantidad_actual = cantidad_actual - $1 
             WHERE id_producto = $2 AND id_sucursal = $3`,
            [det.cantidad, det.id_producto, data.id_sucursal],
          );
        }

        detallesCalculados.push({
          ...det,
          precioUnitario,
        });
      }

      const pctDescuento = data.descuento_porcentaje || 0;
      const esContraEntrega = data.pago_contra_entrega || false;

      let estadoVenta = "pendiente_pago";
      if (pctDescuento > 5) {
        estadoVenta = "pendiente_autorizacion";
      } else if (data.canal === "domicilio" && esContraEntrega) {
        estadoVenta = "pendiente_cobro_contra_entrega";
      }

      // Insertar venta con subtotal=0, total=0 y descuento.
      // El trigger trg_sync_totales_venta actualizará subtotal/total/monto_iva
      // automáticamente al insertar los detalles a continuación.
      const descuentoMonto_placeholder = 0; // se recalcula al final con el trigger
      const ventaRes = await client.query(
        `INSERT INTO venta (id_sucursal, id_vendedor, id_cliente, canal, pago_contra_entrega, estado, subtotal, descuento_monto, monto_iva, total)
         VALUES ($1, $2, $3, $4, $5, $6, 0, $7, 0, 0) RETURNING id_venta`,
        [
          data.id_sucursal,
          data.id_vendedor,
          id_cliente,
          data.canal,
          esContraEntrega,
          estadoVenta,
          // descuento_monto: lo calculamos después del trigger para saber el subtotal real
          descuentoMonto_placeholder,
        ],
      );

      const id_venta = ventaRes.rows[0].id_venta;

      // ── PUNTO 1: No enviar subtotal_linea ni monto_iva — son columnas
      //    GENERATED en la BD, calculadas automáticamente como:
      //    subtotal_linea = cantidad * precio_unitario
      //    monto_iva      = subtotal_linea * porcentaje_iva / (100 + porcentaje_iva)
      for (const det of detallesCalculados) {
        await client.query(
          `INSERT INTO detalle_venta 
             (id_venta, id_producto, id_producto_reacondicionado, cantidad, precio_unitario, porcentaje_iva)
           VALUES ($1, $2, $3, $4, $5, 12.00)`,
          [
            id_venta,
            det.id_producto,
            det.id_producto_reacondicionado || null,
            det.cantidad,
            det.precioUnitario,
            // subtotal_linea y monto_iva NO se envían — los calcula la BD
          ],
        );
      }

      // ── PUNTO 2: Ahora que el trigger ya recalculó el subtotal de venta,
      //    aplicamos el descuento sobre ese valor real.
      if (pctDescuento > 0) {
        await client.query(
          `UPDATE venta
           SET descuento_monto = ROUND(subtotal * $1 / 100, 2),
               total           = ROUND(subtotal * (1 - $1 / 100), 2)
           WHERE id_venta = $2`,
          [pctDescuento, id_venta],
        );
      }

      // ── PUNTO 7: pedido_domicilio ya no tiene nombre_contacto,
      //    telefono_contacto ni direccion_entrega. Ahora inserta en
      //    la tabla destinatario y luego referencia id_destinatario.
      if (data.canal === "domicilio" && data.direccion_entrega) {
        // 1. Crear el destinatario con municipio si viene
        const destRes = await client.query(
          `INSERT INTO destinatario
             (nombre, telefono, direccion_texto, id_municipio)
           VALUES ($1, $2, $3, $4)
           RETURNING id_destinatario`,
          [
            data.nombre_contacto ?? null,
            data.telefono_contacto ?? null,
            data.direccion_entrega,
            data.id_municipio_entrega ?? null, // ← nuevo campo del payload
          ],
        );
        const id_destinatario = destRes.rows[0].id_destinatario;

        // 2. Crear el pedido referenciando el destinatario
        await client.query(
          `INSERT INTO pedido_domicilio
             (id_venta, id_repartidor, estado, id_destinatario)
           VALUES ($1, $2, 'pendiente', $3)`,
          [id_venta, data.id_repartidor, id_destinatario],
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

  async obtenerRepartidores(id_sucursal: number): Promise<any[]> {
    const query = `
      SELECT e.id_empleado, e.nombre, e.apellido
      FROM empleado e
      INNER JOIN puesto p ON e.id_puesto = p.id_puesto
      WHERE e.id_sucursal = $1 
        AND p.nombre ILIKE '%repartidor%' 
        AND e.activo = true;
    `;
    const result = await this.pool.query(query, [id_sucursal]);
    return result.rows;
  }

  async obtenerPendientesAutorizacion(id_sucursal: number): Promise<any[]> {
    const query = `
      SELECT 
        v.id_venta,
        v.created_at                                            AS fecha,
        COALESCE(c.nombre_razon_social, 'Consumidor Final')    AS cliente,
        COALESCE(CONCAT(e.nombre, ' ', e.apellido), 'Sin vendedor') AS vendedor,
        v.subtotal,
        v.descuento_monto,
        v.total,
        ROUND((v.descuento_monto / NULLIF(v.subtotal, 0)) * 100, 2) AS pct_descuento
      FROM venta v
      LEFT JOIN cliente   c ON v.id_cliente  = c.id_cliente
      LEFT JOIN empleado  e ON v.id_vendedor = e.id_empleado
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
        "SELECT estado, canal, pago_contra_entrega FROM venta WHERE id_venta = $1 FOR UPDATE",
        [id_venta],
      );
      if (ventaRes.rows.length === 0) throw new Error("Venta no encontrada");

      const venta = ventaRes.rows[0];
      if (venta.estado !== "pendiente_autorizacion")
        throw new Error("La venta no está pendiente de autorización");

      let nuevoEstado = "rechazada";
      if (aprobado) {
        nuevoEstado =
          venta.canal === "domicilio" && venta.pago_contra_entrega
            ? "pendiente_cobro_contra_entrega"
            : "pendiente_pago";
      }

      await client.query(
        `UPDATE venta SET estado = $1, id_supervisor_autoriza = $2, updated_at = NOW() WHERE id_venta = $3`,
        [nuevoEstado, id_supervisor, id_venta],
      );

      await client.query(
        `INSERT INTO log_auditoria (id_usuario, tabla_afectada, accion, id_registro, datos_nuevos)
         VALUES ($1, 'venta', $2, $3, $4)`,
        [
          id_usuario_log,
          aprobado ? "aprobacion_descuento" : "rechazo_descuento",
          id_venta,
          JSON.stringify({
            estado: nuevoEstado,
            id_supervisor_autoriza: id_supervisor,
          }),
        ],
      );

      if (!aprobado) {
        await client.query(
          `UPDATE inventario_sucursal i
           SET cantidad_actual = i.cantidad_actual + dv.cantidad
           FROM detalle_venta dv
           WHERE i.id_producto = dv.id_producto AND dv.id_venta = $1
             AND i.id_sucursal = (SELECT id_sucursal FROM venta WHERE id_venta = $1)`,
          [id_venta],
        );
      }

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
    const queryVenta = `
      SELECT v.*, COALESCE(c.nombre_razon_social, 'Consumidor Final') as cliente, 
             CONCAT(e.nombre, ' ', e.apellido) as vendedor
      FROM venta v
      LEFT JOIN cliente c ON v.id_cliente = c.id_cliente
      LEFT JOIN empleado e ON v.id_vendedor = e.id_empleado
      WHERE v.id_venta = $1;
    `;
    // subtotal_linea y monto_iva ahora son columnas GENERATED — siguen
    // disponibles en SELECT con el mismo nombre, sin cambios para el frontend.
    const queryDetalles = `
      SELECT dv.id_detalle, dv.id_producto, p.nombre as producto, p.sku, p.garantia_dias,
             dv.cantidad, dv.precio_unitario, dv.subtotal_linea, dv.monto_iva
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
        v.created_at                                                AS fecha,
        v.estado,
        v.subtotal,
        v.descuento_monto,
        v.total,
        ROUND((v.descuento_monto / NULLIF(v.subtotal, 0)) * 100, 2) AS pct_descuento,
        COALESCE(c.nombre_razon_social, 'Consumidor Final')         AS cliente,
        COALESCE(CONCAT(ev.nombre, ' ', ev.apellido), 'Sin asignar') AS vendedor,
        CASE
          WHEN v.descuento_monto / NULLIF(v.subtotal, 0) > 0.05 THEN 'requirio_aprobacion'
          ELSE 'automatico'
        END                                                          AS tipo_descuento,
        COALESCE(CONCAT(es.nombre, ' ', es.apellido), NULL)         AS aprobado_por
      FROM venta v
      LEFT JOIN cliente   c  ON v.id_cliente          = c.id_cliente
      LEFT JOIN empleado  ev ON v.id_vendedor         = ev.id_empleado
      LEFT JOIN empleado  es ON v.id_supervisor_autoriza = es.id_empleado
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
