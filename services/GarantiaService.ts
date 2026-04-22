// services/GarantiaService.ts
import { Pool } from "pg";
import { CrearGarantiaDTO, ResolverGarantiaDTO } from "../dtos/GarantiaDTO";

export class GarantiaService {
  constructor(private readonly pool: Pool) {}

  async crearGarantia(data: CrearGarantiaDTO): Promise<number> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      const detRes = await client.query(
        `SELECT dv.cantidad as cantidad_comprada, v.created_at as fecha_compra,
                p.garantia_dias, p.id_producto, v.estado as estado_venta
         FROM detalle_venta dv
         JOIN venta v    ON dv.id_venta    = v.id_venta
         JOIN producto p ON dv.id_producto = p.id_producto
         WHERE dv.id_detalle = $1`,
        [data.id_detalle_venta],
      );

      if (detRes.rows.length === 0)
        throw new Error("Detalle de venta no encontrado");

      const { cantidad_comprada, fecha_compra, garantia_dias, estado_venta } =
        detRes.rows[0];

      // Solo se puede reclamar garantía sobre ventas efectivamente pagadas.
      // Ventas pendientes de pago, anuladas o en cualquier otro estado no aplican.
      if (estado_venta !== "pagada")
        throw new Error(
          "Solo se puede reclamar garantía sobre ventas que hayan sido pagadas.",
        );

      if (data.cantidad > Number(cantidad_comprada))
        throw new Error("La cantidad reclamada supera la cantidad comprada.");

      const reclamosPrevios = await client.query(
        `SELECT COALESCE(SUM(cantidad), 0) as total_reclamado
         FROM garantia
         WHERE id_detalle_venta = $1
           AND estado IN ('en_revision', 'aprobada', 'rechazada')`,
        [data.id_detalle_venta],
      );

      if (
        Number(reclamosPrevios.rows[0].total_reclamado) + data.cantidad >
        Number(cantidad_comprada)
      ) {
        throw new Error(
          "La cantidad reclamada más garantías previas superan el total comprado.",
        );
      }

      const fechaLimite = new Date(fecha_compra);
      fechaLimite.setDate(fechaLimite.getDate() + garantia_dias);
      if (new Date() > fechaLimite)
        throw new Error(
          `El plazo de garantía de ${garantia_dias} días ha expirado.`,
        );

      const insertRes = await client.query(
        `INSERT INTO garantia (id_detalle_venta, cantidad, motivo_reclamo, estado)
         VALUES ($1, $2, $3, 'en_revision') RETURNING id_garantia`,
        [data.id_detalle_venta, data.cantidad, data.motivo_reclamo],
      );

      await client.query("COMMIT");
      return insertRes.rows[0].id_garantia;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Resuelve una garantía (aprobación o rechazo).
   *
   * FLUJO APROBADO:
   *   1. Verifica stock — si no hay, lanza error y bloquea la aprobación.
   *   2. Descuenta inventario_sucursal del repuesto de reemplazo.
   *   3. Registra movimiento_inventario (salida_garantia).
   *   4. Consume lotes FIFO con fn_consumir_lotes_fifo().
   *   5. Registra la recepción física de la pieza dañada en retorno_garantia
   *      con estado 'pendiente_inspeccion'.
   *
   * FLUJO RECHAZADO:
   *   Actualiza el estado a 'rechazada'.
   *   [ERROR 3 CORREGIDO] Si el supervisor indica condicion_recibido, registra
   *   también el retorno físico de la pieza con estado 'cerrado' (sin pasar
   *   por inspección técnica, ya que la garantía fue rechazada).
   */
  async resolverGarantia(data: ResolverGarantiaDTO): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      const garRes = await client.query(
        `SELECT g.estado, g.cantidad, dv.id_producto, v.id_sucursal
         FROM garantia g
         JOIN detalle_venta dv ON g.id_detalle_venta = dv.id_detalle
         JOIN venta v          ON dv.id_venta        = v.id_venta
         WHERE g.id_garantia = $1 FOR UPDATE`,
        [data.id_garantia],
      );

      if (garRes.rows.length === 0) throw new Error("Garantía no encontrada");

