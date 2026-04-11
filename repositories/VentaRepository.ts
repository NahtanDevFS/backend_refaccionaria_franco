// repositories/VentaRepository.ts
import { Pool } from "pg";
import { IVentaRepository } from "./IVentaRepository";
import { CrearVentaDTO } from "../dtos/CrearVentaDTO";
import { Venta } from "../entities/Venta";

export class VentaRepository implements IVentaRepository {
  private pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  async obtenerVentaPorId(
    id_venta: number,
  ): Promise<{ venta: any; detalles: any[] } | null> {
    const queryVenta = `
      SELECT v.*, 
             COALESCE(c.nombre_razon_social, 'Consumidor Final') as cliente,
             CONCAT(e.nombre, ' ', e.apellido) as vendedor
      FROM venta v
      LEFT JOIN cliente c ON v.id_cliente = c.id_cliente
      LEFT JOIN empleado e ON v.id_vendedor = e.id_empleado
      WHERE v.id_venta = $1;
    `;
    const queryDetalles = `
      SELECT dv.id_detalle, dv.id_producto, p.nombre as producto, p.sku, p.garantia_dias, dv.cantidad, dv.precio_unitario, dv.subtotal_linea
      FROM detalle_venta dv
      JOIN producto p ON dv.id_producto = p.id_producto
      WHERE dv.id_venta = $1;
    `;

    try {
      const resVenta = await this.pool.query(queryVenta, [id_venta]);
      if (resVenta.rows.length === 0) return null;

      const resDetalles = await this.pool.query(queryDetalles, [id_venta]);

      return {
        venta: resVenta.rows[0],
        detalles: resDetalles.rows.map((row) => ({
          ...row,
          cantidad: Number(row.cantidad),
          precio_unitario: Number(row.precio_unitario),
          subtotal_linea: Number(row.subtotal_linea),
        })),
      };
    } catch (error) {
      throw new Error(
        `Error al consultar la venta: ${(error as Error).message}`,
      );
    }
  }

  async obtenerHistorialVentas(
    filtros?: any,
  ): Promise<{ data: any[]; total: number }> {
    // 1. Construimos la base de la consulta (FROM y WHERE) que se compartirá
    let baseQuery = `
      FROM venta v
      LEFT JOIN cliente c ON v.id_cliente = c.id_cliente
      LEFT JOIN empleado e ON v.id_vendedor = e.id_empleado
      WHERE 1=1
    `;

    const values: any[] = [];
    let paramIndex = 1;

    // Aplicamos filtros dinámicos
    if (filtros?.fechaInicio) {
      baseQuery += ` AND DATE(v.created_at) >= $${paramIndex}`;
      values.push(filtros.fechaInicio);
      paramIndex++;
    }
    if (filtros?.fechaFin) {
      baseQuery += ` AND DATE(v.created_at) <= $${paramIndex}`;
      values.push(filtros.fechaFin);
      paramIndex++;
    }
    if (filtros?.id_vendedor) {
      baseQuery += ` AND v.id_vendedor = $${paramIndex}`;
      values.push(filtros.id_vendedor);
      paramIndex++;
    }
    if (filtros?.estado) {
      baseQuery += ` AND v.estado = $${paramIndex}`;
      values.push(filtros.estado);
      paramIndex++;
    }

    // 2. Consulta de Conteo Total (Para saber cuántas páginas habrá)
    const countQuery = `SELECT COUNT(*) as total ` + baseQuery;

    // 3. Consulta de Datos (Paginados)
    const page = filtros?.page ? Number(filtros.page) : 1;
    const limit = filtros?.limit ? Number(filtros.limit) : 20;
    const offset = (page - 1) * limit;

    let dataQuery =
      `
      SELECT 
        v.id_venta, 
        v.created_at as fecha, 
        COALESCE(c.nombre_razon_social, 'Consumidor Final') as cliente, 
        CONCAT(e.nombre, ' ', e.apellido) as vendedor,
        v.canal,
        v.subtotal,
        v.descuento_monto as descuento,
        v.total, 
        v.estado 
    ` + baseQuery;

    dataQuery += ` ORDER BY v.created_at DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1};`;
    const dataValues = [...values, limit, offset];

    try {
      // Ejecutamos ambas consultas al mismo tiempo
      const [countResult, dataResult] = await Promise.all([
        this.pool.query(countQuery, values), // Usa los valores sin limit ni offset
        this.pool.query(dataQuery, dataValues), // Usa los valores + limit + offset
      ]);

      const total = Number(countResult.rows[0].total);

      // Parseamos los numéricos por seguridad
      const data = dataResult.rows.map((row) => ({
        ...row,
        subtotal: Number(row.subtotal),
        descuento: Number(row.descuento),
        total: Number(row.total),
      }));

      return { data, total };
    } catch (error) {
      throw new Error(
        `Error al obtener el historial de ventas: ${(error as Error).message}`,
      );
    }
  }

