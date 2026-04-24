// services/PedidoService.ts
import { Pool } from "pg";
import { ProgramarPedidoDTO, ResultadoEntregaDTO } from "../dtos/PedidoDTO";
import { EstadoPedido } from "../types/pedido.types";

export class PedidoService {
  constructor(private readonly pool: Pool) {}

  // Programar despacho a domicilio
  async programarDespacho(dto: ProgramarPedidoDTO) {
    const resultVenta = await this.pool.query(
      `SELECT ev.nombre AS estado, v.id_cliente
       FROM venta v
       JOIN estado_venta ev ON v.id_estado_venta = ev.id_estado_venta
       WHERE v.id_venta = $1`,
      [dto.id_venta],
    );

    if (!resultVenta.rows.length)
      throw new Error(`La venta con ID ${dto.id_venta} no existe.`);

    const { estado: estadoVenta, id_cliente } = resultVenta.rows[0];

    if (estadoVenta === "anulada" || estadoVenta === "pagada") {
      throw new Error(
        `No se puede programar despacho para una venta con estado: ${estadoVenta}`,
      );
    }

    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      const destRes = await client.query(
        `INSERT INTO destinatario (id_cliente, direccion_texto)
         VALUES ($1, $2)
         RETURNING id_destinatario`,
        [id_cliente || null, dto.direccion_entrega],
      );
      const id_destinatario = destRes.rows[0].id_destinatario;

      const result = await client.query(
        `INSERT INTO pedido_domicilio
           (id_venta, id_repartidor, id_destinatario, id_estado_pedido)
         VALUES (
           $1, $2, $3,
           (SELECT id_estado_pedido FROM estado_pedido WHERE nombre = 'pendiente')
         )
         RETURNING *`,
        [dto.id_venta, dto.id_repartidor || null, id_destinatario],
      );

      await client.query("COMMIT");
      return result.rows[0];
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  //Reportar resultado de entrega
  async reportarEntrega(id_pedido: number, dto: ResultadoEntregaDTO) {
    await this.pool.query(
      `UPDATE pedido_domicilio
       SET id_estado_pedido = (
             SELECT id_estado_pedido FROM estado_pedido WHERE nombre = $1
           ),
           monto_cobrado_contra_entrega = $2,
           motivo_fallido               = $3,
           fecha_entrega                = NOW()
       WHERE id_pedido = $4`,
      [
        dto.estado,
        dto.monto_cobrado_contra_entrega || null,
        dto.motivo_fallido || null,
        id_pedido,
      ],
    );

    return {
      success: true,
      message:
        dto.estado === EstadoPedido.ENTREGADO
          ? "Entrega confirmada exitosamente"
          : "Se registró el fallo de la entrega",
    };
  }
}
