// services/VentaService.ts
import { Pool } from "pg";
import { CrearVentaDTO } from "../dtos/CrearVentaDTO";

export class VentaService {
  constructor(private readonly pool: Pool) {}

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
      JOIN  estado_venta       ev ON v.id_estado_venta   = ev.id_estado_venta
      LEFT JOIN canal_venta    cv ON v.id_canal           = cv.id_canal
      LEFT JOIN cliente         c ON v.id_cliente         = c.id_cliente
      LEFT JOIN empleado        e ON v.id_vendedor        = e.id_empleado
      LEFT JOIN pedido_domicilio pd ON pd.id_venta        = v.id_venta
      LEFT JOIN estado_pedido   ep ON pd.id_estado_pedido = ep.id_estado_pedido
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
        baseQuery += ` AND ev.nombre = $${paramIndex}`;
        values.push(filtros.estado);
        paramIndex++;
      }
    }

    const page = filtros?.page ? Number(filtros.page) : 1;
    const limit = filtros?.limit ? Number(filtros.limit) : 20;
    const offset = (page - 1) * limit;

    const selectQuery = `SELECT v.id_venta, v.created_at AS fecha,
        COALESCE(c.nombre_razon_social,'Consumidor Final') AS cliente,
        CONCAT(e.nombre,' ',e.apellido) AS vendedor, cv.nombre AS canal,
        v.subtotal, v.descuento_monto AS descuento, v.monto_iva, v.total,
        ev.nombre AS estado, ep.nombre AS estado_pedido, pd.motivo_fallido `;

    const [countResult, dataResult] = await Promise.all([
      this.pool.query(`SELECT COUNT(*) AS total ` + baseQuery, values),
      this.pool.query(
        selectQuery +
          baseQuery +
          ` ORDER BY v.created_at DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
        [...values, limit, offset],
      ),
    ]);

    return {
      total: Number(countResult.rows[0].total),
      data: dataResult.rows.map((row) => ({
        ...row,
        subtotal: Number(row.subtotal),
        descuento: Number(row.descuento),
        monto_iva: Number(row.monto_iva),
        total: Number(row.total),
        estado_pedido: row.estado_pedido ?? null,
        motivo_fallido: row.motivo_fallido ?? null,
      })),
    };
  }

  async obtenerVendedores(id_sucursal: number): Promise<any[]> {
    const result = await this.pool.query(
      `SELECT e.id_empleado, e.nombre, e.apellido
       FROM empleado e
       INNER JOIN usuario u ON u.id_empleado = e.id_empleado
       INNER JOIN rol     r ON u.id_rol      = r.id_rol
       WHERE e.id_sucursal = $1 AND r.nombre = 'VENDEDOR' AND e.activo = true`,
      [id_sucursal],
    );
    return result.rows;
  }

  async crearOrdenVenta(
    data: CrearVentaDTO,
    id_usuario: number,
  ): Promise<number> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      const id_canal = await this.resolverIdCanal(client, data.canal);
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
            `SELECT id_tipo_cliente FROM tipo_cliente WHERE LOWER(nombre) = LOWER($1) AND activo = true LIMIT 1`,
            [data.cliente_nuevo.tipo_cliente ?? "particular"],
          );
          const id_tipo_cliente =
            tipoRes.rows.length > 0
              ? tipoRes.rows[0].id_tipo_cliente
              : (
                  await client.query(
                    `SELECT id_tipo_cliente FROM tipo_cliente WHERE nombre = 'particular' LIMIT 1`,
                  )
                ).rows[0].id_tipo_cliente;

          const ins = await client.query(
            `INSERT INTO cliente (nombre_razon_social,nit,id_tipo_cliente,telefono,email,direccion,id_municipio,notas_internas)
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
          id_cliente = ins.rows[0].id_cliente;
        }
      }

      const pctDescuento = data.descuento_porcentaje ?? 0;
      const esContraEntrega = data.pago_contra_entrega ?? false;
      const estadoVenta =
        pctDescuento > 5 ? "pendiente_autorizacion" : "pendiente_pago";

      const detallesCalculados: {
        id_producto: number;
        id_producto_reacondicionado?: number;
        cantidad: number;
        precioUnitario: number;
        id_reorden?: number;
        esReacondicionado: boolean;
      }[] = [];

      for (const det of data.detalles) {
        if (det.id_producto_reacondicionado) {
          const loteRes = await client.query(
            `SELECT lr.precio_venta_reac, lr.cantidad FROM lote_reacondicionado lr
             WHERE lr.id_lote=$1 AND lr.id_sucursal=$2 AND lr.activo=true AND lr.cantidad>0 FOR UPDATE`,
            [det.id_producto_reacondicionado, data.id_sucursal],
          );
          if (!loteRes.rows.length)
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
          // reorden_producto_sucursal reemplaza producto_sucursal
          const rpsRes = await client.query(
            `SELECT rps.id_reorden, p.precio_venta
             FROM reorden_producto_sucursal rps
             JOIN producto p ON rps.id_producto = p.id_producto
             WHERE rps.id_producto=$1 AND rps.id_sucursal=$2 AND rps.activo=TRUE FOR UPDATE OF rps`,
            [det.id_producto, data.id_sucursal],
          );
          if (!rpsRes.rows.length)
            throw new Error(
              `Producto ${det.id_producto} sin inventario en esta sucursal`,
            );

          const stockRes = await client.query(
            `SELECT COALESCE(SUM(cantidad_actual),0) AS cantidad_actual FROM lote_detalle
             WHERE id_producto=$1 AND id_sucursal=$2 AND agotado=FALSE AND activo=TRUE`,
            [det.id_producto, data.id_sucursal],
          );
          if (Number(stockRes.rows[0].cantidad_actual) < det.cantidad)
            throw new Error(
              `Stock insuficiente para producto ${det.id_producto}`,
            );

          detallesCalculados.push({
            id_producto: det.id_producto,
            cantidad: det.cantidad,
            precioUnitario: Number(rpsRes.rows[0].precio_venta),
            id_reorden: rpsRes.rows[0].id_reorden,
            esReacondicionado: false,
          });
        }
      }

      const ventaRes = await client.query(
        `INSERT INTO venta (id_sucursal,id_vendedor,id_cliente,id_canal,pago_contra_entrega,
           id_estado_venta,subtotal,descuento_monto,monto_iva,total)
         VALUES ($1,$2,$3,$4,$5,(SELECT id_estado_venta FROM estado_venta WHERE nombre=$6),0,$7,0,0)
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

      for (const det of detallesCalculados) {
        await client.query(
          `INSERT INTO detalle_venta (id_venta,id_producto,id_producto_reacondicionado,cantidad,precio_unitario,porcentaje_iva)
           VALUES ($1,$2,$3,$4,$5,12.00)`,
          [
            id_venta,
            det.id_producto,
            det.id_producto_reacondicionado || null,
            det.cantidad,
            det.precioUnitario,
          ],
        );
      }

      if (pctDescuento > 0) {
        await client.query(
          `UPDATE venta SET descuento_monto=ROUND(subtotal*$1/100,2), total=ROUND(subtotal*(1-$1/100),2) WHERE id_venta=$2`,
          [pctDescuento, id_venta],
        );
      }

      for (const det of detallesCalculados) {
        if (det.esReacondicionado) continue;

        const stockRes = await client.query(
          `SELECT COALESCE(SUM(cantidad_actual),0) AS cantidad_actual FROM lote_detalle
           WHERE id_producto=$1 AND id_sucursal=$2 AND agotado=FALSE AND activo=TRUE`,
          [det.id_producto, data.id_sucursal],
        );

        // id_reorden reemplaza id_producto_sucursal
        // id_tipo_movimiento (FK) reemplaza tipo (VARCHAR)
        const movRes = await client.query(
          `INSERT INTO movimiento_inventario
             (id_reorden,id_usuario,id_tipo_movimiento,cantidad,cantidad_resultante,id_referencia,tabla_referencia,motivo)
           VALUES ($1,$2,(SELECT id_tipo_movimiento FROM tipo_movimiento_inventario WHERE nombre='salida_venta'),$3,$4,$5,'venta','Venta registrada en mostrador o domicilio')
           RETURNING id_movimiento`,
          [
            det.id_reorden,
            id_usuario,
            det.cantidad,
            Number(stockRes.rows[0].cantidad_actual) - det.cantidad,
            id_venta,
          ],
        );

        await client.query(`SELECT fn_consumir_lotes_fifo($1,$2,$3,$4)`, [
          det.id_producto,
          data.id_sucursal,
          det.cantidad,
          movRes.rows[0].id_movimiento,
        ]);
      }

      for (const det of detallesCalculados) {
        if (!det.esReacondicionado) continue;
        await client.query(
          `UPDATE lote_reacondicionado SET cantidad=cantidad-$1 WHERE id_lote=$2`,
          [det.cantidad, det.id_producto_reacondicionado],
        );
      }

      if (data.canal === "domicilio" && data.direccion_entrega) {
        const destRes = await client.query(
          `INSERT INTO destinatario (nombre,telefono,direccion_texto,id_municipio) VALUES ($1,$2,$3,$4) RETURNING id_destinatario`,
          [
            data.nombre_contacto ?? null,
            data.telefono_contacto ?? null,
            data.direccion_entrega,
            data.id_municipio_entrega ?? null,
          ],
        );
        await client.query(
          `INSERT INTO pedido_domicilio (id_venta,id_repartidor,id_estado_pedido,id_destinatario)
           VALUES ($1,$2,(SELECT id_estado_pedido FROM estado_pedido WHERE nombre='pendiente'),$3)`,
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

  async obtenerRepartidores(id_sucursal: number) {
    const result = await this.pool.query(
      `SELECT e.id_empleado, e.nombre, e.apellido, e.disponible,
         COALESCE((SELECT COUNT(*)::int FROM pedido_domicilio pd
           JOIN estado_pedido ep ON pd.id_estado_pedido=ep.id_estado_pedido
           WHERE pd.id_repartidor=e.id_empleado AND ep.nombre='pendiente'),0) AS pedidos_activos
       FROM empleado e
       INNER JOIN usuario u ON u.id_empleado=e.id_empleado
       INNER JOIN rol r ON u.id_rol=r.id_rol
       WHERE e.id_sucursal=$1 AND r.nombre='REPARTIDOR' AND e.activo=true
       ORDER BY e.disponible DESC, pedidos_activos ASC, e.nombre ASC`,
      [id_sucursal],
    );
    return result.rows.map((r) => ({
      id_empleado: r.id_empleado,
      nombre: r.nombre,
      apellido: r.apellido,
      disponible: r.disponible,
      pedidos_activos: Number(r.pedidos_activos),
    }));
  }

  async obtenerPendientesAutorizacion(id_sucursal: number): Promise<any[]> {
    const result = await this.pool.query(
      `SELECT v.id_venta, v.created_at AS fecha,
         COALESCE(c.nombre_razon_social,'Consumidor Final') AS cliente,
         COALESCE(CONCAT(e.nombre,' ',e.apellido),'Sin vendedor') AS vendedor,
         v.subtotal, v.descuento_monto, v.total,
         ROUND((v.descuento_monto/NULLIF(v.subtotal,0))*100,2) AS pct_descuento
       FROM venta v
       JOIN estado_venta ev ON v.id_estado_venta=ev.id_estado_venta
       LEFT JOIN cliente c ON v.id_cliente=c.id_cliente
       LEFT JOIN empleado e ON v.id_vendedor=e.id_empleado
       WHERE v.id_sucursal=$1 AND ev.nombre='pendiente_autorizacion'
       ORDER BY v.created_at ASC`,
      [id_sucursal],
    );
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
        `SELECT ev.nombre AS estado, cv.nombre AS canal, v.pago_contra_entrega, v.id_sucursal, v.subtotal
         FROM venta v
         JOIN estado_venta ev ON v.id_estado_venta=ev.id_estado_venta
         JOIN canal_venta  cv ON v.id_canal=cv.id_canal
         WHERE v.id_venta=$1 FOR UPDATE`,
        [id_venta],
      );
      if (!ventaRes.rows.length) throw new Error("Venta no encontrada");
      const venta = ventaRes.rows[0];
      if (venta.estado !== "pendiente_autorizacion")
        throw new Error("La venta no está pendiente de autorización");

      const estadoDestino =
        venta.canal === "domicilio" && venta.pago_contra_entrega
          ? "pendiente_cobro_contra_entrega"
          : "pendiente_pago";

      if (!aprobado) {
        const nuevoDescuento = Number(
          (Number(venta.subtotal) * 0.05).toFixed(2),
        );
        const nuevoTotal = Number((Number(venta.subtotal) * 0.95).toFixed(2));
        await client.query(
          `UPDATE venta SET id_estado_venta=(SELECT id_estado_venta FROM estado_venta WHERE nombre=$1),
             id_supervisor_autoriza=$2, descuento_monto=$3, total=$4, updated_by=$5 WHERE id_venta=$6`,
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
          `UPDATE venta SET id_estado_venta=(SELECT id_estado_venta FROM estado_venta WHERE nombre=$1),
             id_supervisor_autoriza=$2, updated_by=$3 WHERE id_venta=$4`,
          [estadoDestino, id_supervisor, id_usuario_log, id_venta],
        );
      }
      // log_auditoria eliminado en BD v2

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
    const resVenta = await this.pool.query(
      `SELECT v.id_venta, v.id_sucursal, v.id_vendedor, v.id_cliente,
         v.id_supervisor_autoriza, v.subtotal, v.descuento_monto, v.total,
         v.created_at, v.updated_at, v.pago_contra_entrega, v.monto_iva,
         v.created_by, v.updated_by, v.id_anulado_por, v.motivo_anulacion, v.monto_devolucion,
         cv.nombre AS canal, ev.nombre AS estado,
         COALESCE(c.nombre_razon_social,'Consumidor Final') AS cliente,
         CONCAT(evnd.nombre,' ',evnd.apellido) AS vendedor,
         CONCAT(ean.nombre,' ',ean.apellido)   AS anulado_por,
         pd.id_pedido, ep.nombre AS estado_pedido, pd.motivo_fallido,
         pd.id_repartidor AS id_repartidor_actual,
         CONCAT(er.nombre,' ',er.apellido) AS repartidor_actual
       FROM venta v
       JOIN  canal_venta   cv ON v.id_canal        = cv.id_canal
       JOIN  estado_venta  ev ON v.id_estado_venta = ev.id_estado_venta
       LEFT JOIN cliente    c ON v.id_cliente      = c.id_cliente
       LEFT JOIN empleado evnd ON v.id_vendedor    = evnd.id_empleado
       LEFT JOIN empleado ean  ON v.id_anulado_por = ean.id_empleado
       LEFT JOIN pedido_domicilio pd ON pd.id_venta         = v.id_venta
       LEFT JOIN estado_pedido    ep ON pd.id_estado_pedido = ep.id_estado_pedido
       LEFT JOIN empleado         er ON pd.id_repartidor   = er.id_empleado
       WHERE v.id_venta=$1`,
      [id_venta],
    );
    if (!resVenta.rows.length) return null;

    const resDetalles = await this.pool.query(
      `SELECT dv.id_detalle, dv.id_producto, p.nombre AS producto, p.sku,
         p.garantia_dias, dv.cantidad, dv.precio_unitario, dv.subtotal_linea, dv.monto_iva,
         EXISTS(SELECT 1 FROM garantia g
           JOIN estado_garantia eg ON g.id_estado_garantia=eg.id_estado_garantia
           WHERE g.id_detalle_venta=dv.id_detalle AND eg.nombre IN ('en_revision','aprobada','rechazada')
         ) AS tiene_garantia
       FROM detalle_venta dv
       JOIN producto p ON dv.id_producto=p.id_producto
       WHERE dv.id_venta=$1`,
      [id_venta],
    );

    return {
      venta: resVenta.rows[0],
      detalles: resDetalles.rows.map((r) => ({
        ...r,
        cantidad: Number(r.cantidad),
        precio_unitario: Number(r.precio_unitario),
        subtotal_linea: Number(r.subtotal_linea),
        monto_iva: Number(r.monto_iva),
        garantia_dias: Number(r.garantia_dias),
        tiene_garantia: r.tiene_garantia === true,
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
      filtroVendedor = `AND v.id_vendedor=$${values.length}`;
    }

    const result = await this.pool.query(
      `SELECT v.id_venta, v.created_at AS fecha, ev.nombre AS estado,
         v.subtotal, v.descuento_monto, v.total,
         ROUND((v.descuento_monto/NULLIF(v.subtotal,0))*100,2) AS pct_descuento,
         COALESCE(c.nombre_razon_social,'Consumidor Final') AS cliente,
         COALESCE(CONCAT(evnd.nombre,' ',evnd.apellido),'Sin asignar') AS vendedor,
         CASE WHEN v.descuento_monto/NULLIF(v.subtotal,0)>0.05 THEN 'requirio_aprobacion' ELSE 'automatico' END AS tipo_descuento,
         COALESCE(CONCAT(es.nombre,' ',es.apellido),NULL) AS aprobado_por
       FROM venta v
       JOIN  estado_venta   ev   ON v.id_estado_venta      = ev.id_estado_venta
       LEFT JOIN cliente     c   ON v.id_cliente            = c.id_cliente
       LEFT JOIN empleado evnd   ON v.id_vendedor           = evnd.id_empleado
       LEFT JOIN empleado   es   ON v.id_supervisor_autoriza = es.id_empleado
       WHERE v.id_sucursal=$1 AND v.descuento_monto>0
         AND DATE(v.created_at) BETWEEN $2 AND $3 ${filtroVendedor}
       ORDER BY v.created_at DESC`,
      values,
    );

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
