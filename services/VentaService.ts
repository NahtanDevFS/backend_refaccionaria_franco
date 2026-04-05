// services/VentaService.ts

import { IVentaRepository } from "../repositories/IVentaRepository";
import { IProductoRepository } from "../repositories/IProductoRepository";
import { CrearVentaDTO } from "../dtos/CrearVentaDTO";
import { Venta } from "../entities/Venta";
import { DetalleVentaCalculado } from "../types/repository.types";

export class VentaService {
  // Inyectamos las dependencias en el constructor
  constructor(
    private readonly ventaRepository: IVentaRepository,
    private readonly productoRepository: IProductoRepository,
  ) {}

  async registrarVentaMostrador(dto: CrearVentaDTO): Promise<Venta> {
    if (!dto.detalles || dto.detalles.length === 0) {
      throw new Error("La venta debe contener al menos un producto.");
    }

    let subtotalCalculado = 0;
    const detallesCalculados: DetalleVentaCalculado[] = [];

    // 1. Validar stock y calcular precios reales iterando los detalles
    for (const detalle of dto.detalles) {
      if (detalle.cantidad <= 0) {
        throw new Error(
          `La cantidad para el producto ${detalle.id_producto} debe ser mayor a 0.`,
        );
      }

      // Buscamos el precio y stock en la BD. Nunca confiamos en el cliente.
      const productoInfo = await this.productoRepository.obtenerPrecioYStock(
        detalle.id_producto,
        dto.id_sucursal,
      );

      if (!productoInfo) {
        throw new Error(
          `El producto con ID ${detalle.id_producto} no existe o no está asignado a esta sucursal.`,
        );
      }

      if (productoInfo.stock_actual < detalle.cantidad) {
        throw new Error(
          `Stock insuficiente para el producto ID ${detalle.id_producto}. Stock actual: ${productoInfo.stock_actual}`,
        );
      }

      const subtotalLinea = productoInfo.precio_venta * detalle.cantidad;
      subtotalCalculado += subtotalLinea;

      detallesCalculados.push({
        id_producto: detalle.id_producto,
        cantidad: detalle.cantidad,
        precio_unitario: productoInfo.precio_venta,
        subtotal_linea: subtotalLinea,
      });
    }

    // 2. Lógica de Descuentos
    let totalCalculado = subtotalCalculado;
    const porcentajeDescuento = dto.descuento_porcentaje_solicitado || 0;

    if (porcentajeDescuento > 0) {
      if (porcentajeDescuento > 5 && !dto.id_supervisor_autoriza) {
        // Regla de negocio estricta: > 5% requiere supervisor
        throw new Error(
          "Descuentos mayores al 5% requieren autorización del supervisor.",
        );
      }

      const montoDescuento = subtotalCalculado * (porcentajeDescuento / 100);
      totalCalculado = subtotalCalculado - montoDescuento;
    }

    // 3. Persistir la venta llamando al repositorio (la transacción ACID se maneja allá)
    return await this.ventaRepository.crearVentaConDetalles(
      dto,
      totalCalculado,
      subtotalCalculado,
      detallesCalculados,
    );
  }

  async obtenerVentas() {
    return await this.ventaRepository.obtenerHistorialVentas();
  }
}
