// services/PedidoService.ts
import { Pool } from "pg";
import { ProgramarPedidoDTO, ResultadoEntregaDTO } from "../dtos/PedidoDTO";
import { EstadoPedido } from "../types/pedido.types";

export class PedidoService {
  constructor(private readonly pool: Pool) {}

  async programarDespacho(dto: ProgramarPedidoDTO) {
    const resultVenta = await this.pool.query(
      "SELECT estado FROM venta WHERE id_venta = $1",
      [dto.id_venta],
    );
    if (resultVenta.rows.length === 0)
      throw new Error(`La venta con ID ${dto.id_venta} no existe.`);

    const estadoVenta = resultVenta.rows[0].estado;
    if (estadoVenta === "cancelada" || estadoVenta === "entregada") {
      throw new Error(
        `No se puede programar despacho para una venta con estado: ${estadoVenta}`,
      );
    }

    const query = `
      INSERT INTO pedido_domicilio (id_venta, id_repartidor, direccion_entrega, estado)
      VALUES ($1, $2, $3, 'pendiente') RETURNING *;
    `;
    const result = await this.pool.query(query, [
      dto.id_venta,
      dto.id_repartidor || null,
      dto.direccion_entrega,
    ]);
    return result.rows[0];
  }

  async reportarEntrega(id_pedido: number, dto: ResultadoEntregaDTO) {
    const query = `
      UPDATE pedido_domicilio 
      SET estado = $1, monto_cobrado_contra_entrega = $2, motivo_fallido = $3, fecha_entrega = NOW()
      WHERE id_pedido = $4;
    `;
    await this.pool.query(query, [
      dto.estado,
      dto.monto_cobrado_contra_entrega || null,
      dto.motivo_fallido || null,
      id_pedido,
    ]);

    return {
      success: true,
      message:
        dto.estado === EstadoPedido.ENTREGADO
          ? "Entrega confirmada exitosamente"
          : "Se registró el fallo de la entrega",
    };
  }
}
