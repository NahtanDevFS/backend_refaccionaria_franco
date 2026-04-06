// repositories/ClienteRepository.ts
import { Pool } from "pg";
import { CrearClienteDTO } from "../dtos/ClienteDTO";

export class ClienteRepository {
  constructor(private readonly pool: Pool) {}

  async crearCliente(data: CrearClienteDTO): Promise<any> {
    const query = `
      INSERT INTO cliente (
        nombre_razon_social, nit, tipo_cliente, telefono, 
        email, direccion, id_municipio, notas_internas, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
      RETURNING *;
    `;

    const values = [
      data.nombre_razon_social,
      data.nit || "CF", // Fallback seguro a CF
      data.tipo_cliente,
      data.telefono || null,
      data.email || null,
      data.direccion || null,
      data.id_municipio || null,
      data.notas_internas || null,
    ];

    try {
      const result = await this.pool.query(query, values);
      return result.rows[0];
    } catch (error) {
      throw new Error(
        `Error de base de datos al crear cliente: ${(error as Error).message}`,
      );
    }
  }

  async buscarCliente(criterio: string): Promise<any[]> {
    // La regla del CU-17 dicta buscar por nombre, nit o teléfono
    const query = `
      SELECT * FROM cliente 
      WHERE nombre_razon_social ILIKE $1 
         OR nit ILIKE $1 
         OR telefono ILIKE $1
      ORDER BY nombre_razon_social ASC
      LIMIT 20;
    `;

    const values = [`%${criterio}%`];

    try {
      const result = await this.pool.query(query, values);
      return result.rows;
    } catch (error) {
      throw new Error(`Error al buscar clientes: ${(error as Error).message}`);
    }
  }

  async buscarPorNit(nit: string): Promise<any | null> {
    const query = `SELECT * FROM cliente WHERE nit = $1`;
    const result = await this.pool.query(query, [nit]);
    return result.rows.length ? result.rows[0] : null;
  }
}