  async obtenerVendedoresPorSucursal(id_sucursal: number): Promise<any[]> {
    const query = `
      SELECT e.id_empleado, e.nombre, e.apellido
      FROM empleado e
      INNER JOIN puesto p ON e.id_puesto = p.id_puesto
      WHERE e.id_sucursal = $1 
        AND p.nombre ILIKE '%vendedor%' 
        AND e.activo = true;
    `;
    const result = await this.pool.query(query, [id_sucursal]);
    return result.rows;
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

      // === LÓGICA DE DESCUENTO Y ESTADOS ===
      const pctDescuento = data.descuento_porcentaje || 0;
      const descuentoMonto = subtotal * (pctDescuento / 100);
      const total = subtotal - descuentoMonto;
      const esContraEntrega = data.pago_contra_entrega || false;

      let estadoVenta = "pendiente_pago";
      if (pctDescuento > 5) {
        estadoVenta = "pendiente_autorizacion";
      } else if (data.canal === "domicilio" && esContraEntrega) {
        estadoVenta = "pendiente_cobro_contra_entrega";
      }

      // 4. Crear Venta
      const ventaRes = await client.query(
        `
        INSERT INTO venta (id_sucursal, id_vendedor, id_cliente, canal, pago_contra_entrega, estado, subtotal, descuento_monto, total)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id_venta
      `,
        [
          data.id_sucursal,
          data.id_vendedor,
          id_cliente,
          data.canal,
          esContraEntrega,
          estadoVenta,
          subtotal,
          descuentoMonto,
          total,
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
          INSERT INTO pedido_domicilio (id_venta, id_repartidor, direccion_entrega, estado, nombre_contacto, telefono_contacto)
          VALUES ($1, $2, $3, 'pendiente', $4, $5)
        `,
          [
            id_venta,
            data.id_repartidor,
            data.direccion_entrega,
            data.nombre_contacto,
            data.telefono_contacto,
          ],
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

  async obtenerPendientesAutorizacion(id_sucursal: number): Promise<any[]> {
    const query = `
      SELECT 
        v.id_venta, 
        v.created_at as fecha, 
        COALESCE(c.nombre_razon_social, 'Consumidor Final') as cliente, 
        CONCAT(e.nombre, ' ', e.apellido) as vendedor,
        v.subtotal, 
        v.descuento_monto, 
        v.total,
        ROUND((v.descuento_monto / v.subtotal) * 100, 2) as pct_descuento
      FROM venta v
      LEFT JOIN cliente c ON v.id_cliente = c.id_cliente
      INNER JOIN empleado e ON v.id_vendedor = e.id_empleado
      WHERE v.id_sucursal = $1 AND v.estado = 'pendiente_autorizacion'
      ORDER BY v.created_at ASC;
    `;
    const result = await this.pool.query(query, [id_sucursal]);
    return result.rows.map((row) => ({
      ...row,
      subtotal: Number(row.subtotal),
      descuento_monto: Number(row.descuento_monto),
      total: Number(row.total),
      pct_descuento: Number(row.pct_descuento),
    }));
  }

  async resolverAutorizacion(
    id_venta: number,
    id_supervisor: number,
    id_usuario_log: number,
    aprobado: boolean,
  ): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      // 1. Obtener datos clave de la venta
      const ventaRes = await client.query(
        "SELECT estado, canal, pago_contra_entrega FROM venta WHERE id_venta = $1 FOR UPDATE",
        [id_venta],
      );
      if (ventaRes.rows.length === 0) throw new Error("Venta no encontrada");

      const venta = ventaRes.rows[0];
      if (venta.estado !== "pendiente_autorizacion")
        throw new Error("La venta no está pendiente de autorización");

      // 2. Determinar el nuevo estado
      let nuevoEstado = "rechazada";
      if (aprobado) {
        nuevoEstado =
          venta.canal === "domicilio" && venta.pago_contra_entrega
            ? "pendiente_cobro_contra_entrega"
            : "pendiente_pago";
      }

      // 3. Actualizar
      await client.query(
        `
        UPDATE venta 
        SET estado = $1, id_supervisor_autoriza = $2, updated_at = NOW() 
        WHERE id_venta = $3
      `,
        [nuevoEstado, id_supervisor, id_venta],
      );

      // 4. Registro de Auditoría
      const accion = aprobado ? "aprobacion_descuento" : "rechazo_descuento";
      const datosNuevos = JSON.stringify({
        estado: nuevoEstado,
        id_supervisor_autoriza: id_supervisor,
      });
      await client.query(
        `
        INSERT INTO log_auditoria (id_usuario, tabla_afectada, accion, id_registro, datos_nuevos)
        VALUES ($1, 'venta', $2, $3, $4)
      `,
        [id_usuario_log, accion, id_venta, datosNuevos],
      );

      // 5. Si se rechaza, regresar el stock al inventario
      if (!aprobado) {
        await client.query(
          `
          UPDATE inventario_sucursal i
          SET cantidad_actual = i.cantidad_actual + dv.cantidad
          FROM detalle_venta dv
          WHERE i.id_producto = dv.id_producto AND dv.id_venta = $1
            AND i.id_sucursal = (SELECT id_sucursal FROM venta WHERE id_venta = $1)
        `,
          [id_venta],
        );
      }

      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}
