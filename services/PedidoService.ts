// services/PedidoService.ts
import { Pool } from "pg";
import { ProgramarPedidoDTO, ResultadoEntregaDTO } from "../dtos/PedidoDTO";
import { EstadoPedido } from "../types/pedido.types";

export class PedidoService {
  constructor(private readonly pool: Pool) {}

  // ── PUNTO 7: programarDespacho ya no inserta direccion_entrega,
  //    nombre_contacto ni telefono_contacto directamente en pedido_domicilio.
  //    Primero crea un registro en destinatario y luego lo referencia.
  async programarDespacho(dto: ProgramarPedidoDTO) {
    const resultVenta = await this.pool.query(
      "SELECT estado, id_cliente FROM venta WHERE id_venta = $1",
      [dto.id_venta],
    );
    if (resultVenta.rows.length === 0)
      throw new Error(`La venta con ID ${dto.id_venta} no existe.`);

    const { estado: estadoVenta, id_cliente } = resultVenta.rows[0];
    if (estadoVenta === "cancelada" || estadoVenta === "entregada") {
      throw new Error(
        `No se puede programar despacho para una venta con estado: ${estadoVenta}`,
      );
    }

    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      // Crear destinatario con los datos de entrega
      const destRes = await client.query(
        `INSERT INTO destinatario (id_cliente, direccion_texto)
         VALUES ($1, $2)
         RETURNING id_destinatario`,
        [id_cliente || null, dto.direccion_entrega],
      );
      const id_destinatario = destRes.rows[0].id_destinatario;

      // Insertar pedido referenciando el destinatario
      const result = await client.query(
        `INSERT INTO pedido_domicilio (id_venta, id_repartidor, id_destinatario, estado)
         VALUES ($1, $2, $3, 'pendiente') RETURNING *;`,
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
