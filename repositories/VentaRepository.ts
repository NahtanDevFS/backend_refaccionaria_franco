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

  async crearOrdenVenta(data: CrearVentaDTO): Promise<number> {
    const client = await this.pool.connect();

    try {
      await client.query("BEGIN");

      let id_cliente = null;

      // 1. Validar / Crear Cliente
      if (data.nit !== "CF") {
        const clienteRes = await client.query(
          "SELECT id_cliente FROM cliente WHERE nit = $1",
          [data.nit],
        );
        if (clienteRes.rows.length > 0) {
          id_cliente = clienteRes.rows[0].id_cliente;
        } else if (data.cliente_nuevo) {
          const insertCliente = await client.query(
            `
            INSERT INTO cliente (nombre_razon_social, nit, tipo_cliente, telefono, email, direccion, id_municipio, notas_internas) 
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id_cliente
          `,
            [
              data.cliente_nuevo.nombre_razon_social,
              data.nit,
              data.cliente_nuevo.tipo_cliente,
              data.cliente_nuevo.telefono,
              data.cliente_nuevo.email,
              data.cliente_nuevo.direccion,
              data.cliente_nuevo.id_municipio,
              data.cliente_nuevo.notas_internas,
            ],
          );
          id_cliente = insertCliente.rows[0].id_cliente;
        } else {
          throw new Error(
            "Cliente no encontrado y no se enviaron datos para crearlo.",
          );
        }
      }

      // 2. Calcular totales y validar stock
      let subtotal = 0;
      for (const det of data.detalles) {
        const prodRes = await client.query(
          `
          SELECT p.precio_venta, i.cantidad_actual 
          FROM producto p 
          JOIN inventario_sucursal i ON p.id_producto = i.id_producto 
          WHERE p.id_producto = $1 AND i.id_sucursal = $2 FOR UPDATE
        `,
          [det.id_producto, data.id_sucursal],
        );

        if (
          prodRes.rows.length === 0 ||
          prodRes.rows[0].cantidad_actual < det.cantidad
        ) {
          throw new Error(
            `Stock insuficiente para el producto ID ${det.id_producto}`,
          );
        }

        subtotal += Number(prodRes.rows[0].precio_venta) * det.cantidad;

        // 3. Descontar Inventario
        await client.query(
          `
          UPDATE inventario_sucursal SET cantidad_actual = cantidad_actual - $1 
          WHERE id_producto = $2 AND id_sucursal = $3
        `,
          [det.cantidad, det.id_producto, data.id_sucursal],
        );
      }

      //Crear Venta (Estado dinámico según el canal)
      const estadoVenta =
        data.canal === "domicilio" && data.pago_contra_entrega
          ? "pendiente_cobro_contra_entrega"
          : "pendiente_pago";

      const ventaRes = await client.query(
        `
        INSERT INTO venta (id_sucursal, id_vendedor, id_cliente, canal, estado, subtotal, total)
        VALUES ($1, $2, $3, $4, $5, $6, $6) RETURNING id_venta
      `,
        [
          data.id_sucursal,
          data.id_vendedor,
          id_cliente,
          data.canal,
          estadoVenta,
          subtotal,
        ],
      );

      const id_venta = ventaRes.rows[0].id_venta;

      // 5. Insertar Detalles
      for (const det of data.detalles) {
        await client.query(
          `
          INSERT INTO detalle_venta (id_venta, id_producto, cantidad, precio_unitario, subtotal_linea)
          SELECT $1, $2, $3, precio_venta, (precio_venta * $3) FROM producto WHERE id_producto = $2
        `,
          [id_venta, det.id_producto, det.cantidad],
        );
      }

      // 6. Logística
      if (data.canal === "domicilio" && data.direccion_entrega) {
        await client.query(
          `
          INSERT INTO pedido_domicilio (id_venta, id_repartidor, direccion_entrega, estado)
          VALUES ($1, $2, $3, 'pendiente')
        `,
          [id_venta, data.id_repartidor, data.direccion_entrega],
        );
      }

      await client.query("COMMIT");
      return id_venta;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
  // Añade este método a la clase VentaRepository
  async obtenerRepartidoresPorSucursal(id_sucursal: number): Promise<any[]> {
    const query = `
      SELECT e.id_empleado, e.nombre, e.apellido
      FROM empleado e
      INNER JOIN puesto p ON e.id_puesto = p.id_puesto
      WHERE e.id_sucursal = $1 
        AND p.nombre ILIKE '%repartidor%' 
        AND e.activo = true;
    `;
    const result = await this.pool.query(query, [id_sucursal]);
    return result.rows;
  }
}
