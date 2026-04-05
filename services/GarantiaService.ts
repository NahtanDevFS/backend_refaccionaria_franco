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

  async procesarResolucion(
    id_garantia: number,
    dto: ResolverGarantiaDTO,
    id_supervisor: number,
    id_usuario: number,
  ) {
    // Ya no llamamos a resolverGarantia, llamamos al nuevo método transaccional
    return await this.garantiaRepository.resolverGarantiaConInventario(
      id_garantia,
      dto,
      id_supervisor,
      id_usuario,
    );
  }
}
