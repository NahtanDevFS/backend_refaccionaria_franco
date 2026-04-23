// services/GarantiaService.ts
import { Pool } from "pg";
import {
  CrearGarantiaDTO,
  ResolverGarantiaDTO,
  InspeccionarRetornoDTO,
} from "../dtos/GarantiaDTO";

export class GarantiaService {
  constructor(private readonly pool: Pool) {}

  // ── Crear solicitud de garantía ───────────────────────────────────────────
  async crearGarantia(data: CrearGarantiaDTO): Promise<number> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      const prodRes = await client.query(
        `SELECT dv.cantidad, p.garantia_dias, v.created_at as fecha_compra
         FROM detalle_venta dv
         JOIN producto p ON dv.id_producto = p.id_producto
         JOIN venta v    ON dv.id_venta    = v.id_venta
         WHERE dv.id_detalle = $1`,
        [data.id_detalle_venta],
      );

      if (prodRes.rows.length === 0)
        throw new Error("Detalle de venta no encontrado");

      const {
        cantidad: cantidad_comprada,
        garantia_dias,
        fecha_compra,
      } = prodRes.rows[0];

      if (garantia_dias <= 0)
        throw new Error("Este producto no tiene garantía.");

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

  // ── Resolver garantía (aprobar o rechazar) ────────────────────────────────
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

        await client.query(`SELECT fn_consumir_lotes_fifo($1, $2, $3, $4)`, [
          garantia.id_producto,
          garantia.id_sucursal,
          garantia.cantidad,
          movRes.rows[0].id_movimiento,
        ]);
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

  // Garantías aprobadas que aún no tienen inspección registrada
  async obtenerPendientesInspeccion(id_sucursal: number): Promise<any[]> {
    const query = `
      SELECT g.id_garantia, g.cantidad, g.fecha_solicitud,
             p.nombre as producto, p.sku
      FROM garantia g
      JOIN detalle_venta dv ON g.id_detalle_venta = dv.id_detalle
      JOIN venta v          ON dv.id_venta         = v.id_venta
      JOIN producto p       ON dv.id_producto      = p.id_producto
      WHERE v.id_sucursal = $1
        AND g.estado = 'aprobada'
        AND NOT EXISTS (
          SELECT 1 FROM inspeccion_retorno ir
          WHERE ir.id_garantia = g.id_garantia
        )
      ORDER BY g.fecha_solicitud ASC
    `;
    const res = await this.pool.query(query, [id_sucursal]);
    return res.rows.map((row) => ({ ...row, cantidad: Number(row.cantidad) }));
  }

  // ── Inspección técnica ────────────────────────────────────────────────────
  async inspeccionarRetorno(data: InspeccionarRetornoDTO): Promise<number> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      // Verificar que la garantía existe, está aprobada y no tiene inspección previa
      const garRes = await client.query(
        `SELECT g.id_garantia FROM garantia g
         WHERE g.id_garantia = $1 AND g.estado = 'aprobada'`,
        [data.id_garantia],
      );
      if (garRes.rows.length === 0)
        throw new Error("Garantía no encontrada o no está aprobada.");

      const yaInspeccionada = await client.query(
        `SELECT 1 FROM inspeccion_retorno WHERE id_garantia = $1`,
        [data.id_garantia],
      );
      if (yaInspeccionada.rows.length > 0)
        throw new Error("Esta garantía ya fue inspeccionada.");

      const inspRes = await client.query(
        `INSERT INTO inspeccion_retorno
           (id_garantia, id_empleado_inspecciona, resultado, observaciones, destino)
         VALUES ($1, $2, $3, $4, $5) RETURNING id_inspeccion`,
        [
          data.id_garantia,
          data.id_tecnico,
          data.resultado,
          data.observaciones ?? "",
          data.destino,
        ],
      );
      const id_inspeccion = inspRes.rows[0].id_inspeccion;

      if (data.resultado === "aprobado_reventa") {
        const infoQuery = await client.query(
          `SELECT dv.id_producto, v.id_sucursal, g.cantidad,
                  dv.precio_unitario as precio_venta_original
           FROM garantia g
           JOIN detalle_venta dv ON g.id_detalle_venta = dv.id_detalle
           JOIN venta v          ON dv.id_venta         = v.id_venta
           WHERE g.id_garantia = $1`,
          [data.id_garantia],
        );
        const { id_producto, id_sucursal, cantidad, precio_venta_original } =
          infoQuery.rows[0];

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

  // ── Historial ─────────────────────────────────────────────────────────────
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
        v_hist.dictamen,
        v_hist.destino,
        v_hist.fecha_inspeccion,
        v_hist.id_lote
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
             lr.created_at,
             p.nombre as producto, p.sku, p.id_producto
      FROM lote_reacondicionado lr
      JOIN producto p ON lr.id_producto = p.id_producto
      WHERE lr.id_sucursal = $1
        AND lr.cantidad > 0
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