      const garantia = garRes.rows[0];
      if (garantia.estado !== "en_revision")
        throw new Error("La garantía ya fue resuelta.");

      const nuevoEstado = data.aprobado ? "aprobada" : "rechazada";

      await client.query(
        `UPDATE garantia
         SET estado = $1, resolucion = $2, id_supervisor_aprueba = $3
         WHERE id_garantia = $4`,
        [nuevoEstado, data.resolucion, data.id_supervisor, data.id_garantia],
      );

      if (data.aprobado) {
        // ── ERROR 2 (comportamiento mantenido): si no hay stock, la transacción
        //    hace ROLLBACK y el supervisor ve el mensaje de error. La garantía
        //    permanece en 'en_revision' hasta que haya stock disponible. ────────
        const invRes = await client.query(
          `SELECT id_inventario, cantidad_actual
           FROM inventario_sucursal
           WHERE id_producto = $1 AND id_sucursal = $2
           FOR UPDATE`,
          [garantia.id_producto, garantia.id_sucursal],
        );

        if (
          invRes.rows.length === 0 ||
          Number(invRes.rows[0].cantidad_actual) < garantia.cantidad
        ) {
          throw new Error(
            "Sin stock disponible para este repuesto en la sucursal. " +
              "La garantía permanecerá pendiente hasta que ingrese mercadería.",
          );
        }

        const id_inventario = invRes.rows[0].id_inventario;
        const nueva_cantidad =
          Number(invRes.rows[0].cantidad_actual) - Number(garantia.cantidad);

        await client.query(
          `UPDATE inventario_sucursal
           SET cantidad_actual = $1
           WHERE id_inventario = $2`,
          [nueva_cantidad, id_inventario],
        );

        // Registrar movimiento de salida por garantía
        const movRes = await client.query(
          `INSERT INTO movimiento_inventario
             (id_inventario, id_usuario, tipo, cantidad, cantidad_resultante,
              id_referencia, tabla_referencia, motivo)
           VALUES ($1, $2, 'salida_garantia', $3, $4, $5, 'garantia',
                   'Reemplazo físico por garantía aprobada')
           RETURNING id_movimiento`,
          [
            id_inventario,
            data.id_supervisor,
            garantia.cantidad,
            nueva_cantidad,
            data.id_garantia,
          ],
        );

        const id_movimiento = movRes.rows[0].id_movimiento;

        // FIFO: consumir lotes del repuesto entregado como reemplazo
        await client.query(`SELECT fn_consumir_lotes_fifo($1, $2, $3, $4)`, [
          garantia.id_producto,
          garantia.id_sucursal,
          garantia.cantidad,
          id_movimiento,
        ]);

        // Registrar la recepción física de la pieza dañada
        // Estado: 'pendiente_inspeccion' — pasa a revisión técnica
        await client.query(
          `INSERT INTO retorno_garantia
             (id_garantia, id_empleado_recibe, condicion_recibido, notas_inspeccion, estado)
           VALUES ($1, $2, $3, $4, 'pendiente_inspeccion')`,
          [
            data.id_garantia,
            data.id_supervisor,
            data.condicion_recibido,
            data.notas_inspeccion ?? "",
          ],
        );
      } else {
        // FLUJO RECHAZADO: el supervisor siempre tiene la pieza en la mano al
        // decidir. Al rechazar, simplemente se le devuelve al cliente en ese
        // momento. No hay retorno físico que registrar ni inventario que tocar.
      }

      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  // ── GETTERS ───────────────────────────────────────────────────────────────

