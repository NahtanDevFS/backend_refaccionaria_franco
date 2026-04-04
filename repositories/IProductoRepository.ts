// repositories/IProductoRepository.ts
export interface IProductoRepository {
  /**
   * Obtiene el precio unitario y el stock actual de un producto en una sucursal específica.
   */
  obtenerPrecioYStock(
    id_producto: number,
    id_sucursal: number,
  ): Promise<{ precio_venta: number; stock_actual: number } | null>;
}
