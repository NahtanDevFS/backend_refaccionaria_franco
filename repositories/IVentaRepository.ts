// repositories/IVentaRepository.ts
import { Venta, DetalleVenta } from "../entities/Venta";
import { CrearVentaDTO } from "../dtos/CrearVentaDTO";
import { DetalleVentaCalculado } from "../types/repository.types";

export interface IVentaRepository {
  /**
   * Crea una venta y sus detalles dentro de una transacción SQL.
   * Si algo falla, se hace un ROLLBACK automático.
   */
  crearVentaConDetalles(
    ventaData: CrearVentaDTO,
    totalCalculado: number,
    subtotalCalculado: number,
    detallesCalculados: DetalleVentaCalculado[],
  ): Promise<Venta>;

  /**
   * Obtiene una venta por su ID junto con sus detalles.
   */
  obtenerVentaPorId(
    id_venta: number,
  ): Promise<{ venta: Venta; detalles: DetalleVenta[] } | null>;
}