  async obtenerPendientes(id_sucursal: number): Promise<any[]> {
    const query = `
      SELECT g.id_garantia, g.cantidad, g.motivo_reclamo, g.fecha_solicitud, g.estado,
             p.nombre as producto, p.sku, p.garantia_dias,
             v.id_venta, v.created_at as fecha_compra,
             COALESCE(c.nombre_razon_social, 'Consumidor Final') as cliente,
             -- Stock disponible para mostrar advertencia en la UI antes de aprobar
             COALESCE(inv.cantidad_actual, 0) as stock_disponible
      FROM garantia g
      JOIN detalle_venta dv ON g.id_detalle_venta = dv.id_detalle
      JOIN venta v          ON dv.id_venta        = v.id_venta
      JOIN producto p       ON dv.id_producto     = p.id_producto
      LEFT JOIN cliente c   ON v.id_cliente       = c.id_cliente
      LEFT JOIN inventario_sucursal inv
             ON inv.id_producto = dv.id_producto
            AND inv.id_sucursal = v.id_sucursal
      WHERE v.id_sucursal = $1 AND g.estado = 'en_revision'
      ORDER BY g.fecha_solicitud ASC
    `;
    const res = await this.pool.query(query, [id_sucursal]);
    return res.rows.map((row) => ({
      ...row,
      cantidad: Number(row.cantidad),
      stock_disponible: Number(row.stock_disponible),
    }));
  }

  async obtenerPendientesInspeccion(id_sucursal: number): Promise<any[]> {
    const query = `
      SELECT rg.id_retorno, rg.condicion_recibido, rg.notas_inspeccion,
             rg.created_at as fecha_ingreso,
             g.id_garantia, g.cantidad,
             p.nombre as producto, p.sku,
             e.nombre as recibio_nombre
      FROM retorno_garantia rg
      JOIN garantia g       ON rg.id_garantia       = g.id_garantia
      JOIN detalle_venta dv ON g.id_detalle_venta   = dv.id_detalle
      JOIN venta v          ON dv.id_venta           = v.id_venta
      JOIN producto p       ON dv.id_producto        = p.id_producto
      JOIN empleado e       ON rg.id_empleado_recibe = e.id_empleado
      WHERE v.id_sucursal = $1 AND rg.estado = 'pendiente_inspeccion'
      ORDER BY rg.created_at ASC
    `;
    const res = await this.pool.query(query, [id_sucursal]);
    return res.rows.map((row) => ({ ...row, cantidad: Number(row.cantidad) }));
  }

  /**
   * Inspección técnica de una pieza devuelta.
   *
   * Resultados posibles:
   *   - descarte          → cierra el retorno, la pieza se da de baja.
   *   - devolver_proveedor → cierra el retorno, se gestiona externamente.
   *   - aprobado_reventa  → crea lote_reacondicionado con precio basado en el
   *                         precio_unitario de la venta original (ERROR 6 CORREGIDO).
   */
  async inspeccionarRetorno(
    id_retorno: number,
    id_tecnico: number,
    resultado: string,
    observaciones: string,
    destino: string,
  ): Promise<number> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      const inspRes = await client.query(
        `INSERT INTO inspeccion_retorno
           (id_retorno, id_empleado_inspecciona, resultado, observaciones, destino)
         VALUES ($1, $2, $3, $4, $5) RETURNING id_inspeccion`,
        [id_retorno, id_tecnico, resultado, observaciones, destino],
      );
      const id_inspeccion = inspRes.rows[0].id_inspeccion;

      await client.query(
        `UPDATE retorno_garantia SET estado = 'cerrado' WHERE id_retorno = $1`,
        [id_retorno],
      );

      if (resultado === "aprobado_reventa") {
        const infoQuery = await client.query(
          `SELECT dv.id_producto, v.id_sucursal, g.cantidad,
                  dv.precio_unitario as precio_venta_original
           FROM retorno_garantia rg
           JOIN garantia g       ON rg.id_garantia     = g.id_garantia
           JOIN detalle_venta dv ON g.id_detalle_venta = dv.id_detalle
           JOIN venta v          ON dv.id_venta         = v.id_venta
           WHERE rg.id_retorno = $1`,
          [id_retorno],
        );
        const { id_producto, id_sucursal, cantidad, precio_venta_original } =
          infoQuery.rows[0];

        // ── ERROR 6 CORREGIDO ────────────────────────────────────────────────
        // El precio de reventa se calcula sobre el precio_unitario de la venta
        // original (precio histórico en detalle_venta), no sobre el precio
        // actual del producto en el catálogo. Esto evita que cambios de precio
        // futuros afecten el cálculo retroactivo del reacondicionado.
        // precio_venta_original se guarda también como referencia auditable.
        await client.query(
          `INSERT INTO lote_reacondicionado
             (id_inspeccion, id_sucursal, id_producto, cantidad,
              precio_venta_reac, precio_venta_original)
           VALUES ($1, $2, $3, $4,
             ROUND($5::numeric * 0.5, 2),
             $5)`,
          [
            id_inspeccion,
            id_sucursal,
            id_producto,
            cantidad,
            precio_venta_original,
          ],
        );
        // ─────────────────────────────────────────────────────────────────────
      }

