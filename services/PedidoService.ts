// services/PedidoService.ts
import { PedidoRepository } from "../repositories/PedidoRepository";
import { ProgramarPedidoDTO, ResultadoEntregaDTO } from "../dtos/PedidoDTO";
import { EstadoPedido } from "../types/pedido.types";

export class PedidoService {
  constructor(private readonly pedidoRepository: PedidoRepository) {}

  async programarDespacho(dto: ProgramarPedidoDTO) {
    const estadoVenta = await this.pedidoRepository.obtenerEstadoVenta(
      dto.id_venta,
    );

    if (!estadoVenta) {
      throw new Error(`La venta con ID ${dto.id_venta} no existe.`);
    }

    // Regla: Solo despachamos ventas pendientes de pago (pago contra entrega) o ya pagadas.
    if (estadoVenta === "cancelada" || estadoVenta === "entregada") {
      throw new Error(
        `No se puede programar despacho para una venta con estado: ${estadoVenta}`,
      );
    }

    return await this.pedidoRepository.crearPedido(dto);
  }

  async reportarEntrega(id_pedido: number, dto: ResultadoEntregaDTO) {
    // Si el repartidor cobró efectivo, en la próxima iteración el sistema
    // le notificará al Cajero que debe hacer el ingreso de ese dinero.

    await this.pedidoRepository.actualizarResultadoEntrega(id_pedido, dto);

    return {
      success: true,
      message:
        dto.estado === EstadoPedido.ENTREGADO
          ? "Entrega confirmada exitosamente"
          : "Se registró el fallo de la entrega",
    };
  }
}
