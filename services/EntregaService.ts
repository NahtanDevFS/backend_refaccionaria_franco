import { IEntregaRepository } from "../repositories/IEntregaRepository";
import {
  MarcarEntregaExitosaDTO,
  MarcarEntregaFallidaDTO,
} from "../dtos/EntregaDTO";

export class EntregaService {
  constructor(private readonly entregaRepository: IEntregaRepository) {}

  async obtenerMisPedidos(id_repartidor: number) {
    return await this.entregaRepository.obtenerPedidosAsignados(id_repartidor);
  }

  async marcarExito(id_repartidor: number, data: MarcarEntregaExitosaDTO) {
    await this.entregaRepository.marcarComoEntregado(
      data.id_pedido,
      id_repartidor,
      data.monto_cobrado,
    );
  }

  async marcarFallida(id_repartidor: number, data: MarcarEntregaFallidaDTO) {
    await this.entregaRepository.marcarComoFallido(
      data.id_pedido,
      id_repartidor,
      data.motivo_fallido,
    );
  }
}
