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
                p.garantia_dias, p.id_producto
         FROM detalle_venta dv
         JOIN venta v    ON dv.id_venta    = v.id_venta
         JOIN producto p ON dv.id_producto = p.id_producto
         WHERE dv.id_detalle = $1`,
        [data.id_detalle_venta],
      );

      if (detRes.rows.length === 0)
        throw new Error("Detalle de venta no encontrado");

      const { cantidad_comprada, fecha_compra, garantia_dias } = detRes.rows[0];

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
   *   1. Descuenta inventario_sucursal del repuesto de reemplazo.
   *   2. Registra movimiento_inventario (salida_garantia).
   *   3. Consume lotes FIFO con fn_consumir_lotes_fifo().
   *   4. Registra la recepción física de la pieza dañada en retorno_garantia.
   *
   * FLUJO RECHAZADO:
   *   Solo actualiza el estado. Sin movimiento de inventario.
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
        // 1. Verificar stock y descontar inventario_sucursal (sin cambios)
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
            "Stock insuficiente para entregar el repuesto de garantía.",
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

        // 2. Registrar movimiento de salida por garantía
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

        // ── FIFO: consumir lotes del repuesto entregado como reemplazo ────────
        await client.query(`SELECT fn_consumir_lotes_fifo($1, $2, $3, $4)`, [
          garantia.id_producto,
          garantia.id_sucursal,
          garantia.cantidad,
          id_movimiento,
        ]);
        // ──────────────────────────────────────────────────────────────────────

        // 3. Registrar la recepción física de la pieza dañada (sin cambios)
        await client.query(
          `INSERT INTO retorno_garantia
             (id_garantia, id_empleado_recibe, condicion_recibido, notas_inspeccion)
           VALUES ($1, $2, $3, $4)`,
          [
            data.id_garantia,
            data.id_supervisor,
            data.condicion_recibido,
            data.notas_inspeccion ?? "",
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

  // ── GETTERS — sin cambios ──────────────────────────────────────────────────

  async obtenerPendientes(id_sucursal: number): Promise<any[]> {
    const query = `
      SELECT g.id_garantia, g.cantidad, g.motivo_reclamo, g.fecha_solicitud, g.estado,
             p.nombre as producto, p.sku, p.garantia_dias,
             v.id_venta, v.created_at as fecha_compra,
             COALESCE(c.nombre_razon_social, 'Consumidor Final') as cliente
      FROM garantia g
      JOIN detalle_venta dv ON g.id_detalle_venta = dv.id_detalle
      JOIN venta v          ON dv.id_venta        = v.id_venta
      JOIN producto p       ON dv.id_producto     = p.id_producto
      LEFT JOIN cliente c   ON v.id_cliente       = c.id_cliente
      WHERE v.id_sucursal = $1 AND g.estado = 'en_revision'
      ORDER BY g.fecha_solicitud ASC
    `;
    const res = await this.pool.query(query, [id_sucursal]);
    return res.rows.map((row) => ({ ...row, cantidad: Number(row.cantidad) }));
  }

  async obtenerPendientesInspeccion(id_sucursal: number): Promise<any[]> {
    const query = `
      SELECT rg.id_retorno, rg.condicion_recibido, rg.notas_inspeccion,
             rg.created_at as fecha_ingreso,
             g.id_garantia, g.cantidad,
             p.nombre as producto, p.sku,
             e.nombre as recibio_nombre
      FROM retorno_garantia rg
      JOIN garantia g     ON rg.id_garantia       = g.id_garantia
      JOIN detalle_venta dv ON g.id_detalle_venta = dv.id_detalle
      JOIN venta v          ON dv.id_venta        = v.id_venta
      JOIN producto p       ON dv.id_producto     = p.id_producto
      JOIN empleado e       ON rg.id_empleado_recibe = e.id_empleado
      WHERE v.id_sucursal = $1 AND rg.estado = 'pendiente_inspeccion'
      ORDER BY rg.created_at ASC
    `;
    const res = await this.pool.query(query, [id_sucursal]);
    return res.rows.map((row) => ({ ...row, cantidad: Number(row.cantidad) }));
  }

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
          `SELECT dv.id_producto, v.id_sucursal, g.cantidad
           FROM retorno_garantia rg
           JOIN garantia g       ON rg.id_garantia       = g.id_garantia
           JOIN detalle_venta dv ON g.id_detalle_venta   = dv.id_detalle
           JOIN venta v          ON dv.id_venta          = v.id_venta
           WHERE rg.id_retorno = $1`,
          [id_retorno],
        );
        const { id_producto, id_sucursal, cantidad } = infoQuery.rows[0];

        // La pieza dañada aprobada para reventa entra como lote_reacondicionado.
        // No toca lote_inventario porque los reacondicionados tienen su propio
        // flujo de precios y no forman parte del stock FIFO normal.
        await client.query(
          `INSERT INTO lote_reacondicionado
             (id_inspeccion, id_sucursal, id_producto, cantidad, precio_venta_reac)
           VALUES ($1, $2, $3, $4,
             (SELECT precio_venta * 0.5 FROM producto WHERE id_producto = $3))`,
          [id_inspeccion, id_sucursal, id_producto, cantidad],
        );
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

    let whereClause = `WHERE v.id_sucursal = $1
      AND (g.estado = 'rechazada' OR ir.id_inspeccion IS NOT NULL)`;

    if (search) {
      paramIndex++;
      whereClause += ` AND (p.nombre ILIKE $${paramIndex} OR p.sku ILIKE $${paramIndex}
        OR g.id_garantia::text ILIKE $${paramIndex})`;
      values.push(`%${search}%`);
    }

    if (estado) {
      paramIndex++;
      whereClause += ` AND g.estado = $${paramIndex}`;
      values.push(estado);
    }

    if (fechaInicio) {
      paramIndex++;
      whereClause += ` AND g.fecha_solicitud >= $${paramIndex}`;
      values.push(fechaInicio);
    }

    if (fechaFin) {
      paramIndex++;
      whereClause += ` AND g.fecha_solicitud <= $${paramIndex}`;
      values.push(fechaFin);
    }

    const countQuery = `
      SELECT COUNT(*)
      FROM garantia g
      JOIN detalle_venta dv ON g.id_detalle_venta = dv.id_detalle
      JOIN producto p       ON dv.id_producto     = p.id_producto
      JOIN venta v          ON dv.id_venta        = v.id_venta
      LEFT JOIN retorno_garantia rg    ON g.id_garantia  = rg.id_garantia
      LEFT JOIN inspeccion_retorno ir  ON rg.id_retorno  = ir.id_retorno
      ${whereClause};
    `;

    const dataQuery = `
      SELECT
        g.id_garantia, g.fecha_solicitud, g.estado as estado_garantia, g.motivo_reclamo,
        p.sku, p.nombre as producto,
        rg.condicion_recibido, rg.created_at as fecha_recepcion,
        ir.resultado as dictamen, ir.destino, ir.fecha_inspeccion,
        lr.id_lote, lr.estado as estado_lote
      FROM garantia g
      JOIN detalle_venta dv ON g.id_detalle_venta = dv.id_detalle
      JOIN producto p       ON dv.id_producto     = p.id_producto
      JOIN venta v          ON dv.id_venta        = v.id_venta
      LEFT JOIN retorno_garantia rg    ON g.id_garantia  = rg.id_garantia
      LEFT JOIN inspeccion_retorno ir  ON rg.id_retorno  = ir.id_retorno
      LEFT JOIN lote_reacondicionado lr ON ir.id_inspeccion = lr.id_inspeccion
      ${whereClause}
      ORDER BY g.fecha_solicitud DESC, g.id_garantia DESC
      LIMIT $${paramIndex + 1} OFFSET $${paramIndex + 2};
    `;

    const countRes = await this.pool.query(countQuery, values);
    const total = parseInt(countRes.rows[0].count, 10);

    const res = await this.pool.query(dataQuery, [...values, limit, offset]);
    return { data: res.rows, total };
  }

  async obtenerReacondicionadosDisponibles(
    id_sucursal: number,
  ): Promise<any[]> {
    const query = `
      SELECT lr.id_lote as id_producto_reacondicionado, lr.cantidad, lr.precio_venta_reac,
             p.id_producto, p.nombre, p.sku
      FROM lote_reacondicionado lr
      JOIN producto p ON lr.id_producto = p.id_producto
      WHERE lr.id_sucursal = $1 AND lr.estado = 'disponible' AND lr.cantidad > 0
    `;
    const res = await this.pool.query(query, [id_sucursal]);
    return res.rows.map((row) => ({
      ...row,
      precio_venta_reac: Number(row.precio_venta_reac),
    }));
  }
}
