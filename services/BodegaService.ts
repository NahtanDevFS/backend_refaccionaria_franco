// services/BodegaService.ts
import { Pool } from "pg";
import { EmitirDespachoDTO, AjusteInventarioDTO } from "../dtos/BodegaDTO";

export class BodegaService {
  constructor(private readonly pool: Pool) {}

  async obtenerInventarioLocal(id_sucursal: number, filtros?: any) {
    let query = `
      SELECT 
        i.id_inventario, i.id_producto, p.sku, p.nombre,
        i.cantidad_actual, i.punto_reorden,
        c.nombre  AS categoria,
        m.nombre  AS marca_repuesto,
        p.precio_venta,
        -- ── Costo promedio ponderado de lotes activos ──────────────────────
        -- Refleja el costo real del stock disponible hoy. Si no hay lotes
        -- activos (producto sin stock), cae al costo del proveedor principal.
        COALESCE(
          lotes_costo.costo_promedio_ponderado,
          pp_costo.precio_costo,
          0
        ) AS costo,
        -- ── Cantidad de lotes activos (para el indicador expandible en UI) ─
        COALESCE(lotes_costo.total_lotes, 0) AS total_lotes,
        (i.cantidad_actual <= i.punto_reorden) AS requiere_reorden,
        (SELECT COALESCE(SUM(i2.cantidad_actual), 0)
         FROM inventario_sucursal i2
         WHERE i2.id_producto = p.id_producto AND i2.id_sucursal != $1) AS stock_otras_sucursales,
        (SELECT COALESCE(json_agg(json_build_object('sucursal', s.nombre, 'cantidad', i2.cantidad_actual)), '[]'::json)
         FROM inventario_sucursal i2
         JOIN sucursal s ON i2.id_sucursal = s.id_sucursal
         WHERE i2.id_producto = p.id_producto AND i2.id_sucursal != $1 AND i2.cantidad_actual > 0) AS detalle_otras_sucursales,
        (SELECT COALESCE(json_agg(json_build_object(
            'marca', mv.nombre, 
            'modelo', mod.nombre, 
            'anio_desde', cp.anio_desde, 
            'anio_hasta', cp.anio_hasta, 
            'es_universal', cp.es_universal
          )), '[]'::json)
         FROM compatibilidad_producto cp
         LEFT JOIN modelo_vehiculo mod ON cp.id_modelo = mod.id_modelo
         LEFT JOIN marca_vehiculo mv ON mod.id_marca_vehiculo = mv.id_marca_vehiculo
         WHERE cp.id_producto = p.id_producto) AS compatibilidades
      FROM inventario_sucursal i
      JOIN producto p ON i.id_producto = p.id_producto
      LEFT JOIN categoria_producto c ON p.id_categoria = c.id_categoria
      LEFT JOIN marca m ON p.id_marca = m.id_marca
      -- Costo del proveedor principal (fallback cuando no hay lotes activos)
      LEFT JOIN LATERAL (
        SELECT precio_costo
        FROM producto_proveedor
        WHERE id_producto = p.id_producto
          AND es_principal = TRUE
          AND activo = TRUE
        LIMIT 1
      ) pp_costo ON true
      -- Costo promedio ponderado y conteo de lotes activos
      LEFT JOIN LATERAL (
        SELECT
          ROUND(
            SUM(l.cantidad_actual * l.costo_unitario) / NULLIF(SUM(l.cantidad_actual), 0),
            2
          ) AS costo_promedio_ponderado,
          COUNT(*) AS total_lotes
        FROM lote_inventario l
        WHERE l.id_producto = p.id_producto
          AND l.id_sucursal = i.id_sucursal
          AND l.agotado     = FALSE
          AND l.activo      = TRUE
      ) lotes_costo ON true
      WHERE i.id_sucursal = $1
    `;

    const params: any[] = [id_sucursal];
    let paramIndex = 2;

    if (filtros?.termino) {
      query += ` AND (p.sku ILIKE $${paramIndex} OR p.nombre ILIKE $${paramIndex})`;
      params.push(`%${filtros.termino}%`);
      paramIndex++;
    }

    if (filtros?.id_categoria) {
      query += ` AND p.id_categoria = $${paramIndex}`;
      params.push(filtros.id_categoria);
      paramIndex++;
    }

    if (filtros?.id_marca) {
      query += ` AND p.id_marca = $${paramIndex}`;
      params.push(filtros.id_marca);
      paramIndex++;
    }

    if (filtros?.id_modelo_vehiculo) {
      query += ` AND EXISTS (
        SELECT 1 FROM compatibilidad_producto cp 
        WHERE cp.id_producto = p.id_producto AND (cp.es_universal = true OR cp.id_modelo = $${paramIndex})
      )`;
      params.push(filtros.id_modelo_vehiculo);
      paramIndex++;
    }

    query += ` ORDER BY requiere_reorden DESC, p.nombre ASC LIMIT 200;`;

    const result = await this.pool.query(query, params);

    return result.rows.map((row) => ({
      ...row,
      cantidad_actual: Number(row.cantidad_actual),
      punto_reorden: Number(row.punto_reorden),
      stock_otras_sucursales: Number(row.stock_otras_sucursales),
      precio_venta: Number(row.precio_venta || 0),
      costo: Number(row.costo || 0),
      total_lotes: Number(row.total_lotes || 0),
    }));
  }

