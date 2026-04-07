export interface MarcarEntregaExitosaDTO {
  id_pedido: number;
  monto_cobrado?: number; // Solo requerido si es pago contra entrega
}

export interface MarcarEntregaFallidaDTO {
  id_pedido: number;
  motivo_fallido: string;
}
