// services/InventarioService.ts
import { Pool } from "pg";

export class InventarioService {
  constructor(private readonly pool: Pool) {}

  //  Búsqueda centralizada de stock (vista general admin/bodega)
  async consultarStockCentralizado(criterio: string) {
    if (!criterio || criterio.trim().length < 3)
      throw new Error(
        "El criterio de búsqueda debe tener al menos 3 caracteres.",
      );

    const result = await this.pool.query(
      `SELECT
         p.id_producto, p.sku, p.nombre AS producto, p.precio_venta,
         s.nombre AS sucursal,
         COALESCE(SUM(ld.cantidad_actual), 0) AS stock_disponible,
         rps.punto_reorden
       FROM producto p
       INNER JOIN reorden_producto_sucursal rps ON p.id_producto = rps.id_producto
       INNER JOIN sucursal                   s  ON rps.id_sucursal = s.id_sucursal
       LEFT  JOIN lote_detalle               ld
         ON  ld.id_producto = rps.id_producto
         AND ld.id_sucursal = rps.id_sucursal
         AND ld.agotado     = FALSE
         AND ld.activo      = TRUE
       WHERE (p.sku ILIKE $1 OR p.nombre ILIKE $1)
         AND rps.activo = TRUE
       GROUP BY p.id_producto, p.sku, p.nombre, p.precio_venta, s.nombre, rps.punto_reorden
       ORDER BY p.nombre, s.id_sucursal`,
      [`%${criterio.trim()}%`],
    );

    const resultados = result.rows.map((row) => ({
      ...row,
      precio_venta: Number(row.precio_venta),
      stock_disponible: Number(row.stock_disponible),
      punto_reorden: Number(row.punto_reorden),
    }));

    if (!resultados.length)
      return { mensaje: "No se encontraron productos", data: [] };

    return { mensaje: "Stock consultado exitosamente", data: resultados };
  }

  // Catálogos
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

  async obtenerMarcasVehiculo() {
    const result = await this.pool.query(
      `SELECT * FROM marca_vehiculo WHERE activo = true ORDER BY nombre ASC`,
    );
    return result.rows;
  }

  async obtenerModelosPorMarca(id_marca: number) {
    const result = await this.pool.query(
      `SELECT * FROM modelo_vehiculo WHERE id_marca_vehiculo = $1 AND activo = true ORDER BY nombre ASC`,
      [id_marca],
    );
    return result.rows;
  }

  //Búsqueda multi-sucursal por nombre/SKU/categoría/marca
  async buscarProductoMultiSucursal(
    idSucursalLocal: number,
    termino?: string,
    idCategoria?: number,
    idMarca?: number,
  ) {
    let query = `
      SELECT
        p.id_producto, p.sku, p.nombre, p.precio_venta,
        m.nombre AS marca_repuesto,
        COALESCE((
          SELECT SUM(ld.cantidad_actual)
          FROM lote_detalle ld
          WHERE ld.id_producto = p.id_producto
            AND ld.id_sucursal = $1
            AND ld.agotado = FALSE AND ld.activo = TRUE
        ), 0) AS stock_local,
        COALESCE((
          SELECT json_agg(json_build_object('sucursal', s2.nombre, 'cantidad', suc_stock.cantidad))
          FROM (
            SELECT ld2.id_sucursal, SUM(ld2.cantidad_actual) AS cantidad
            FROM lote_detalle ld2
            WHERE ld2.id_producto = p.id_producto
              AND ld2.id_sucursal != $1
              AND ld2.agotado = FALSE AND ld2.activo = TRUE
            GROUP BY ld2.id_sucursal HAVING SUM(ld2.cantidad_actual) > 0
          ) suc_stock
          JOIN sucursal s2 ON suc_stock.id_sucursal = s2.id_sucursal
        ), '[]') AS stock_otras_sucursales
      FROM producto p
      LEFT JOIN marca m ON p.id_marca = m.id_marca
      WHERE p.activo = true
        AND EXISTS (
          SELECT 1 FROM reorden_producto_sucursal rps
          WHERE rps.id_producto = p.id_producto
            AND rps.id_sucursal = $1
            AND rps.activo      = TRUE
        )
    `;

    const params: any[] = [idSucursalLocal];
    let paramIndex = 2;

    if (termino && termino.trim().length > 0) {
      query += ` AND (p.nombre ILIKE $${paramIndex} OR p.sku ILIKE $${paramIndex})`;
      params.push(`%${termino.trim()}%`);
      paramIndex++;
    }
    if (idCategoria) {
      query += ` AND p.id_categoria = $${paramIndex}`;
      params.push(idCategoria);
      paramIndex++;
    }
    if (idMarca) {
      query += ` AND p.id_marca = $${paramIndex}`;
      params.push(idMarca);
      paramIndex++;
    }

    query += ` ORDER BY p.nombre ASC LIMIT 50`;

    const result = await this.pool.query(query, params);
    const normales = result.rows.map((row) => ({
      ...row,
      precio_venta: Number(row.precio_venta),
      stock_local: Number(row.stock_local),
      is_reacondicionado: false,
    }));

    if (!normales.length) return normales;

    // Reacondicionados disponibles para los mismos productos
    const ids = normales.map((n) => n.id_producto);
    const resReac = await this.pool.query(
      `SELECT
         lr.id_lote    AS id_producto_reacondicionado,
         lr.id_producto,
         lr.cantidad   AS stock_local,
         lr.precio_venta_reac AS precio_venta,
         p.sku, p.nombre,
         'Pieza de Segunda Mano (Garantía)' AS marca_repuesto
       FROM lote_reacondicionado lr
       JOIN producto p ON lr.id_producto = p.id_producto
       WHERE lr.id_sucursal = $1
         AND lr.activo      = true
         AND lr.cantidad    > 0
         AND lr.id_producto = ANY($2::int[])`,
      [idSucursalLocal, ids],
    );

    const reacondicionados = resReac.rows.map((r) => ({
      ...r,
      precio_venta: Number(r.precio_venta),
      stock_local: Number(r.stock_local),
      is_reacondicionado: true,
      stock_otras_sucursales: [],
    }));

    return [...normales, ...reacondicionados];
  }

