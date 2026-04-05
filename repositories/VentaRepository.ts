// repositories/VentaRepository.ts
import { Pool } from "pg";
import { IVentaRepository } from "./IVentaRepository";
import { CrearVentaDTO } from "../dtos/CrearVentaDTO";
import { Venta, DetalleVenta } from "../entities/Venta";
import { EstadoVenta } from "../types/venta.types";
import { DetalleVentaCalculado } from "../types/repository.types";

export class VentaRepository implements IVentaRepository {
  private pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  async crearVentaConDetalles(
    ventaData: CrearVentaDTO,
    totalCalculado: number,
    subtotalCalculado: number,
    detallesCalculados: DetalleVentaCalculado[],
  ): Promise<Venta> {
    // Solicitamos un cliente dedicado del pool para aislar la transacción
    const client = await this.pool.connect();

    try {
      // 1. Iniciamos la transacción ACID
      await client.query("BEGIN");

      const descuentoMonto = subtotalCalculado - totalCalculado;

      // 2. Insertamos la cabecera de la venta (siempre usando consultas parametrizadas)
      const insertVentaQuery = `
        INSERT INTO venta (
          id_sucursal, 
          id_vendedor, 
          id_cliente, 
          canal, 
          estado, 
          subtotal, 
          descuento_monto, 
          total,
          created_at,
          updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())
        RETURNING *;
      `;

      const ventaValues = [
        ventaData.id_sucursal,
        ventaData.id_vendedor,
        ventaData.id_cliente || null, // null si es consumidor final
        ventaData.canal,
        EstadoVenta.PENDIENTE_PAGO, // Estado inicial estricto
        subtotalCalculado,
        descuentoMonto,
        totalCalculado,
      ];

      const resultVenta = await client.query(insertVentaQuery, ventaValues);
      const nuevaVenta: Venta = resultVenta.rows[0];

      // 3. Insertamos los detalles de la venta
      const insertDetalleQuery = `
        INSERT INTO detalle_venta (
          id_venta, 
          id_producto, 
          cantidad, 
          precio_unitario, 
          subtotal_linea
        ) VALUES ($1, $2, $3, $4, $5);
      `;

      for (const detalle of detallesCalculados) {
        const detalleValues = [
          nuevaVenta.id_venta,
          detalle.id_producto,
          detalle.cantidad,
          detalle.precio_unitario,
          detalle.subtotal_linea,
        ];

        await client.query(insertDetalleQuery, detalleValues);
      }

      // 4. Si todo salió perfecto, confirmamos los cambios en la BD
      await client.query("COMMIT");

      return nuevaVenta;
    } catch (error) {
      // Si algo falla (ej. error de constraint, red, etc.), revertimos TODO
      await client.query("ROLLBACK");

      // Relanzamos el error para que el Controller lo atrape y envíe el HTTP 500/400
      throw new Error(`Error al crear la venta: ${(error as Error).message}`);
    } finally {
      // CRÍTICO: Siempre liberar el cliente para no agotar el pool de conexiones
      client.release();
    }
  }

  // Agregar dentro de la clase VentaRepository en repositories/VentaRepository.ts

  async obtenerVentaPorId(
    id_venta: number,
  ): Promise<{ venta: Venta; detalles: any[] } | null> {
    const query = `
      SELECT * FROM venta WHERE id_venta = $1;
    `;

    try {
      const result = await this.pool.query(query, [id_venta]);

      if (result.rows.length === 0) {
        return null;
      }

      const venta = result.rows[0];

      // Mapeamos explícitamente los campos NUMERIC para evitar errores en las validaciones de TypeScript
      venta.subtotal = Number(venta.subtotal);
      venta.descuento_monto = Number(venta.descuento_monto);
      venta.total = Number(venta.total);

      // Para el caso de uso del pago, no es estrictamente necesario traer los detalles,
      // pero devolvemos el arreglo vacío para cumplir con la firma de la interfaz por ahora.
      return { venta, detalles: [] };
    } catch (error) {
      throw new Error(
        `Error al consultar la venta: ${(error as Error).message}`,
      );
    }
  }

  async obtenerHistorialVentas(): Promise<any[]> {
    const query = `
      SELECT 
        v.id_venta, 
        v.created_at as fecha, 
        COALESCE(c.nombre_razon_social, 'Consumidor Final') as cliente, 
        v.total, 
        v.estado 
      FROM venta v
      LEFT JOIN cliente c ON v.id_cliente = c.id_cliente
      ORDER BY v.created_at DESC
      LIMIT 50;
    `;

    try {
      // Corrección: usamos this.pool en lugar de this.db
      const result = await this.pool.query(query);

      // Parseamos los numéricos por seguridad (como lo haces en obtenerVentaPorId)
      return result.rows.map((row) => ({
        ...row,
        total: Number(row.total),
      }));
    } catch (error) {
      throw new Error(
        `Error al obtener el historial de ventas: ${(error as Error).message}`,
      );
    }
  }
}
