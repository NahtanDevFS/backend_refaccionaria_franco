// repositories/BodegaRepository.ts
import { Pool } from "pg";
import { TipoMovimientoBodega } from "../types/bodega.types";

export class BodegaRepository {
  constructor(private readonly pool: Pool) {}

  async ejecutarMovimiento(
    id_sucursal: number,
    id_usuario: number,
    id_producto: number,
    tipo: TipoMovimientoBodega,
    cantidad: number,
    motivo: string,
  ): Promise<any> {
    const client = await this.pool.connect();

    try {
      await client.query("BEGIN");

      // 1. Buscar si el producto ya existe en la sucursal y bloquear la fila para concurrencia
      const checkQuery = `
        SELECT id_inventario, cantidad_actual 
        FROM inventario_sucursal 
        WHERE id_producto = $1 AND id_sucursal = $2 
        FOR UPDATE;
      `;
      const checkResult = await client.query(checkQuery, [
        id_producto,
        id_sucursal,
      ]);
      let inv = checkResult.rows[0];

      let nuevaCantidad = 0;
      let idInventario = 0;

      const esResta = tipo === TipoMovimientoBodega.AJUSTE_NEGATIVO;
      const variacion = esResta ? -cantidad : cantidad;

      if (inv) {
        // El producto ya existe en la sucursal, actualizamos
        nuevaCantidad = Number(inv.cantidad_actual) + variacion;

        if (nuevaCantidad < 0) {
          throw new Error(
            `Stock insuficiente. No puede restar ${cantidad}, el stock actual es ${inv.cantidad_actual}`,
          );
        }

        const updateQuery = `
          UPDATE inventario_sucursal 
          SET cantidad_actual = $1 
          WHERE id_inventario = $2 
          RETURNING id_inventario;
        `;
        await client.query(updateQuery, [nuevaCantidad, inv.id_inventario]);
        idInventario = inv.id_inventario;
      } else {
        // El producto es nuevo en esta sucursal (ej. primera vez que llega)
        if (esResta) {
          throw new Error(
            "No se puede hacer un ajuste negativo de un producto que no existe en la sucursal.",
          );
        }

        nuevaCantidad = cantidad;
        const insertQuery = `
          INSERT INTO inventario_sucursal (id_producto, id_sucursal, cantidad_actual, punto_reorden)
          VALUES ($1, $2, $3, 5)
          RETURNING id_inventario;
        `;
        const insertResult = await client.query(insertQuery, [
          id_producto,
          id_sucursal,
          nuevaCantidad,
        ]);
        idInventario = insertResult.rows[0].id_inventario;
      }

      // 2. Registrar la trazabilidad en la bitácora
      const logQuery = `
        INSERT INTO movimiento_inventario 
        (id_inventario, id_usuario, tipo, cantidad, cantidad_resultante, motivo)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING *;
      `;
      const logResult = await client.query(logQuery, [
        idInventario,
        id_usuario,
        tipo,
        cantidad,
        nuevaCantidad,
        motivo,
      ]);

      await client.query("COMMIT");
      return {
        id_inventario: idInventario,
        stock_actualizado: nuevaCantidad,
        movimiento: logResult.rows[0],
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw new Error(
        `Error en transacción de bodega: ${(error as Error).message}`,
      );
    } finally {
      client.release();
    }
  }
}
