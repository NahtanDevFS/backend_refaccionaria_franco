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

  async resolverGarantia(
    id_garantia: number,
    data: ResolverGarantiaDTO,
  ): Promise<any> {
    const query = `
      UPDATE garantia
      SET id_supervisor_aprueba = $1, 
          estado = $2, 
          resolucion = $3
      WHERE id_garantia = $4
      RETURNING *;
    `;
    const result = await this.pool.query(query, [
      data.id_supervisor_aprueba,
      data.estado,
      data.resolucion,
      id_garantia,
    ]);
    return result.rows[0];
  }
}
