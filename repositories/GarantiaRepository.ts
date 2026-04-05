// repositories/GarantiaRepository.ts
import { Pool } from "pg";
import { SolicitarGarantiaDTO, ResolverGarantiaDTO } from "../dtos/GarantiaDTO";

export class GarantiaRepository {
  constructor(private readonly pool: Pool) {}

  // Consulta crucial para validar las reglas de negocio
  async obtenerInfoGarantia(id_detalle_venta: number): Promise<any> {
    const query = `
      SELECT 
        dv.id_detalle, 
        v.created_at AS fecha_venta, 
        p.garantia_dias
      FROM detalle_venta dv
      INNER JOIN venta v ON dv.id_venta = v.id_venta
      INNER JOIN producto p ON dv.id_producto = p.id_producto
      WHERE dv.id_detalle = $1;
    `;
    const result = await this.pool.query(query, [id_detalle_venta]);
    return result.rows[0] || null;
  }

  async crearSolicitud(data: SolicitarGarantiaDTO): Promise<any> {
    const query = `
      INSERT INTO garantia (id_detalle_venta, motivo_reclamo, estado, fecha_solicitud)
      VALUES ($1, $2, 'en_revision', CURRENT_DATE)
      RETURNING *;
    `;
    const result = await this.pool.query(query, [
      data.id_detalle_venta,
      data.motivo_reclamo,
    ]);
    return result.rows[0];
  }

  async resolverGarantiaConInventario(
    id_garantia: number,
    data: ResolverGarantiaDTO,
    id_supervisor_aprueba: number,
    id_usuario_sistema: number,
  ): Promise<any> {
    const client = await this.pool.connect();

    try {
      await client.query("BEGIN"); // Iniciamos transacción

      // 1. Actualizar el estado de la garantía
      const updateGarantiaQuery = `
        UPDATE garantia
        SET id_supervisor_aprueba = $1, estado = $2, resolucion = $3
        WHERE id_garantia = $4
        RETURNING *;
      `;
      const resultGarantia = await client.query(updateGarantiaQuery, [
        id_supervisor_aprueba,
        data.estado,
        data.resolucion,
        id_garantia,
      ]);
      const garantiaActualizada = resultGarantia.rows[0];

      // 2. Si se aprueba, hacer el descargo de inventario
      if (data.estado === "aprobada") {
        // A. Obtener de qué sucursal y qué producto estamos hablando
        const queryInfo = `
          SELECT dv.id_producto, v.id_sucursal
          FROM garantia g
          INNER JOIN detalle_venta dv ON g.id_detalle_venta = dv.id_detalle
          INNER JOIN venta v ON dv.id_venta = v.id_venta
          WHERE g.id_garantia = $1;
        `;
        const resultInfo = await client.query(queryInfo, [id_garantia]);
        const info = resultInfo.rows[0];

        // B. Restar 1 al inventario de la sucursal
        const updateInvQuery = `
          UPDATE inventario_sucursal
          SET cantidad_actual = cantidad_actual - 1
          WHERE id_producto = $1 AND id_sucursal = $2
          RETURNING id_inventario, cantidad_actual;
        `;
        const resultInv = await client.query(updateInvQuery, [
          info.id_producto,
          info.id_sucursal,
        ]);
        const inv = resultInv.rows[0];

        if (!inv || inv.cantidad_actual < 0) {
          throw new Error(
            "Stock insuficiente en la sucursal para realizar el cambio físico por garantía.",
          );
        }

        // C. Registrar en la bitácora de movimientos para auditoría
        const insertMovQuery = `
          INSERT INTO movimiento_inventario 
          (id_inventario, id_usuario, tipo, cantidad, cantidad_resultante, id_referencia, tabla_referencia, motivo)
          VALUES ($1, $2, 'salida_garantia', 1, $3, $4, 'garantia', $5);
        `;
        await client.query(insertMovQuery, [
          inv.id_inventario,
          id_usuario_sistema,
          inv.cantidad_actual,
          id_garantia,
          data.resolucion, // Usamos la resolución del supervisor como motivo
        ]);
      }

      await client.query("COMMIT");
      return garantiaActualizada;
    } catch (error) {
      await client.query("ROLLBACK");
      throw new Error(
        `Error transaccional al procesar garantía: ${(error as Error).message}`,
      );
    } finally {
      client.release();
    }
  }
}
