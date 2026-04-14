// services/InventarioService.ts
import { Pool } from "pg";

export class InventarioService {
  constructor(private readonly pool: Pool) {}

  async consultarStockCentralizado(criterio: string) {
    if (!criterio || criterio.trim().length < 3) {
      throw new Error(
        "El criterio de búsqueda debe tener al menos 3 caracteres.",
      );
    }

    const query = `
      SELECT 
        p.id_producto, p.sku, p.nombre AS producto, p.precio_venta,
        s.nombre AS sucursal, i.cantidad_actual AS stock_disponible, i.punto_reorden
      FROM producto p
      INNER JOIN inventario_sucursal i ON p.id_producto = i.id_producto
      INNER JOIN sucursal s ON i.id_sucursal = s.id_sucursal
      WHERE p.sku ILIKE $1 OR p.nombre ILIKE $1
      ORDER BY p.nombre, s.id_sucursal;
    `;

    const result = await this.pool.query(query, [`%${criterio.trim()}%`]);
    const resultados = result.rows.map((row) => ({
      ...row,
      precio_venta: Number(row.precio_venta),
      stock_disponible: Number(row.stock_disponible),
      punto_reorden: Number(row.punto_reorden),
    }));

    if (resultados.length === 0) {
      return { mensaje: "No se encontraron productos", data: [] };
    }

    return { mensaje: "Stock consultado exitosamente", data: resultados };
  }

  async buscarProductoMultiSucursal(termino: string, idSucursalLocal: number) {
    const query = `
      SELECT 
        p.id_producto, p.sku, p.nombre, p.precio_venta,
        COALESCE(MAX(CASE WHEN i.id_sucursal = $2 THEN i.cantidad_actual END), 0) as stock_local,
        COALESCE(
          json_agg(
            json_build_object('sucursal', s.nombre, 'cantidad', i.cantidad_actual)
          ) FILTER (WHERE i.id_sucursal != $2 AND i.cantidad_actual > 0), '[]'
        ) as stock_otras_sucursales
      FROM producto p
      LEFT JOIN inventario_sucursal i ON p.id_producto = i.id_producto
      LEFT JOIN sucursal s ON i.id_sucursal = s.id_sucursal
      WHERE p.activo = true AND (p.nombre ILIKE $1 OR p.sku ILIKE $1)
      GROUP BY p.id_producto;
    `;

    const result = await this.pool.query(query, [
      `%${termino}%`,
      idSucursalLocal,
    ]);
    return result.rows.map((row) => ({
      ...row,
      precio_venta: Number(row.precio_venta),
      stock_local: Number(row.stock_local),
    }));
  }
}
