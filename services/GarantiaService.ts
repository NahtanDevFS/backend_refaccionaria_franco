// services/GarantiaService.ts
import { GarantiaRepository } from "../repositories/GarantiaRepository";
import { SolicitarGarantiaDTO, ResolverGarantiaDTO } from "../dtos/GarantiaDTO";

export class GarantiaService {
  constructor(private readonly garantiaRepository: GarantiaRepository) {}

  async solicitarGarantia(dto: SolicitarGarantiaDTO) {
    const info = await this.garantiaRepository.obtenerInfoGarantia(
      dto.id_detalle_venta,
    );

    if (!info) {
      throw new Error("El detalle de venta indicado no existe.");
    }

    if (info.garantia_dias <= 0) {
      throw new Error("Este producto no cuenta con garantía de fábrica.");
    }

    // Lógica de validación de fechas
    const fechaVenta = new Date(info.fecha_venta);
    const fechaActual = new Date();

    // Calculamos la diferencia en milisegundos y la pasamos a días
    const diferenciaMs = fechaActual.getTime() - fechaVenta.getTime();
    const diasTranscurridos = Math.floor(diferenciaMs / (1000 * 60 * 60 * 24));

    if (diasTranscurridos > info.garantia_dias) {
      throw new Error(
        `Garantía expirada. Han transcurrido ${diasTranscurridos} días desde la compra, y la garantía era de solo ${info.garantia_dias} días.`,
      );
    }

    return await this.garantiaRepository.crearSolicitud(dto);
  }

  async procesarResolucion(id_garantia: number, dto: ResolverGarantiaDTO) {
    // Aquí, si la resolución es 'aprobada', en un escenario más complejo
    // deberíamos conectarnos al InventarioRepository para ingresar la pieza mala
    // a una bodega de "descarte" y sacar una pieza nueva.
    // Por ahora, registramos la resolución del supervisor.
    return await this.garantiaRepository.resolverGarantia(id_garantia, dto);
  }
}
