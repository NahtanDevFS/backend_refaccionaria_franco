// dtos/PedidoDTO.ts
import { EstadoPedido } from "../types/pedido.types";

export interface ProgramarPedidoDTO {
  id_venta: number;
  direccion_entrega: string;
  id_repartidor?: number;
}

export interface ResultadoEntregaDTO {
  estado: EstadoPedido.ENTREGADO | EstadoPedido.FALLIDO;
  monto_cobrado_contra_entrega?: number; // Si el cliente paga al recibir
  motivo_fallido?: string;
}
