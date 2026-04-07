// repositories/GarantiaRepository.ts
import { Pool } from "pg";
import { IGarantiaRepository } from "./IGarantiaRepository";
import { CrearGarantiaDTO, ResolverGarantiaDTO } from "../dtos/GarantiaDTO";

export class GarantiaRepository implements IGarantiaRepository {
  private pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  async crearGarantia(data: CrearGarantiaDTO): Promise<number> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      // 1. Obtener información de la venta y producto
      const detRes = await client.query(
        `
        SELECT dv.cantidad as cantidad_comprada, v.created_at as fecha_compra, p.garantia_dias, p.id_producto
        FROM detalle_venta dv
        JOIN venta v ON dv.id_venta = v.id_venta
        JOIN producto p ON dv.id_producto = p.id_producto
        WHERE dv.id_detalle = $1
      `,
        [data.id_detalle_venta],
      );

      if (detRes.rows.length === 0)
        throw new Error("Detalle de venta no encontrado");
      const { cantidad_comprada, fecha_compra, garantia_dias } = detRes.rows[0];

      // 2. Validar cantidad (No reclamar más de lo comprado)
      if (data.cantidad > Number(cantidad_comprada)) {
        throw new Error("La cantidad reclamada supera la cantidad comprada.");
      }

      // Validar si ya hay reclamos previos de este detalle
      const reclamosPrevios = await client.query(
        `
        SELECT COALESCE(SUM(cantidad), 0) as total_reclamado
        FROM garantia
        WHERE id_detalle_venta = $1 AND estado IN ('en_revision', 'aprobada')
      `,
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

      // 3. Validar plazo de garantía
      const fechaLimite = new Date(fecha_compra);
      fechaLimite.setDate(fechaLimite.getDate() + garantia_dias);
      if (new Date() > fechaLimite) {
        throw new Error(
          `El plazo de garantía de ${garantia_dias} días ha expirado (Venció el ${fechaLimite.toLocaleDateString()}).`,
        );
      }

      // 4. Insertar la solicitud
      const insertRes = await client.query(
        `
        INSERT INTO garantia (id_detalle_venta, cantidad, motivo_reclamo, estado)
        VALUES ($1, $2, $3, 'en_revision') RETURNING id_garantia
      `,
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
        `
        SELECT g.estado, g.cantidad, dv.id_producto, v.id_sucursal
        FROM garantia g
        JOIN detalle_venta dv ON g.id_detalle_venta = dv.id_detalle
        JOIN venta v ON dv.id_venta = v.id_venta
        WHERE g.id_garantia = $1 FOR UPDATE
      `,
        [data.id_garantia],
      );

      if (garRes.rows.length === 0) throw new Error("Garantía no encontrada");
      const garantia = garRes.rows[0];

      if (garantia.estado !== "en_revision")
        throw new Error("La garantía ya fue resuelta.");

      const nuevoEstado = data.aprobado ? "aprobada" : "rechazada";

      // Actualizar estado de la garantía
      await client.query(
        `
        UPDATE garantia 
        SET estado = $1, resolucion = $2, id_supervisor_aprueba = $3
        WHERE id_garantia = $4
      `,
        [nuevoEstado, data.resolucion, data.id_supervisor, data.id_garantia],
      );

      // RF-06.4: Si es aprobada, sacar de inventario
      if (data.aprobado) {
        const invRes = await client.query(
          `
          UPDATE inventario_sucursal
          SET cantidad_actual = cantidad_actual - $1
          WHERE id_producto = $2 AND id_sucursal = $3
          RETURNING id_inventario, cantidad_actual
        `,
          [garantia.cantidad, garantia.id_producto, garantia.id_sucursal],
        );

        if (invRes.rows.length === 0)
          throw new Error(
            "Producto sin registro de inventario en la sucursal.",
          );

        const { id_inventario, cantidad_actual } = invRes.rows[0];

        // Registrar movimiento de salida auditable
        await client.query(
          `
          INSERT INTO movimiento_inventario 
          (id_inventario, id_usuario, tipo, cantidad, cantidad_resultante, id_referencia, tabla_referencia, motivo)
          VALUES ($1, $2, 'salida_garantia', $3, $4, $5, 'garantia', 'Reemplazo físico por garantía aprobada')
        `,
          [
            id_inventario,
            data.id_supervisor,
            garantia.cantidad,
            cantidad_actual,
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

  async obtenerGarantiasEnRevision(id_sucursal: number): Promise<any[]> {
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
    // Mapeo explícito a Number para campos numéricos según tu estándar
    return res.rows.map((row) => ({
      ...row,
      cantidad: Number(row.cantidad),
    }));
  }
}