  //Búsqueda por vehículo
  async buscarProductosPorVehiculo(
    id_sucursal: number,
    id_modelo: number,
    anio?: number,
    id_categoria?: number,
    id_marca?: number,
  ) {
    let query = `
      SELECT
        p.id_producto, p.sku, p.nombre, p.precio_venta,
        m.nombre AS marca_repuesto,
        COALESCE((
          SELECT SUM(ld.cantidad_actual)
          FROM lote_detalle ld
          WHERE ld.id_producto = p.id_producto
            AND ld.id_sucursal = $1
            AND ld.agotado = FALSE AND ld.activo = TRUE
        ), 0) AS stock_local,
        COALESCE((
          SELECT json_agg(json_build_object('sucursal', s2.nombre, 'cantidad', suc_stock.cantidad))
          FROM (
            SELECT ld2.id_sucursal, SUM(ld2.cantidad_actual) AS cantidad
            FROM lote_detalle ld2
            WHERE ld2.id_producto = p.id_producto
              AND ld2.id_sucursal != $1
              AND ld2.agotado = FALSE AND ld2.activo = TRUE
            GROUP BY ld2.id_sucursal HAVING SUM(ld2.cantidad_actual) > 0
          ) suc_stock
          JOIN sucursal s2 ON suc_stock.id_sucursal = s2.id_sucursal
        ), '[]') AS stock_otras_sucursales
      FROM producto p
      LEFT JOIN marca m ON p.id_marca = m.id_marca
      WHERE p.activo = true
        AND EXISTS (
          SELECT 1 FROM reorden_producto_sucursal rps
          WHERE rps.id_producto = p.id_producto
            AND rps.id_sucursal = $1
            AND rps.activo      = TRUE
        )
        AND EXISTS (
          SELECT 1 FROM compatibilidad_producto cp
          WHERE cp.id_producto = p.id_producto
            AND (
              cp.es_universal = true
              OR cp.id_modelo = $2
            )
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

    query += ` ORDER BY p.nombre ASC LIMIT 50`;

    const result = await this.pool.query(query, params);
    const normales = result.rows.map((r) => ({
      ...r,
      precio_venta: Number(r.precio_venta),
      stock_local: Number(r.stock_local),
      is_reacondicionado: false,
    }));

    if (!normales.length) return normales;

    const ids = normales.map((n) => n.id_producto);
    const resReac = await this.pool.query(
      `SELECT
         lr.id_lote          AS id_producto_reacondicionado,
         lr.id_producto,
         lr.cantidad         AS stock_local,
         lr.precio_venta_reac AS precio_venta,
         p.sku, p.nombre,
         'Pieza de Segunda Mano (Garantía)' AS marca_repuesto
       FROM lote_reacondicionado lr
       JOIN producto p ON lr.id_producto = p.id_producto
       WHERE lr.id_sucursal = $1
         AND lr.cantidad    > 0
         AND lr.id_producto = ANY($2::int[])`,
      [id_sucursal, ids],
    );

    const reacondicionados = resReac.rows.map((r) => ({
      ...r,
      precio_venta: Number(r.precio_venta),
      stock_local: Number(r.stock_local),
      is_reacondicionado: true,
      stock_otras_sucursales: [],
    }));

    return [...normales, ...reacondicionados];
  }

  //Compatibilidades de un producto
  async obtenerCompatibilidadesProducto(id_producto: number) {
    const result = await this.pool.query(
      `SELECT
         cp.es_universal, cp.anio_desde, cp.anio_hasta, cp.notas,
         mv.nombre AS marca_vehiculo, mod.nombre AS modelo_vehiculo
       FROM compatibilidad_producto cp
       LEFT JOIN modelo_vehiculo mod ON cp.id_modelo        = mod.id_modelo
       LEFT JOIN marca_vehiculo  mv  ON mod.id_marca_vehiculo = mv.id_marca_vehiculo
       WHERE cp.id_producto = $1
       ORDER BY mv.nombre ASC, mod.nombre ASC`,
      [id_producto],
    );
    return result.rows;
  }
}
