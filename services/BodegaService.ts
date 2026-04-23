// services/BodegaService.ts
import { Pool } from "pg";
import { EmitirDespachoDTO, AjusteInventarioDTO } from "../dtos/BodegaDTO";

export class BodegaService {
  constructor(private readonly pool: Pool) {}

  //Inventario local con costo promedio ponderado
  async obtenerInventarioLocal(id_sucursal: number, filtros?: any) {
    let query = `
      SELECT
        ps.id_producto_sucursal,
        ps.id_producto,
        p.sku,
        p.nombre,
        ps.punto_reorden,
        c.nombre  AS categoria,
        m.nombre  AS marca_repuesto,
        p.precio_venta,
        COALESCE(lotes_costo.cantidad_actual, 0)        AS cantidad_actual,
        COALESCE(
          lotes_costo.costo_promedio_ponderado,
          pp_costo.precio_costo,
          0
        ) AS costo,
        COALESCE(lotes_costo.total_lotes, 0) AS total_lotes,
        (COALESCE(lotes_costo.cantidad_actual, 0) <= ps.punto_reorden) AS requiere_reorden,
        (SELECT COALESCE(SUM(ld2.cantidad_actual), 0)
         FROM lote_detalle ld2
         WHERE ld2.id_producto = p.id_producto
           AND ld2.id_sucursal != $1
           AND ld2.agotado = FALSE
           AND ld2.activo  = TRUE
        ) AS stock_otras_sucursales,
        (SELECT COALESCE(json_agg(json_build_object('sucursal', s2.nombre, 'cantidad', suc_stock.cantidad)), '[]'::json)
         FROM (
           SELECT ld2.id_sucursal, SUM(ld2.cantidad_actual) AS cantidad
           FROM lote_detalle ld2
           WHERE ld2.id_producto = p.id_producto
             AND ld2.id_sucursal != $1
             AND ld2.agotado = FALSE
             AND ld2.activo  = TRUE
           GROUP BY ld2.id_sucursal
           HAVING SUM(ld2.cantidad_actual) > 0
         ) suc_stock
         JOIN sucursal s2 ON suc_stock.id_sucursal = s2.id_sucursal
        ) AS detalle_otras_sucursales,
        (SELECT COALESCE(json_agg(json_build_object(
            'marca', mv.nombre,
            'modelo', mod.nombre,
            'anio_desde', cp.anio_desde,
            'anio_hasta', cp.anio_hasta,
            'es_universal', cp.es_universal
          )), '[]'::json)
         FROM compatibilidad_producto cp
         LEFT JOIN modelo_vehiculo mod ON cp.id_modelo = mod.id_modelo
         LEFT JOIN marca_vehiculo mv  ON mod.id_marca_vehiculo = mv.id_marca_vehiculo
         WHERE cp.id_producto = p.id_producto) AS compatibilidades
      FROM producto_sucursal ps
      JOIN producto p ON ps.id_producto = p.id_producto
      LEFT JOIN categoria_producto c ON p.id_categoria = c.id_categoria
      LEFT JOIN marca              m ON p.id_marca     = m.id_marca
      -- Costo del proveedor principal (fallback cuando no hay lotes activos)
      LEFT JOIN LATERAL (
        SELECT precio_costo
        FROM producto_proveedor
        WHERE id_producto = p.id_producto
          AND es_principal = TRUE
          AND activo = TRUE
        LIMIT 1
      ) pp_costo ON true
      LEFT JOIN LATERAL (
        SELECT
          SUM(ld.cantidad_actual) AS cantidad_actual,
          ROUND(
            SUM(ld.cantidad_actual * ld.costo_unitario) / NULLIF(SUM(ld.cantidad_actual), 0),
            2
          ) AS costo_promedio_ponderado,
          COUNT(DISTINCT ld.id_lote) AS total_lotes
        FROM lote_detalle ld
        WHERE ld.id_producto = p.id_producto
          AND ld.id_sucursal = ps.id_sucursal
          AND ld.agotado     = FALSE
          AND ld.activo      = TRUE
      ) lotes_costo ON true
      WHERE ps.id_sucursal = $1
        AND ps.activo = TRUE
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

  //Lotes activos de un producto en una sucursal
  async obtenerLotesDeProducto(id_producto: number, id_sucursal: number) {
    const query = `
      SELECT
        li.id_lote,
        li.es_apertura,
        li.id_orden_compra,
        li.fecha_ingreso                          AS fecha_ingreso,
        SUM(ld.cantidad_actual)                   AS cantidad_actual,
        ROUND(
          SUM(ld.cantidad_actual * ld.costo_unitario)
          / NULLIF(SUM(ld.cantidad_actual), 0),
          2
        )                                         AS costo_unitario
      FROM lote_detalle ld
      JOIN lote_inventario li ON ld.id_lote = li.id_lote
      WHERE ld.id_producto = $1
        AND ld.id_sucursal = $2
        AND ld.agotado     = FALSE
        AND ld.activo      = TRUE
      GROUP BY li.id_lote, li.es_apertura, li.id_orden_compra, li.fecha_ingreso
      ORDER BY li.fecha_ingreso ASC;
    `;

    const result = await this.pool.query(query, [id_producto, id_sucursal]);

    return result.rows.map((row) => ({
      id_lote: Number(row.id_lote),
      cantidad_actual: Number(row.cantidad_actual),
      costo_unitario: Number(row.costo_unitario),
      fecha_ingreso: row.fecha_ingreso as Date,
      es_apertura: row.es_apertura as boolean,
      id_orden_compra: row.id_orden_compra ? Number(row.id_orden_compra) : null,
    }));
  }

  //Emitir despacho de traslado
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
        //FOR UPDATE simple
        const psRes = await client.query(
          `SELECT ps.id_producto_sucursal
           FROM producto_sucursal ps
           WHERE ps.id_producto = $1
             AND ps.id_sucursal = $2
             AND ps.activo      = TRUE
           FOR UPDATE OF ps`,
          [det.id_producto, id_sucursal_origen],
        );

        if (psRes.rows.length === 0) {
          throw new Error(
            `Stock insuficiente para el producto ID: ${det.id_producto}`,
          );
        }

        const id_producto_sucursal = psRes.rows[0].id_producto_sucursal;

        const stockRes = await client.query(
          `SELECT COALESCE(SUM(cantidad_actual), 0) AS cantidad_actual
           FROM lote_detalle
           WHERE id_producto = $1
             AND id_sucursal = $2
             AND agotado = FALSE
             AND activo  = TRUE`,
          [det.id_producto, id_sucursal_origen],
        );

        if (Number(stockRes.rows[0].cantidad_actual) < det.cantidad) {
          throw new Error(
            `Stock insuficiente para el producto ID: ${det.id_producto}`,
          );
        }

        const nueva_cantidad =
          Number(stockRes.rows[0].cantidad_actual) - det.cantidad;

        //El stock se descuenta en lote_detalle vía fn_consumir_lotes_fifo

        await client.query(
          `INSERT INTO detalle_despacho (id_despacho, id_producto, cantidad) VALUES ($1, $2, $3)`,
          [id_despacho, det.id_producto, det.cantidad],
        );

        const movRes = await client.query(
          `INSERT INTO movimiento_inventario
             (id_producto_sucursal, id_usuario, tipo, cantidad, cantidad_resultante,
              id_referencia, tabla_referencia, motivo)
           VALUES ($1, $2, 'salida_traslado', $3, $4, $5, 'nota_despacho',
                   'Envío de mercadería a otra sucursal')
           RETURNING id_movimiento`,
          [
            id_producto_sucursal,
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

  //Confirmar recepción de traslado
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

        //Obtener o crear registro en producto_sucursal para el destino
        const psRes = await client.query(
          `INSERT INTO producto_sucursal (id_producto, id_sucursal)
           VALUES ($1, $2)
           ON CONFLICT (id_producto, id_sucursal) DO UPDATE
             SET updated_at = NOW()
           RETURNING id_producto_sucursal`,
          [det.id_producto, id_sucursal_destino],
        );

        const id_producto_sucursal = psRes.rows[0].id_producto_sucursal;

        //Stock en destino antes de insertar el lote_detalle nuevo
        const stockDestinoRes = await client.query(
          `SELECT COALESCE(SUM(cantidad_actual), 0) AS stock
           FROM lote_detalle
           WHERE id_producto = $1
             AND id_sucursal = $2
             AND agotado = FALSE
             AND activo  = TRUE`,
          [det.id_producto, id_sucursal_destino],
        );
        const nueva_cantidad =
          Number(stockDestinoRes.rows[0].stock) + cantidadRecibida;

        //Movimiento de entrada
        await client.query(
          `INSERT INTO movimiento_inventario
             (id_producto_sucursal, id_usuario, tipo, cantidad, cantidad_resultante,
              id_referencia, tabla_referencia, motivo)
           VALUES ($1, $2, 'entrada_traslado', $3, $4, $5, 'nota_despacho',
                   'Recepción de mercadería desde otra sucursal')`,
          [
            id_producto_sucursal,
            id_usuario,
            cantidadRecibida,
            nueva_cantidad,
            id_despacho,
          ],
        );

        //Recuperar el id_lote del lote_detalle origen que fue consumido
        const lotesOrigenRes = await client.query(
          `SELECT
             ld.id_lote,
             ld.costo_unitario,
             SUM(dcl.cantidad) AS cantidad_consumida
           FROM detalle_consumo_lote dcl
           JOIN lote_detalle ld ON dcl.id_lote_detalle = ld.id_lote_detalle
           JOIN movimiento_inventario mi ON dcl.id_movimiento = mi.id_movimiento
           WHERE mi.id_referencia   = $1
             AND mi.tabla_referencia = 'nota_despacho'
             AND mi.tipo             = 'salida_traslado'
             AND ld.id_producto      = $2
             AND ld.id_sucursal      = $3
           GROUP BY ld.id_lote, ld.costo_unitario
           ORDER BY ld.id_lote ASC`,
          [id_despacho, det.id_producto, id_sucursal_origen],
        );

        if (lotesOrigenRes.rows.length > 0) {
          //caso normal: hay trazabilidad del lote origen
          for (const loteOrigen of lotesOrigenRes.rows) {
            await client.query(
              `INSERT INTO lote_detalle
                 (id_lote, id_producto, id_sucursal, id_despacho,
                  costo_unitario, cantidad_inicial, cantidad_actual, fecha_ingreso)
               SELECT
                 $1, $2, $3, $4,
                 $5, $6, $6,
                 li.fecha_ingreso
               FROM lote_inventario li
               WHERE li.id_lote = $1`,
              [
                Number(loteOrigen.id_lote),
                det.id_producto,
                id_sucursal_destino,
                id_despacho,
                Number(loteOrigen.costo_unitario),
                Number(loteOrigen.cantidad_consumida),
              ],
            );
          }
        } else {
          //lote de apertura histórica sin id_lote_detalle
          const lotesOrigenLegacyRes = await client.query(
            `SELECT
               dcl.id_lote,
               ld_legacy.costo_unitario,
               SUM(dcl.cantidad) AS cantidad_consumida
             FROM detalle_consumo_lote dcl
             JOIN lote_inventario ld_legacy ON dcl.id_lote = ld_legacy.id_lote
             JOIN movimiento_inventario mi ON dcl.id_movimiento = mi.id_movimiento
             WHERE mi.id_referencia    = $1
               AND mi.tabla_referencia  = 'nota_despacho'
               AND mi.tipo              = 'salida_traslado'
               AND ld_legacy.id_producto = $2
               AND ld_legacy.id_sucursal = $3
             GROUP BY dcl.id_lote, ld_legacy.costo_unitario
             ORDER BY dcl.id_lote ASC`,
            [id_despacho, det.id_producto, id_sucursal_origen],
          );

          if (lotesOrigenLegacyRes.rows.length > 0) {
            for (const loteOrigen of lotesOrigenLegacyRes.rows) {
              await client.query(
                `INSERT INTO lote_detalle
                   (id_lote, id_producto, id_sucursal, id_despacho,
                    costo_unitario, cantidad_inicial, cantidad_actual, fecha_ingreso)
                 SELECT
                   $1, $2, $3, $4,
                   $5, $6, $6,
                   li.fecha_ingreso
                 FROM lote_inventario li
                 WHERE li.id_lote = $1`,
                [
                  Number(loteOrigen.id_lote),
                  det.id_producto,
                  id_sucursal_destino,
                  id_despacho,
                  Number(loteOrigen.costo_unitario),
                  Number(loteOrigen.cantidad_consumida),
                ],
              );
            }
          } else {
            //Último fallback: sin ninguna trazabilidad
            const costoRes = await client.query(
              `SELECT COALESCE(
                 (SELECT costo_unitario
                  FROM lote_detalle
                  WHERE id_producto = $1 AND id_sucursal = $2
                  ORDER BY fecha_ingreso ASC LIMIT 1),
                 (SELECT precio_costo FROM producto_proveedor
                  WHERE id_producto = $1 AND es_principal = TRUE AND activo = TRUE LIMIT 1),
                 0.00
               ) AS costo_unitario`,
              [det.id_producto, id_sucursal_origen],
            );

            const nuevoLoteRes = await client.query(
              `INSERT INTO lote_inventario (es_apertura)
               VALUES (TRUE)
               RETURNING id_lote`,
            );

            await client.query(
              `INSERT INTO lote_detalle
                 (id_lote, id_producto, id_sucursal, id_despacho,
                  costo_unitario, cantidad_inicial, cantidad_actual)
               VALUES ($1, $2, $3, $4, $5, $6, $6)`,
              [
                nuevoLoteRes.rows[0].id_lote,
                det.id_producto,
                id_sucursal_destino,
                id_despacho,
                Number(costoRes.rows[0].costo_unitario),
                cantidadRecibida,
              ],
            );
          }
        }
      }

      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  //Ajuste de inventario
  //El stock se calcula desde lote_detalle, el movimiento usa id_producto_sucursal.
  async ajustarInventario(
    id_sucursal: number,
    id_usuario: number,
    data: AjusteInventarioDTO,
  ) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      const psRes = await client.query(
        `SELECT ps.id_producto_sucursal
         FROM producto_sucursal ps
         WHERE ps.id_producto = $1
           AND ps.id_sucursal = $2
           AND ps.activo = TRUE
         FOR UPDATE OF ps`,
        [data.id_producto, id_sucursal],
      );

      if (psRes.rows.length === 0)
        throw new Error("Producto no registrado en esta sucursal");

      const id_producto_sucursal = psRes.rows[0].id_producto_sucursal;

      const stockRes = await client.query(
        `SELECT COALESCE(SUM(cantidad_actual), 0) AS cantidad_actual
         FROM lote_detalle
         WHERE id_producto = $1
           AND id_sucursal = $2
           AND agotado = FALSE
           AND activo  = TRUE`,
        [data.id_producto, id_sucursal],
      );

      const cantidad_actual = Number(stockRes.rows[0].cantidad_actual);

      let nueva_cantidad = cantidad_actual;
      if (data.tipo === "ajuste_positivo") nueva_cantidad += data.cantidad;
      else if (data.tipo === "ajuste_negativo") nueva_cantidad -= data.cantidad;

      if (nueva_cantidad < 0)
        throw new Error(
          "El ajuste negativo dejaría el stock en números rojos.",
        );

      const movRes = await client.query(
        `INSERT INTO movimiento_inventario
           (id_producto_sucursal, id_usuario, tipo, cantidad, cantidad_resultante, motivo)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id_movimiento`,
        [
          id_producto_sucursal,
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
        //ajuste_positivo: crear lote_inventario +
        //su lote_detalle correspondiente en esta sucursal.
        const costoRes = await client.query(
          `SELECT COALESCE(
             (SELECT precio_costo FROM producto_proveedor
              WHERE id_producto = $1 AND es_principal = TRUE AND activo = TRUE LIMIT 1),
             0.00
           ) AS costo_unitario`,
          [data.id_producto],
        );

        const nuevoLoteRes = await client.query(
          `INSERT INTO lote_inventario (es_apertura)
           VALUES (FALSE)
           RETURNING id_lote`,
        );

        await client.query(
          `INSERT INTO lote_detalle
             (id_lote, id_producto, id_sucursal,
              costo_unitario, cantidad_inicial, cantidad_actual, fecha_ingreso)
           VALUES ($1, $2, $3, $4, $5, $5, NOW())`,
          [
            nuevoLoteRes.rows[0].id_lote,
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
