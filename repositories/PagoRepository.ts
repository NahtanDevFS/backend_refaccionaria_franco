// repositories/PagoRepository.ts

import { Pool } from "pg";
import { IPagoRepository } from "./IPagoRepository";
import { EstadoVenta } from "../types/venta.types";

export class PagoRepository implements IPagoRepository {
  private pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  async registrarPagoYFactura(
    id_venta: number,
    id_cajero: number,
    metodo_pago: string,
    monto: number,
    referencia: string | null,
    uuid_factura: string,
  ): Promise<void> {
    const client = await this.pool.connect();

    try {
      await client.query("BEGIN");

      // 1. Insertamos el registro del pago
      const insertPagoQuery = `
        INSERT INTO pago (id_venta, id_cajero, metodo_pago, monto, referencia, uuid_factura, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, NOW());
      `;
      const pagoValues = [
        id_venta,
        id_cajero,
        metodo_pago,
        monto,
        referencia,
        uuid_factura,
      ];
      await client.query(insertPagoQuery, pagoValues);

      // 2. Actualizamos el estado de la venta a PAGADA
      const updateVentaQuery = `
        UPDATE venta 
        SET estado = $1, updated_at = NOW()
        WHERE id_venta = $2;
      `;
      const ventaValues = [EstadoVenta.PAGADA, id_venta];
      await client.query(updateVentaQuery, ventaValues);

      // 3. Disparar salida de inventario (CU-08)
      // Como regla de negocio estricta, la salida de inventario ocurre aquí tras el pago exitoso.
      // Hacemos un UPDATE al stock basándonos en los detalles de la venta.
      const updateStockQuery = `
        UPDATE inventario_sucursal iv
        SET stock_actual = iv.stock_actual - dv.cantidad
        FROM detalle_venta dv, venta v
        WHERE dv.id_venta = v.id_venta
          AND dv.id_producto = iv.id_producto
          AND v.id_sucursal = iv.id_sucursal
          AND v.id_venta = $1;
      `;
      await client.query(updateStockQuery, [id_venta]);

      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw new Error(
        `Error transaccional al procesar el pago: ${(error as Error).message}`,
      );
    } finally {
      client.release();
    }
  }
}
