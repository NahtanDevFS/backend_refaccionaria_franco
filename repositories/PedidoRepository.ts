// repositories/PedidoRepository.ts
import { Pool } from "pg";
import { ProgramarPedidoDTO, ResultadoEntregaDTO } from "../dtos/PedidoDTO";

export class PedidoRepository {
  constructor(private readonly pool: Pool) {}

  async crearPedido(data: ProgramarPedidoDTO): Promise<any> {
    const query = `
      INSERT INTO pedido_domicilio (id_venta, id_repartidor, direccion_entrega, estado)
      VALUES ($1, $2, $3, 'pendiente')
      RETURNING *;
    `;
    const values = [
      data.id_venta,
      data.id_repartidor || null,
      data.direccion_entrega,
    ];

    try {
      const result = await this.pool.query(query, values);
      return result.rows[0];
    } catch (error) {
      throw new Error(
        `Error al programar el pedido: ${(error as Error).message}`,
      );
    }
  }

  async actualizarResultadoEntrega(
    id_pedido: number,
    data: ResultadoEntregaDTO,
  ): Promise<void> {
    const query = `
      UPDATE pedido_domicilio 
      SET estado = $1, 
          monto_cobrado_contra_entrega = $2, 
          motivo_fallido = $3, 
          fecha_entrega = NOW()
      WHERE id_pedido = $4;
    `;
    const values = [
      data.estado,
      data.monto_cobrado_contra_entrega || null,
      data.motivo_fallido || null,
      id_pedido,
    ];

    try {
      await this.pool.query(query, values);
    } catch (error) {
      throw new Error(
        `Error al actualizar el pedido: ${(error as Error).message}`,
      );
    }
  }

  // Utilidad para verificar si la venta existe y su estado
  async obtenerEstadoVenta(id_venta: number): Promise<string | null> {
    const result = await this.pool.query(
      "SELECT estado FROM venta WHERE id_venta = $1",
      [id_venta],
    );
    return result.rows.length ? result.rows[0].estado : null;
  }
}