  // ── Lotes activos de un producto en una sucursal ───────────────────────────
  // Endpoint lazy: solo se llama cuando el usuario expande el panel de lotes.
  // No se incluye en el listado general para no penalizar la carga inicial.
  async obtenerLotesDeProducto(id_producto: number, id_sucursal: number) {
    const query = `
      SELECT
        id_lote,
        cantidad_actual,
        costo_unitario,
        fecha_ingreso,
        -- Identifica el lote de apertura (stock histórico sin trazabilidad real)
        (DATE(fecha_ingreso) = '2026-04-20') AS es_apertura
      FROM lote_inventario
      WHERE id_producto = $1
        AND id_sucursal = $2
        AND agotado     = FALSE
        AND activo      = TRUE
      ORDER BY fecha_ingreso ASC;
    `;

    const result = await this.pool.query(query, [id_producto, id_sucursal]);

    return result.rows.map((row) => ({
      id_lote: Number(row.id_lote),
      cantidad_actual: Number(row.cantidad_actual),
      costo_unitario: Number(row.costo_unitario),
      fecha_ingreso: row.fecha_ingreso as Date,
      es_apertura: row.es_apertura as boolean,
    }));
  }

  async emitirDespacho(
    id_sucursal_origen: number,
    id_usuario: number,
    data: EmitirDespachoDTO,
  ) {
    if (id_sucursal_origen === data.id_sucursal_destino) {
      throw new Error(
        "La sucursal destino no puede ser la misma que el origen",
      );
    }

    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      const resNota = await client.query(
        `INSERT INTO nota_despacho (id_sucursal_origen, id_sucursal_destino, id_usuario_emite, estado)
         VALUES ($1, $2, $3, 'en_ruta') RETURNING id_despacho`,
        [id_sucursal_origen, data.id_sucursal_destino, id_usuario],
      );

      const id_despacho = resNota.rows[0].id_despacho;

      for (const det of data.detalles) {
        const invRes = await client.query(
          `SELECT id_inventario, cantidad_actual FROM inventario_sucursal 
           WHERE id_producto = $1 AND id_sucursal = $2 FOR UPDATE`,
          [det.id_producto, id_sucursal_origen],
        );

        if (
          invRes.rows.length === 0 ||
          Number(invRes.rows[0].cantidad_actual) < det.cantidad
        ) {
          throw new Error(
            `Stock insuficiente para el producto ID: ${det.id_producto}`,
          );
        }

        const id_inventario = invRes.rows[0].id_inventario;
        const nueva_cantidad =
          Number(invRes.rows[0].cantidad_actual) - det.cantidad;

        await client.query(
          `UPDATE inventario_sucursal SET cantidad_actual = $1 WHERE id_inventario = $2`,
          [nueva_cantidad, id_inventario],
        );

        await client.query(
          `INSERT INTO detalle_despacho (id_despacho, id_producto, cantidad) VALUES ($1, $2, $3)`,
          [id_despacho, det.id_producto, det.cantidad],
        );

        const movRes = await client.query(
          `INSERT INTO movimiento_inventario
             (id_inventario, id_usuario, tipo, cantidad, cantidad_resultante,
              id_referencia, tabla_referencia, motivo)
           VALUES ($1, $2, 'salida_traslado', $3, $4, $5, 'nota_despacho',
                   'Envío de mercadería a otra sucursal')
           RETURNING id_movimiento`,
          [
            id_inventario,
            id_usuario,
            det.cantidad,
            nueva_cantidad,
            id_despacho,
          ],
        );

        await client.query(`SELECT fn_consumir_lotes_fifo($1, $2, $3, $4)`, [
          det.id_producto,
          id_sucursal_origen,
          det.cantidad,
          movRes.rows[0].id_movimiento,
        ]);
      }

      await client.query("COMMIT");
      return id_despacho;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async obtenerRecepciones(id_sucursal_destino: number) {
    const query = `
      SELECT 
        nd.id_despacho, nd.fecha_emision, s.nombre AS origen,
        (SELECT json_agg(json_build_object('producto', p.nombre, 'sku', p.sku, 'cantidad', dd.cantidad))
         FROM detalle_despacho dd JOIN producto p ON dd.id_producto = p.id_producto
         WHERE dd.id_despacho = nd.id_despacho) AS productos
      FROM nota_despacho nd
      JOIN sucursal s ON nd.id_sucursal_origen = s.id_sucursal
      WHERE nd.id_sucursal_destino = $1 AND nd.estado = 'en_ruta'
      ORDER BY nd.fecha_emision ASC;
    `;
    const res = await this.pool.query(query, [id_sucursal_destino]);
    return res.rows;
  }

  async confirmarRecepcion(
    id_despacho: number,
    id_sucursal_destino: number,
    id_usuario: number,
  ) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      const notaRes = await client.query(
        `SELECT estado, id_sucursal_origen FROM nota_despacho
         WHERE id_despacho = $1 AND id_sucursal_destino = $2 FOR UPDATE`,
        [id_despacho, id_sucursal_destino],
      );
      if (notaRes.rows.length === 0)
        throw new Error(
          "Nota de despacho no encontrada o no pertenece a esta sucursal",
        );
      if (notaRes.rows[0].estado !== "en_ruta")
        throw new Error("El despacho ya fue procesado");

      const id_sucursal_origen = Number(notaRes.rows[0].id_sucursal_origen);

      await client.query(
        `UPDATE nota_despacho SET estado = 'recibido', fecha_recepcion = NOW()
         WHERE id_despacho = $1`,
        [id_despacho],
      );

      const detallesRes = await client.query(
        `SELECT id_producto, cantidad FROM detalle_despacho WHERE id_despacho = $1`,
        [id_despacho],
      );

      for (const det of detallesRes.rows) {
        const cantidadRecibida = Number(det.cantidad);

        const invRes = await client.query(
          `INSERT INTO inventario_sucursal (id_producto, id_sucursal, cantidad_actual)
           VALUES ($1, $2, $3)
           ON CONFLICT (id_producto, id_sucursal)
           DO UPDATE SET cantidad_actual = inventario_sucursal.cantidad_actual + EXCLUDED.cantidad_actual
           RETURNING id_inventario, cantidad_actual`,
          [det.id_producto, id_sucursal_destino, cantidadRecibida],
        );

        const id_inventario = invRes.rows[0].id_inventario;
        const nueva_cantidad = Number(invRes.rows[0].cantidad_actual);

        await client.query(
          `INSERT INTO movimiento_inventario
             (id_inventario, id_usuario, tipo, cantidad, cantidad_resultante,
              id_referencia, tabla_referencia, motivo)
           VALUES ($1, $2, 'entrada_traslado', $3, $4, $5, 'nota_despacho',
                   'Recepción de mercadería desde otra sucursal')`,
          [
            id_inventario,
            id_usuario,
            cantidadRecibida,
            nueva_cantidad,
            id_despacho,
          ],
        );

        const costoRes = await client.query(
          `SELECT COALESCE(
             (SELECT costo_unitario FROM lote_inventario
              WHERE id_producto = $1 AND id_sucursal = $2
              ORDER BY fecha_ingreso ASC LIMIT 1),
             (SELECT precio_costo FROM producto_proveedor
              WHERE id_producto = $1 AND es_principal = TRUE AND activo = TRUE LIMIT 1),
             0.00
           ) AS costo_unitario`,
          [det.id_producto, id_sucursal_origen],
        );

        await client.query(
          `INSERT INTO lote_inventario
             (id_producto, id_sucursal, id_despacho,
              costo_unitario, cantidad_inicial, cantidad_actual, fecha_ingreso)
           VALUES ($1, $2, $3, $4, $5, $5, NOW())`,
          [
            det.id_producto,
            id_sucursal_destino,
            id_despacho,
            Number(costoRes.rows[0].costo_unitario),
            cantidadRecibida,
          ],
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

  async ajustarInventario(
    id_sucursal: number,
    id_usuario: number,
    data: AjusteInventarioDTO,
  ) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      const invRes = await client.query(
        `SELECT id_inventario, cantidad_actual FROM inventario_sucursal
         WHERE id_producto = $1 AND id_sucursal = $2 FOR UPDATE`,
        [data.id_producto, id_sucursal],
      );
      if (invRes.rows.length === 0)
        throw new Error("Producto no registrado en esta sucursal");

      const id_inventario = invRes.rows[0].id_inventario;
      const cantidad_actual = Number(invRes.rows[0].cantidad_actual);

      let nueva_cantidad = cantidad_actual;
      if (data.tipo === "ajuste_positivo") nueva_cantidad += data.cantidad;
      else if (data.tipo === "ajuste_negativo") nueva_cantidad -= data.cantidad;

      if (nueva_cantidad < 0)
        throw new Error(
          "El ajuste negativo dejaría el stock en números rojos.",
        );

      await client.query(
        `UPDATE inventario_sucursal SET cantidad_actual = $1 WHERE id_inventario = $2`,
        [nueva_cantidad, id_inventario],
      );

      const movRes = await client.query(
        `INSERT INTO movimiento_inventario
           (id_inventario, id_usuario, tipo, cantidad, cantidad_resultante, motivo)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id_movimiento`,
        [
          id_inventario,
          id_usuario,
          data.tipo,
          data.cantidad,
          nueva_cantidad,
          data.motivo,
        ],
      );

      const id_movimiento = movRes.rows[0].id_movimiento;

      if (data.tipo === "ajuste_negativo") {
        await client.query(`SELECT fn_consumir_lotes_fifo($1, $2, $3, $4)`, [
          data.id_producto,
          id_sucursal,
          data.cantidad,
          id_movimiento,
        ]);
      } else {
        const costoRes = await client.query(
          `SELECT COALESCE(
             (SELECT precio_costo FROM producto_proveedor
              WHERE id_producto = $1 AND es_principal = TRUE AND activo = TRUE LIMIT 1),
             0.00
           ) AS costo_unitario`,
          [data.id_producto],
        );

        await client.query(
          `INSERT INTO lote_inventario
             (id_producto, id_sucursal,
              costo_unitario, cantidad_inicial, cantidad_actual, fecha_ingreso)
           VALUES ($1, $2, $3, $4, $4, NOW())`,
          [
            data.id_producto,
            id_sucursal,
            Number(costoRes.rows[0].costo_unitario),
            data.cantidad,
          ],
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
}
