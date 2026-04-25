// services/GarantiaService.ts
import { Pool } from "pg";
import {
  CrearGarantiaDTO,
  ResolverGarantiaDTO,
  InspeccionarRetornoDTO,
} from "../dtos/GarantiaDTO";

export class GarantiaService {
  constructor(private readonly pool: Pool) {}

  // Crear solicitud de garantía
  async crearGarantia(data: CrearGarantiaDTO): Promise<number> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      const prodRes = await client.query(
        `SELECT dv.cantidad, p.garantia_dias, v.created_at AS fecha_compra
         FROM detalle_venta dv
         JOIN producto p ON dv.id_producto = p.id_producto
         JOIN venta    v ON dv.id_venta    = v.id_venta
         WHERE dv.id_detalle = $1`,
        [data.id_detalle_venta],
      );

      if (!prodRes.rows.length)
        throw new Error("Detalle de venta no encontrado");

      const {
        cantidad: cantidad_comprada,
        garantia_dias,
        fecha_compra,
      } = prodRes.rows[0];

      if (garantia_dias <= 0)
        throw new Error("Este producto no tiene garantía.");

      const reclamosPrevios = await client.query(
        `SELECT COALESCE(SUM(g.cantidad), 0) AS total_reclamado
         FROM garantia g
         JOIN estado_garantia eg ON g.id_estado_garantia = eg.id_estado_garantia
         WHERE g.id_detalle_venta = $1
           AND eg.nombre IN ('en_revision','aprobada','rechazada')`,
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
        `INSERT INTO garantia (id_detalle_venta, cantidad, motivo_reclamo, id_estado_garantia)
         VALUES (
           $1, $2, $3,
           (SELECT id_estado_garantia FROM estado_garantia WHERE nombre = 'en_revision')
         )
         RETURNING id_garantia`,
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

  // Aprobar o rechazar una garantía
  async resolverGarantia(data: ResolverGarantiaDTO): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      const garRes = await client.query(
        `SELECT eg.nombre AS estado, g.cantidad, dv.id_producto, v.id_sucursal
         FROM garantia g
         JOIN estado_garantia eg ON g.id_estado_garantia = eg.id_estado_garantia
         JOIN detalle_venta   dv ON g.id_detalle_venta   = dv.id_detalle
         JOIN venta            v ON dv.id_venta           = v.id_venta
         WHERE g.id_garantia = $1 FOR UPDATE`,
        [data.id_garantia],
      );

      if (!garRes.rows.length) throw new Error("Garantía no encontrada");
      const garantia = garRes.rows[0];
      if (garantia.estado !== "en_revision")
        throw new Error("La garantía ya fue resuelta.");

      const nuevoEstado = data.aprobado ? "aprobada" : "rechazada";

      await client.query(
        `UPDATE garantia
         SET id_estado_garantia = (
               SELECT id_estado_garantia FROM estado_garantia WHERE nombre = $1
             ),
             resolucion         = $2,
             id_supervisor_aprueba = $3
         WHERE id_garantia = $4`,
        [nuevoEstado, data.resolucion, data.id_supervisor, data.id_garantia],
      );

      if (data.aprobado) {
        const rpsRes = await client.query(
          `SELECT rps.id_reorden
           FROM reorden_producto_sucursal rps
           WHERE rps.id_producto = $1
             AND rps.id_sucursal = $2
             AND rps.activo      = TRUE
           FOR UPDATE OF rps`,
          [garantia.id_producto, garantia.id_sucursal],
        );

        if (!rpsRes.rows.length) {
          throw new Error(
            "Sin stock disponible para este repuesto en la sucursal. " +
              "La garantía permanecerá pendiente hasta que ingrese mercadería.",
          );
        }

        const id_reorden = rpsRes.rows[0].id_reorden;

        const stockRes = await client.query(
          `SELECT COALESCE(SUM(cantidad_actual), 0) AS cantidad_actual
           FROM lote_detalle
           WHERE id_producto = $1
             AND id_sucursal = $2
             AND agotado     = FALSE
             AND activo      = TRUE`,
          [garantia.id_producto, garantia.id_sucursal],
        );

        if (Number(stockRes.rows[0].cantidad_actual) < garantia.cantidad) {
          throw new Error(
            "Sin stock disponible para este repuesto en la sucursal. " +
              "La garantía permanecerá pendiente hasta que ingrese mercadería.",
          );
        }

        const nueva_cantidad =
          Number(stockRes.rows[0].cantidad_actual) - Number(garantia.cantidad);

        const movRes = await client.query(
          `INSERT INTO movimiento_inventario
             (id_reorden, id_usuario, id_tipo_movimiento, cantidad,
              cantidad_resultante, id_referencia, tabla_referencia, motivo)
           VALUES (
             $1, $2,
             (SELECT id_tipo_movimiento FROM tipo_movimiento_inventario
              WHERE nombre = 'salida_garantia'),
             $3, $4, $5, 'garantia',
             'Reemplazo físico por garantía aprobada'
           )
           RETURNING id_movimiento`,
          [
            id_reorden,
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

  //  Solicitudes pendientes de revisión
  async obtenerPendientes(id_sucursal: number): Promise<any[]> {
    const res = await this.pool.query(
      `SELECT
         g.id_garantia, g.cantidad, g.motivo_reclamo, g.fecha_solicitud,
         eg.nombre AS estado,
         p.nombre  AS producto, p.sku, p.garantia_dias,
         v.id_venta, v.created_at AS fecha_compra,
         COALESCE(c.nombre_razon_social, 'Consumidor Final') AS cliente,
         COALESCE((
           SELECT SUM(ld.cantidad_actual)
           FROM lote_detalle ld
           WHERE ld.id_producto = dv.id_producto
             AND ld.id_sucursal = v.id_sucursal
             AND ld.agotado     = FALSE
             AND ld.activo      = TRUE
         ), 0) AS stock_disponible
       FROM garantia g
       JOIN estado_garantia eg ON g.id_estado_garantia = eg.id_estado_garantia
       JOIN detalle_venta   dv ON g.id_detalle_venta   = dv.id_detalle
       JOIN venta            v ON dv.id_venta           = v.id_venta
       JOIN producto         p ON dv.id_producto        = p.id_producto
       LEFT JOIN cliente     c ON v.id_cliente          = c.id_cliente
       WHERE v.id_sucursal = $1
         AND eg.nombre     = 'en_revision'
       ORDER BY g.fecha_solicitud ASC`,
      [id_sucursal],
    );
    return res.rows.map((row) => ({
      ...row,
      cantidad: Number(row.cantidad),
      stock_disponible: Number(row.stock_disponible),
    }));
  }

  // Garantías aprobadas pendientes de inspección técnica
  async obtenerPendientesInspeccion(id_sucursal: number): Promise<any[]> {
    const res = await this.pool.query(
      `SELECT
         g.id_garantia, g.cantidad, g.fecha_solicitud,
         p.nombre AS producto, p.sku
       FROM garantia g
       JOIN estado_garantia eg ON g.id_estado_garantia = eg.id_estado_garantia
       JOIN detalle_venta   dv ON g.id_detalle_venta   = dv.id_detalle
       JOIN venta            v ON dv.id_venta           = v.id_venta
       JOIN producto         p ON dv.id_producto        = p.id_producto
       WHERE v.id_sucursal            = $1
         AND eg.nombre                = 'aprobada'
         AND g.fecha_inspeccion      IS NULL
         AND g.id_resultado_inspeccion IS NULL
       ORDER BY g.fecha_solicitud ASC`,
      [id_sucursal],
    );
    return res.rows.map((row) => ({ ...row, cantidad: Number(row.cantidad) }));
  }

  // Registrar inspección técnica
  async inspeccionarRetorno(data: InspeccionarRetornoDTO): Promise<number> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      // Verificar que la garantía existe, está aprobada y no fue inspeccionada
      const garRes = await client.query(
        `SELECT g.id_garantia, g.fecha_inspeccion
         FROM garantia g
         JOIN estado_garantia eg ON g.id_estado_garantia = eg.id_estado_garantia
         WHERE g.id_garantia = $1 AND eg.nombre = 'aprobada'`,
        [data.id_garantia],
      );
      if (!garRes.rows.length)
        throw new Error("Garantía no encontrada o no está aprobada.");

      if (garRes.rows[0].fecha_inspeccion !== null)
        throw new Error("Esta garantía ya fue inspeccionada.");

      // Registrar la inspección directamente en garantia
      await client.query(
        `UPDATE garantia
         SET id_empleado_inspecciona   = $1,
             id_resultado_inspeccion   = (
               SELECT id_resultado_inspeccion FROM resultado_inspeccion
               WHERE nombre = $2
             ),
             observaciones             = $3,
             fecha_inspeccion          = NOW(),
             updated_at                = NOW()
         WHERE id_garantia = $4`,
        [
          data.id_tecnico,
          data.resultado,
          data.observaciones ?? "",
          data.id_garantia,
        ],
      );

      // Si el resultado es reventa, crear lote reacondicionado
      if (data.resultado === "aprobado_reventa") {
        const infoRes = await client.query(
          `SELECT dv.id_producto, v.id_sucursal, g.cantidad,
                  dv.precio_unitario AS precio_venta_original
           FROM garantia g
           JOIN detalle_venta dv ON g.id_detalle_venta = dv.id_detalle
           JOIN venta          v ON dv.id_venta        = v.id_venta
           WHERE g.id_garantia = $1`,
          [data.id_garantia],
        );
        const { id_producto, id_sucursal, cantidad, precio_venta_original } =
          infoRes.rows[0];

        await client.query(
          `INSERT INTO lote_reacondicionado
             (id_garantia, id_sucursal, id_producto, cantidad,
              precio_venta_reac, precio_venta_original)
           VALUES ($1,$2,$3,$4, ROUND($5::numeric * 0.5, 2), $5)`,
          [
            data.id_garantia,
            id_sucursal,
            id_producto,
            cantidad,
            precio_venta_original,
          ],
        );
      }

      await client.query("COMMIT");

      // Retorna id_garantia como id_inspeccion
      return data.id_garantia;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  //Historial de garantías (usa la vista v_historial_garantias)
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

    const countQuery = `SELECT COUNT(*) FROM v_historial_garantias v_hist ${whereClause}`;

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
        v_hist.fecha_inspeccion,
        v_hist.id_lote
      FROM v_historial_garantias v_hist
      ${whereClause}
      ORDER BY v_hist.fecha_solicitud DESC
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `;
    values.push(limit, offset);

    const [countRes, dataRes] = await Promise.all([
      this.pool.query(countQuery, values.slice(0, paramIndex - 1)),
      this.pool.query(dataQuery, values),
    ]);

    return {
      data: dataRes.rows.map((row) => ({
        ...row,
        destino: row.dictamen ?? null,
        condicion_recibido: null,
        fecha_recepcion: null,
      })),
      total: Number(countRes.rows[0].count),
    };
  }

  // Lotes reacondicionados disponibles
  async obtenerReacondicionadosDisponibles(
    id_sucursal: number,
  ): Promise<any[]> {
    const res = await this.pool.query(
      `SELECT
         lr.id_lote, lr.cantidad, lr.precio_venta_reac,
         lr.precio_venta_original, lr.created_at,
         p.nombre AS producto, p.sku, p.id_producto
       FROM lote_reacondicionado lr
       JOIN producto p ON lr.id_producto = p.id_producto
       WHERE lr.id_sucursal = $1
         AND lr.cantidad     > 0
         AND lr.activo       = true
       ORDER BY lr.created_at ASC`,
      [id_sucursal],
    );
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
