// dtos/PedidoDTO.ts
import { EstadoPedido } from "../types/pedido.types";

export interface ProgramarPedidoDTO {
  id_venta: number;
  direccion_entrega: string; // Se extrae del cliente o se pide por WhatsApp
  id_repartidor?: number; // Puede asignarse después
}

export interface ResultadoEntregaDTO {
  estado: EstadoPedido.ENTREGADO | EstadoPedido.FALLIDO;
  monto_cobrado_contra_entrega?: number; // Si el cliente paga al recibir
  motivo_fallido?: string; // Si no había nadie en casa, etc.
}
