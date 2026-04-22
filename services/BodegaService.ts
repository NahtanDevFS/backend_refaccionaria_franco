// services/BodegaService.ts
import { Pool } from "pg";
import { EmitirDespachoDTO, AjusteInventarioDTO } from "../dtos/BodegaDTO";

export class BodegaService {
  constructor(private readonly pool: Pool) {}

  // ── Inventario local con costo promedio ponderado ─────────────────────────
  // Cambio: el LATERAL de costo promedio ahora consulta lote_detalle
  // en lugar de lote_inventario.
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
      -- Ahora lee lote_detalle, que es la distribución física real por sucursal
      LEFT JOIN LATERAL (
        SELECT
          ROUND(
            SUM(ld.cantidad_actual * ld.costo_unitario) / NULLIF(SUM(ld.cantidad_actual), 0),
            2
          ) AS costo_promedio_ponderado,
          COUNT(DISTINCT ld.id_lote) AS total_lotes
          -- Contar lotes distintos (id_lote), no filas de lote_detalle.
          -- Un traslado genera múltiples filas del mismo id_lote.
        FROM lote_detalle ld
        WHERE ld.id_producto = p.id_producto
          AND ld.id_sucursal = i.id_sucursal
          AND ld.agotado     = FALSE
          AND ld.activo      = TRUE
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
  // Agrupa por id_lote (la compra): si el mismo lote tiene varias filas en
  // lote_detalle para esta sucursal (p.ej. traslados parciales acumulados),
  // se suman sus cantidades y se devuelve una sola fila por lote.
  // El frontend muestra así "Lote #X — N uds" sin duplicar filas del mismo lote.
  async obtenerLotesDeProducto(id_producto: number, id_sucursal: number) {
    const query = `
      SELECT
        li.id_lote,
        li.es_apertura,
        li.id_orden_compra,
        li.fecha_ingreso                          AS fecha_ingreso,
        SUM(ld.cantidad_actual)                   AS cantidad_actual,
        -- Costo promedio ponderado dentro del mismo lote en esta sucursal
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
      -- FIFO: el lote más antiguo (por fecha de la compra original) sale primero
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

  // ── Emitir despacho de traslado ────────────────────────────────────────────
  // Sin cambios: fn_consumir_lotes_fifo ya fue actualizado en la migración
  // para operar sobre lote_detalle. Este método no necesita modificarse.
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

        // fn_consumir_lotes_fifo ya opera sobre lote_detalle tras la migración
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

  // ── Confirmar recepción de traslado ────────────────────────────────────────
  // Cambio principal: al recibir mercadería ya no se crea un lote_inventario
  // nuevo. En cambio se busca el lote_detalle origen que fue consumido por
  // el despacho y se crea un nuevo lote_detalle en la sucursal destino,
  // heredando el id_lote (y por ende el id_orden_compra) del origen.
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

        // ── Actualizar inventario_sucursal destino ─────────────────────────
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

        // ── Movimiento de entrada ──────────────────────────────────────────
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

        // ── Recuperar el id_lote del lote_detalle origen que fue consumido ─
        // Buscamos en detalle_consumo_lote los lotes del despacho origen.
        // Puede haber sido consumido de varios lote_detalle distintos (FIFO),
        // por eso agrupamos por id_lote y sumamos las cantidades.
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
          // ── Caso normal: hay trazabilidad del lote origen ────────────────
          // Por cada id_lote que contribuyó al despacho, creamos un
          // lote_detalle en destino heredando el mismo id_lote.
          // Así las unidades siguen siendo del mismo lote/compra original.
          for (const loteOrigen of lotesOrigenRes.rows) {
            await client.query(
              `INSERT INTO lote_detalle
                 (id_lote, id_producto, id_sucursal, id_despacho,
                  costo_unitario, cantidad_inicial, cantidad_actual, fecha_ingreso)
               SELECT
                 $1, $2, $3, $4,
                 $5, $6, $6,
                 li.fecha_ingreso   -- heredar fecha del lote original (respeta FIFO)
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
          // ── Caso borde: lote de apertura histórica sin id_lote_detalle ───
          // (consumos anteriores a la migración que solo tienen id_lote en
          // detalle_consumo_lote). Intentamos recuperar el id_lote por
          // id_lote directo; si tampoco existe, creamos un lote_inventario
          // de apertura y su lote_detalle correspondiente.
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
            // ── Último fallback: sin ninguna trazabilidad ─────────────────
            // Crear lote_inventario de apertura + lote_detalle.
            // Solo ocurre en casos extremos (datos muy corruptos o ajustes
            // manuales sin movimiento registrado).
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

  // ── Ajuste de inventario ───────────────────────────────────────────────────
  // Cambio: ajuste_positivo ahora inserta en lote_detalle en lugar de
  // lote_inventario. Se crea un lote_inventario sin orden de compra
  // (es_apertura=FALSE, porque es un ajuste manual intencional, no stock
  // histórico) y su lote_detalle asociado.
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
        // fn_consumir_lotes_fifo ya opera sobre lote_detalle tras la migración
        await client.query(`SELECT fn_consumir_lotes_fifo($1, $2, $3, $4)`, [
          data.id_producto,
          id_sucursal,
          data.cantidad,
          id_movimiento,
        ]);
      } else {
        // ajuste_positivo: crear lote_inventario (sin OC, no es apertura) +
        // su lote_detalle correspondiente en esta sucursal.
        const costoRes = await client.query(
          `SELECT COALESCE(
             (SELECT precio_costo FROM producto_proveedor
              WHERE id_producto = $1 AND es_principal = TRUE AND activo = TRUE LIMIT 1),
             0.00
           ) AS costo_unitario`,
          [data.id_producto],
        );

        // El lote representa el "evento de ajuste", no una compra real.
        // es_apertura=FALSE: distingue ajustes intencionales del stock histórico.
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
