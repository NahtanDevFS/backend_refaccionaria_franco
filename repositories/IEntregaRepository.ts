export interface IEntregaRepository {
  obtenerPedidosAsignados(id_repartidor: number): Promise<any[]>;
  marcarComoEntregado(
    id_pedido: number,
    id_repartidor: number,
    monto_cobrado?: number,
  ): Promise<void>;
  marcarComoFallido(
    id_pedido: number,
    id_repartidor: number,
    motivo: string,
  ): Promise<void>;
}
