// repositories/ProductoRepository.ts

import { Pool } from "pg";
import { IProductoRepository } from "./IProductoRepository";

export class ProductoRepository implements IProductoRepository {
  private pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  async obtenerPrecioYStock(
    id_producto: number,
    id_sucursal: number,
  ): Promise<{ precio_venta: number; stock_actual: number } | null> {
    const query = `
      SELECT p.precio_venta, i.cantidad_actual AS stock_actual
      FROM producto p
      INNER JOIN inventario_sucursal i ON p.id_producto = i.id_producto
      WHERE p.id_producto = $1 AND i.id_sucursal = $2;
    `;

    const values = [id_producto, id_sucursal];

    try {
      const result = await this.pool.query(query, values);

      if (result.rows.length === 0) {
        return null;
      }

      // pg devuelve los campos NUMERIC como strings para evitar pérdida de precisión en JS.
      // Los parseamos a Number explícitamente para cumplir con nuestra interfaz.
      return {
        precio_venta: Number(result.rows[0].precio_venta),
        stock_actual: Number(result.rows[0].stock_actual),
      };
    } catch (error) {
      throw new Error(
        `Error al consultar producto: ${(error as Error).message}`,
      );
    }
  }
}
