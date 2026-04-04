// repositories/InventarioRepository.ts
import { Pool } from "pg";

export class InventarioRepository {
  constructor(private readonly pool: Pool) {}

  async buscarStockGlobal(criterio: string): Promise<any[]> {
    const query = `
      SELECT 
        p.id_producto,
        p.sku, 
        p.nombre AS producto, 
        p.precio_venta,
        s.nombre AS sucursal, 
        i.cantidad_actual AS stock_disponible, 
        i.punto_reorden
      FROM producto p
      INNER JOIN inventario_sucursal i ON p.id_producto = i.id_producto
      INNER JOIN sucursal s ON i.id_sucursal = s.id_sucursal
      WHERE p.sku ILIKE $1 OR p.nombre ILIKE $1
      ORDER BY p.nombre, s.id_sucursal;
    `;

    // Los % permiten que si el usuario busca "fric", encuentre "FRIC-001"
    const values = [`%${criterio}%`];

    try {
      const result = await this.pool.query(query, values);
      return result.rows.map((row) => ({
        ...row,
        precio_venta: Number(row.precio_venta),
        stock_disponible: Number(row.stock_disponible),
        punto_reorden: Number(row.punto_reorden),
      }));
    } catch (error) {
      throw new Error(
        `Error al consultar el stock global: ${(error as Error).message}`,
      );
    }
  }
}
