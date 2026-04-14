// services/InventarioService.ts
import { Pool } from "pg";

export class InventarioService {
  constructor(private readonly pool: Pool) {}

  async consultarStockCentralizado(criterio: string) {
    if (!criterio || criterio.trim().length < 3) {
      throw new Error(
        "El criterio de búsqueda debe tener al menos 3 caracteres.",
      );
    }

    const query = `
      SELECT 
        p.id_producto, p.sku, p.nombre AS producto, p.precio_venta,
        s.nombre AS sucursal, i.cantidad_actual AS stock_disponible, i.punto_reorden
      FROM producto p
      INNER JOIN inventario_sucursal i ON p.id_producto = i.id_producto
      INNER JOIN sucursal s ON i.id_sucursal = s.id_sucursal
      WHERE p.sku ILIKE $1 OR p.nombre ILIKE $1
      ORDER BY p.nombre, s.id_sucursal;
    `;

    const result = await this.pool.query(query, [`%${criterio.trim()}%`]);
    const resultados = result.rows.map((row) => ({
      ...row,
      precio_venta: Number(row.precio_venta),
      stock_disponible: Number(row.stock_disponible),
      punto_reorden: Number(row.punto_reorden),
    }));

    if (resultados.length === 0) {
      return { mensaje: "No se encontraron productos", data: [] };
    }

    return { mensaje: "Stock consultado exitosamente", data: resultados };
  }

  // Agrega estos dos métodos nuevos para alimentar los selects del frontend
  async obtenerCategorias() {
    const result = await this.pool.query(
      `SELECT id_categoria, nombre FROM categoria_producto WHERE activo = true ORDER BY nombre ASC`,
    );
    return result.rows;
  }

  async obtenerMarcasRepuesto() {
    const result = await this.pool.query(
      `SELECT id_marca, nombre FROM marca WHERE activo = true ORDER BY nombre ASC`,
    );
    return result.rows;
  }

  async buscarProductoMultiSucursal(
    idSucursalLocal: number,
    termino?: string,
    idCategoria?: number,
    idMarca?: number,
  ) {
    let query = `
      SELECT 
        p.id_producto, p.sku, p.nombre, p.precio_venta, m.nombre as marca_repuesto,
        COALESCE(MAX(CASE WHEN i.id_sucursal = $1 THEN i.cantidad_actual END), 0) as stock_local,
        COALESCE(
          json_agg(
            json_build_object('sucursal', s.nombre, 'cantidad', i.cantidad_actual)
          ) FILTER (WHERE i.id_sucursal != $1 AND i.cantidad_actual > 0), '[]'
        ) as stock_otras_sucursales
      FROM producto p
      LEFT JOIN inventario_sucursal i ON p.id_producto = i.id_producto
      LEFT JOIN sucursal s ON i.id_sucursal = s.id_sucursal
      LEFT JOIN marca m ON p.id_marca = m.id_marca
      WHERE p.activo = true
    `;

    const params: any[] = [idSucursalLocal];
    let paramIndex = 2;

    // Filtro por Texto o SKU
    if (termino && termino.trim().length > 0) {
      query += ` AND (p.nombre ILIKE $${paramIndex} OR p.sku ILIKE $${paramIndex})`;
      params.push(`%${termino.trim()}%`);
      paramIndex++;
    }

    // Filtro por Categoría
    if (idCategoria) {
      query += ` AND p.id_categoria = $${paramIndex}`;
      params.push(idCategoria);
      paramIndex++;
    }

    // Filtro por Marca de Repuesto
    if (idMarca) {
      query += ` AND p.id_marca = $${paramIndex}`;
      params.push(idMarca);
      paramIndex++;
    }

    // Agrupamos y limitamos a 50 para no saturar la vista si buscan una categoría muy grande
    query += ` GROUP BY p.id_producto, m.nombre ORDER BY p.nombre ASC LIMIT 50;`;

    const result = await this.pool.query(query, params);
    return result.rows.map((row) => ({
      ...row,
      precio_venta: Number(row.precio_venta),
      stock_local: Number(row.stock_local),
    }));
  }

  async obtenerMarcasVehiculo() {
    const query = `SELECT * FROM marca_vehiculo WHERE activo = true ORDER BY nombre ASC;`;
    const result = await this.pool.query(query);
    return result.rows;
  }

  async obtenerModelosPorMarca(id_marca: number) {
    const query = `SELECT * FROM modelo_vehiculo WHERE id_marca_vehiculo = $1 AND activo = true ORDER BY nombre ASC;`;
    const result = await this.pool.query(query, [id_marca]);
    return result.rows;
  }

  async buscarProductosPorVehiculo(
    id_sucursal: number,
    id_modelo: number,
    anio?: number,
    id_categoria?: number,
    id_marca?: number,
  ) {
    let query = `
      SELECT 
          p.id_producto, p.sku, p.nombre, p.precio_venta, m.nombre as marca_repuesto,
          COALESCE(MAX(CASE WHEN i.id_sucursal = $1 THEN i.cantidad_actual END), 0) as stock_local,
          COALESCE(
            json_agg(
              json_build_object('sucursal', s.nombre, 'cantidad', i.cantidad_actual)
            ) FILTER (WHERE i.id_sucursal != $1 AND i.cantidad_actual > 0), '[]'
          ) as stock_otras_sucursales
      FROM producto p
      LEFT JOIN inventario_sucursal i ON p.id_producto = i.id_producto
      LEFT JOIN sucursal s ON i.id_sucursal = s.id_sucursal
      LEFT JOIN marca m ON p.id_marca = m.id_marca
      WHERE p.activo = true
        AND EXISTS (
            SELECT 1 FROM compatibilidad_producto cp 
            WHERE cp.id_producto = p.id_producto 
            AND (cp.es_universal = true OR cp.id_modelo = $2)
            ${anio ? `AND (cp.es_universal = true OR ($3 >= cp.anio_desde AND $3 <= cp.anio_hasta))` : ""}
        )
    `;

    const params: any[] = [id_sucursal, id_modelo];
    let paramIndex = anio ? 4 : 3;

    if (anio) params.push(anio);

    if (id_categoria) {
      query += ` AND p.id_categoria = $${paramIndex}`;
      params.push(id_categoria);
      paramIndex++;
    }

    if (id_marca) {
      query += ` AND p.id_marca = $${paramIndex}`;
      params.push(id_marca);
      paramIndex++;
    }

    query += ` GROUP BY p.id_producto, m.nombre ORDER BY p.nombre ASC LIMIT 50;`;

    const result = await this.pool.query(query, params);
    return result.rows.map((r) => ({
      ...r,
      precio_venta: Number(r.precio_venta),
      stock_local: Number(r.stock_local),
    }));
  }

  async obtenerCompatibilidadesProducto(id_producto: number) {
    const query = `
      SELECT 
          cp.es_universal, cp.anio_desde, cp.anio_hasta, cp.notas,
          mv.nombre as marca_vehiculo, mod.nombre as modelo_vehiculo
      FROM compatibilidad_producto cp
      LEFT JOIN modelo_vehiculo mod ON cp.id_modelo = mod.id_modelo
      LEFT JOIN marca_vehiculo mv ON mod.id_marca_vehiculo = mv.id_marca_vehiculo
      WHERE cp.id_producto = $1
      ORDER BY mv.nombre ASC, mod.nombre ASC;
    `;
    const result = await this.pool.query(query, [id_producto]);
    return result.rows;
  }
}