      await client.query("COMMIT");
      return id_inspeccion;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Historial de garantías finalizadas o en proceso post-aprobación.
   *
   * ERROR 5 CORREGIDO: se usa la vista v_historial_garantias que incluye
   * garantías aprobadas desde que tienen retorno registrado, aunque la
   * inspección técnica todavía esté pendiente.
   */
  async obtenerHistorial(
    id_sucursal: number,
    search?: string,
    estado?: string,
    fechaInicio?: string,
    fechaFin?: string,
    page: number = 1,
    limit: number = 10,
  ): Promise<{ data: any[]; total: number }> {
    const offset = (page - 1) * limit;
    const values: any[] = [id_sucursal];
    let paramIndex = 1;

    // ERROR 5 CORREGIDO: se filtra desde la vista v_historial_garantias,
    // que ya incluye el WHERE corregido (ver migración SQL).
    let whereClause = `WHERE v_hist.id_sucursal = $1`;

    if (search) {
      paramIndex++;
      whereClause += ` AND (v_hist.producto ILIKE $${paramIndex}
        OR v_hist.sku ILIKE $${paramIndex}
        OR v_hist.id_garantia::text ILIKE $${paramIndex})`;
      values.push(`%${search}%`);
    }

    if (estado) {
      paramIndex++;
      whereClause += ` AND v_hist.estado_garantia = $${paramIndex}`;
      values.push(estado);
    }

    if (fechaInicio) {
      paramIndex++;
      whereClause += ` AND v_hist.fecha_solicitud >= $${paramIndex}`;
      values.push(fechaInicio);
    }

    if (fechaFin) {
      paramIndex++;
      whereClause += ` AND v_hist.fecha_solicitud <= $${paramIndex}`;
      values.push(fechaFin);
    }

    const countQuery = `
      SELECT COUNT(*)
      FROM v_historial_garantias v_hist
      ${whereClause};
    `;

    paramIndex++;
    const dataQuery = `
      SELECT
        v_hist.id_garantia,
        v_hist.fecha_solicitud,
        v_hist.estado_garantia,
        v_hist.motivo_reclamo,
        v_hist.sku,
        v_hist.producto,
        v_hist.condicion_recibido,
        v_hist.fecha_recepcion,
        v_hist.dictamen,
        v_hist.destino,
        v_hist.fecha_inspeccion,
        v_hist.id_lote,
        v_hist.estado_lote
      FROM v_historial_garantias v_hist
      ${whereClause}
      ORDER BY v_hist.fecha_solicitud DESC
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1};
    `;
    values.push(limit, offset);

    const [countRes, dataRes] = await Promise.all([
      this.pool.query(countQuery, values.slice(0, paramIndex - 1)),
      this.pool.query(dataQuery, values),
    ]);

    return {
      data: dataRes.rows,
      total: Number(countRes.rows[0].count),
    };
  }

  async obtenerReacondicionadosDisponibles(
    id_sucursal: number,
  ): Promise<any[]> {
    const query = `
      SELECT lr.id_lote, lr.cantidad, lr.precio_venta_reac, lr.precio_venta_original,
             lr.estado, lr.created_at,
             p.nombre as producto, p.sku, p.id_producto
      FROM lote_reacondicionado lr
      JOIN producto p ON lr.id_producto = p.id_producto
      WHERE lr.id_sucursal = $1
        AND lr.estado = 'disponible'
        AND lr.activo = true
      ORDER BY lr.created_at ASC
    `;
    const res = await this.pool.query(query, [id_sucursal]);
    return res.rows.map((row) => ({
      ...row,
      cantidad: Number(row.cantidad),
      precio_venta_reac: Number(row.precio_venta_reac),
      precio_venta_original: row.precio_venta_original
        ? Number(row.precio_venta_original)
        : null,
    }));
  }
}
