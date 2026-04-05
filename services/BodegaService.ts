// services/BodegaService.ts
import { BodegaRepository } from "../repositories/BodegaRepository";
import { MovimientoBodegaDTO } from "../dtos/BodegaDTO";

export class BodegaService {
  constructor(private readonly bodegaRepository: BodegaRepository) {}

  async procesarMovimiento(
    dto: MovimientoBodegaDTO,
    id_sucursal: number,
    id_usuario: number,
  ) {
    // Aquí podríamos agregar lógicas futuras, como validar que el id_producto exista en el catálogo global

    return await this.bodegaRepository.ejecutarMovimiento(
      id_sucursal,
      id_usuario,
      dto.id_producto,
      dto.tipo_movimiento,
      dto.cantidad,
      dto.motivo,
    );
  }
}
