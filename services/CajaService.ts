// services/CajaService.ts
import { Pool } from "pg";
import { RegistrarPagoDTO } from "../dtos/RegistrarPagoDTO";
import { ArqueoDTO } from "../dtos/ArqueoDTO";

export class CajaService {
  constructor(private readonly pool: Pool) {}

  async obtenerPendientes(id_sucursal: number) {
    const query = `
      SELECT 
        v.id_venta, v.estado, v.total, v.pago_contra_entrega, v.created_at,
        COALESCE(c.nombre_razon_social, 'Consumidor Final') as cliente
      FROM venta v
      LEFT JOIN cliente c ON v.id_cliente = c.id_cliente
      WHERE v.id_sucursal = $1 
        AND v.estado IN ('pendiente_pago', 'pendiente_cobro_contra_entrega')
      ORDER BY v.created_at ASC;
    `;
    const result = await this.pool.query(query, [id_sucursal]);
    return result.rows.map((row) => ({ ...row, total: Number(row.total) }));
  }

  async registrarPago(id_cajero: number, data: RegistrarPagoDTO) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      const ventaRes = await client.query(
        "SELECT estado, total FROM venta WHERE id_venta = $1 FOR UPDATE",
        [data.id_venta],
      );

      if (ventaRes.rows.length === 0) throw new Error("Venta no encontrada");
      const venta = ventaRes.rows[0];

      if (venta.estado === "pagada")
        throw new Error("Esta orden ya fue pagada.");
      if (data.monto < Number(venta.total)) {
        throw new Error(
          `El monto a pagar (Q${data.monto}) es menor al total de la orden (Q${venta.total}).`,
        );
      }

      await client.query(
        `
        INSERT INTO pago (id_venta, id_cajero, metodo_pago, monto, referencia)
        VALUES ($1, $2, $3, $4, $5)
      `,
        [
          data.id_venta,
          id_cajero,
          data.metodo_pago,
          data.monto,
          data.referencia,
        ],
      );

      await client.query(
        `UPDATE venta SET estado = 'pagada', updated_at = NOW() WHERE id_venta = $1`,
        [data.id_venta],
      );

      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async obtenerResumenDia(id_cajero: number) {
    const query = `
      SELECT metodo_pago, COALESCE(SUM(monto), 0) as total
      FROM pago
      WHERE id_cajero = $1 AND DATE(fecha_pago) = CURRENT_DATE AND id_arqueo IS NULL
      GROUP BY metodo_pago;
    `;
    const result = await this.pool.query(query, [id_cajero]);
    return result.rows.map((row) => ({
      metodo_pago: row.metodo_pago,
      total: Number(row.total),
    }));
  }

  async registrarArqueo(
    id_sucursal: number,
    id_cajero: number,
    data: ArqueoDTO,
  ) {
    const resumen = await this.obtenerResumenDia(id_cajero);
    const itemEfectivo = resumen.find((r) => r.metodo_pago === "efectivo");
    const efectivoSistema = itemEfectivo ? itemEfectivo.total : 0;

    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      const diferencia = data.efectivo_contado - efectivoSistema;
      const estado = diferencia === 0 ? "cuadra" : "con_diferencia";

      const result = await client.query(
        `
        INSERT INTO arqueo_caja (id_sucursal, id_cajero, efectivo_contado, efectivo_segun_sistema, diferencia, observaciones, estado) 
        VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id_arqueo;
      `,
        [
          id_sucursal,
          id_cajero,
          data.efectivo_contado,
          efectivoSistema,
          diferencia,
          data.observaciones,
          estado,
        ],
      );

      const id_arqueo = result.rows[0].id_arqueo;

      await client.query(
        `
        UPDATE pago SET id_arqueo = $1 
        WHERE id_cajero = $2 AND DATE(fecha_pago) = CURRENT_DATE AND id_arqueo IS NULL
      `,
        [id_arqueo, id_cajero],
      );

      await client.query("COMMIT");
      return id_arqueo;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}
