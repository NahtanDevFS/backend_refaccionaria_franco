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
        `SELECT dv.cantidad as cantidad_comprada, v.created_at as fecha_compra, p.garantia_dias, p.id_producto
         FROM detalle_venta dv
         JOIN venta v ON dv.id_venta = v.id_venta
         JOIN producto p ON dv.id_producto = p.id_producto
         WHERE dv.id_detalle = $1`,
        [data.id_detalle_venta],
      );

      if (detRes.rows.length === 0)
        throw new Error("Detalle de venta no encontrado");
      const { cantidad_comprada, fecha_compra, garantia_dias } = detRes.rows[0];

      if (data.cantidad > Number(cantidad_comprada)) {
        throw new Error("La cantidad reclamada supera la cantidad comprada.");
      }

      const reclamosPrevios = await client.query(
        `SELECT COALESCE(SUM(cantidad), 0) as total_reclamado FROM garantia
         WHERE id_detalle_venta = $1 AND estado IN ('en_revision', 'aprobada')`,
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
      if (new Date() > fechaLimite) {
        throw new Error(
          `El plazo de garantía de ${garantia_dias} días ha expirado.`,
        );
      }

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

  async resolverGarantia(data: ResolverGarantiaDTO): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      const garRes = await client.query(
        `SELECT g.estado, g.cantidad, dv.id_producto, v.id_sucursal
         FROM garantia g
         JOIN detalle_venta dv ON g.id_detalle_venta = dv.id_detalle
         JOIN venta v ON dv.id_venta = v.id_venta
         WHERE g.id_garantia = $1 FOR UPDATE`,
        [data.id_garantia],
      );

      if (garRes.rows.length === 0) throw new Error("Garantía no encontrada");
      const garantia = garRes.rows[0];
      if (garantia.estado !== "en_revision")
        throw new Error("La garantía ya fue resuelta.");

      const nuevoEstado = data.aprobado ? "aprobada" : "rechazada";

      await client.query(
        `UPDATE garantia SET estado = $1, resolucion = $2, id_supervisor_aprueba = $3 WHERE id_garantia = $4`,
        [nuevoEstado, data.resolucion, data.id_supervisor, data.id_garantia],
      );

      if (data.aprobado) {
        const invRes = await client.query(
          `UPDATE inventario_sucursal SET cantidad_actual = cantidad_actual - $1
           WHERE id_producto = $2 AND id_sucursal = $3 RETURNING id_inventario, cantidad_actual`,
          [garantia.cantidad, garantia.id_producto, garantia.id_sucursal],
        );

        if (invRes.rows.length === 0)
          throw new Error(
            "Producto sin registro de inventario en la sucursal.",
          );

        await client.query(
          `INSERT INTO movimiento_inventario (id_inventario, id_usuario, tipo, cantidad, cantidad_resultante, id_referencia, tabla_referencia, motivo)
           VALUES ($1, $2, 'salida_garantia', $3, $4, $5, 'garantia', 'Reemplazo físico por garantía aprobada')`,
          [
            invRes.rows[0].id_inventario,
            data.id_supervisor,
            garantia.cantidad,
            invRes.rows[0].cantidad_actual,
            data.id_garantia,
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

  // --- GETTERS PARA LAS PESTAÑAS DEL FRONTEND ---

  // Pestaña 1: Pendientes de Autorizar
  async obtenerPendientes(id_sucursal: number): Promise<any[]> {
    const query = `
      SELECT g.id_garantia, g.cantidad, g.motivo_reclamo, g.fecha_solicitud, g.estado,
             p.nombre as producto, p.sku, p.garantia_dias,
             v.id_venta, v.created_at as fecha_compra,
             COALESCE(c.nombre_razon_social, 'Consumidor Final') as cliente
      FROM garantia g
      JOIN detalle_venta dv ON g.id_detalle_venta = dv.id_detalle
      JOIN venta v ON dv.id_venta = v.id_venta
      JOIN producto p ON dv.id_producto = p.id_producto
      LEFT JOIN cliente c ON v.id_cliente = c.id_cliente
      WHERE v.id_sucursal = $1 AND g.estado = 'en_revision'
      ORDER BY g.fecha_solicitud ASC
    `;
    const res = await this.pool.query(query, [id_sucursal]);
    return res.rows.map((row) => ({ ...row, cantidad: Number(row.cantidad) }));
  }

  // Pestaña 2: Pendientes de Recepción Física
  async obtenerPendientesRecepcion(id_sucursal: number): Promise<any[]> {
    const query = `
      SELECT g.id_garantia, g.cantidad, g.motivo_reclamo, g.estado, g.fecha_solicitud,
             p.nombre as producto, p.sku,
             COALESCE(c.nombre_razon_social, 'Consumidor Final') as cliente
      FROM garantia g
      JOIN detalle_venta dv ON g.id_detalle_venta = dv.id_detalle
      JOIN venta v ON dv.id_venta = v.id_venta
      JOIN producto p ON dv.id_producto = p.id_producto
      LEFT JOIN cliente c ON v.id_cliente = c.id_cliente
      WHERE v.id_sucursal = $1 AND g.estado = 'aprobada'
      AND NOT EXISTS (SELECT 1 FROM retorno_garantia rg WHERE rg.id_garantia = g.id_garantia)
      ORDER BY g.fecha_solicitud ASC
    `;
    const res = await this.pool.query(query, [id_sucursal]);
    return res.rows.map((row) => ({ ...row, cantidad: Number(row.cantidad) }));
  }

  // Pestaña 3: Pendientes de Inspección Técnica
  async obtenerPendientesInspeccion(id_sucursal: number): Promise<any[]> {
    const query = `
      SELECT rg.id_retorno, rg.condicion_recibido, rg.notas_inspeccion, rg.created_at as fecha_ingreso,
             g.id_garantia, g.cantidad,
             p.nombre as producto, p.sku,
             e.nombre as recibio_nombre
      FROM retorno_garantia rg
      JOIN garantia g ON rg.id_garantia = g.id_garantia
      JOIN detalle_venta dv ON g.id_detalle_venta = dv.id_detalle
      JOIN venta v ON dv.id_venta = v.id_venta
      JOIN producto p ON dv.id_producto = p.id_producto
      JOIN empleado e ON rg.id_empleado_recibe = e.id_empleado
      WHERE v.id_sucursal = $1 AND rg.estado = 'pendiente_inspeccion'
      ORDER BY rg.created_at ASC
    `;
    const res = await this.pool.query(query, [id_sucursal]);
    return res.rows.map((row) => ({ ...row, cantidad: Number(row.cantidad) }));
  }

  // --- MÉTODOS TRANSACCIONALES DE LOGÍSTICA INVERSA ---

  async recibirProductoDañado(
    id_garantia: number,
    id_empleado: number,
    condicion: string,
    notas: string,
  ): Promise<number> {
    const query = `
       INSERT INTO retorno_garantia (id_garantia, id_empleado_recibe, condicion_recibido, notas_inspeccion)
       VALUES ($1, $2, $3, $4) RETURNING id_retorno;
    `;
    const res = await this.pool.query(query, [
      id_garantia,
      id_empleado,
      condicion,
      notas,
    ]);
    return res.rows[0].id_retorno;
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
        `INSERT INTO inspeccion_retorno (id_retorno, id_empleado_inspecciona, resultado, observaciones, destino)
         VALUES ($1, $2, $3, $4, $5) RETURNING id_inspeccion;`,
        [id_retorno, id_tecnico, resultado, observaciones, destino],
      );
      const id_inspeccion = inspRes.rows[0].id_inspeccion;

      await client.query(
        "UPDATE retorno_garantia SET estado = 'cerrado' WHERE id_retorno = $1",
        [id_retorno],
      );

      if (resultado === "aprobado_reventa") {
        const infoQuery = await client.query(
          `SELECT dv.id_producto, v.id_sucursal, g.cantidad 
           FROM retorno_garantia rg
           JOIN garantia g ON rg.id_garantia = g.id_garantia
           JOIN detalle_venta dv ON g.id_detalle_venta = dv.id_detalle
           JOIN venta v ON dv.id_venta = v.id_venta
           WHERE rg.id_retorno = $1`,
          [id_retorno],
        );
        const { id_producto, id_sucursal, cantidad } = infoQuery.rows[0];

        await client.query(
          `INSERT INTO lote_reacondicionado (id_inspeccion, id_sucursal, id_producto, cantidad, precio_venta_reac)
           VALUES ($1, $2, $3, $4, (SELECT precio_venta * 0.5 FROM producto WHERE id_producto = $3))`,
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

  // Pestaña 4: Historial Completo
  async obtenerHistorial(id_sucursal: number): Promise<any[]> {
    const query = `
      SELECT 
          g.id_garantia, g.fecha_solicitud, g.estado as estado_garantia, g.motivo_reclamo,
          p.sku, p.nombre as producto,
          rg.condicion_recibido, rg.created_at as fecha_recepcion,
          ir.resultado as dictamen, ir.destino, ir.fecha_inspeccion,
          lr.id_lote, lr.estado as estado_lote
      FROM garantia g
      JOIN detalle_venta dv ON g.id_detalle_venta = dv.id_detalle
      JOIN producto p ON dv.id_producto = p.id_producto
      JOIN venta v ON dv.id_venta = v.id_venta
      LEFT JOIN retorno_garantia rg ON g.id_garantia = rg.id_garantia
      LEFT JOIN inspeccion_retorno ir ON rg.id_retorno = ir.id_retorno
      LEFT JOIN lote_reacondicionado lr ON ir.id_inspeccion = lr.id_inspeccion
      WHERE v.id_sucursal = $1 
        AND (g.estado = 'rechazada' OR ir.id_inspeccion IS NOT NULL)
      ORDER BY g.fecha_solicitud DESC
      LIMIT 100;
    `;
    const res = await this.pool.query(query, [id_sucursal]);
    return res.rows;
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
