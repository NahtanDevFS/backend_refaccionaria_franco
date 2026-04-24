// services/ClienteService.ts
import { Pool } from "pg";
import { CrearClienteDTO } from "../dtos/ClienteDTO";

export class ClienteService {
  constructor(private readonly pool: Pool) {}

  private async resolverIdTipoCliente(
    client: any,
    nombreTipo: string,
  ): Promise<number> {
    const res = await client.query(
      `SELECT id_tipo_cliente FROM tipo_cliente
       WHERE LOWER(nombre) = LOWER($1) AND activo = true
       LIMIT 1`,
      [nombreTipo ?? "particular"],
    );
    if (res.rows.length > 0) return res.rows[0].id_tipo_cliente;

    //Fallback a 'particular' si el valor no está en el catálogo
    const fallback = await client.query(
      `SELECT id_tipo_cliente FROM tipo_cliente WHERE nombre = 'particular' LIMIT 1`,
    );
    return fallback.rows[0].id_tipo_cliente;
  }

  async registrarCliente(dto: CrearClienteDTO) {
    if (dto.nit && dto.nit.toUpperCase() !== "CF") {
      const resultBusqueda = await this.pool.query(
        `SELECT nit FROM cliente WHERE nit = $1`,
        [dto.nit],
      );
      if (resultBusqueda.rows.length > 0) {
        throw new Error(
          `El cliente con NIT ${dto.nit} ya se encuentra registrado.`,
        );
      }
    }

    if (dto.telefono && dto.telefono.trim() !== "") {
      const soloDigitos = dto.telefono.replace(/\D/g, "");
      if (soloDigitos.length !== 8) {
        throw new Error("El teléfono debe tener exactamente 8 dígitos.");
      }
      const telRes = await this.pool.query(
        `SELECT id_cliente FROM cliente WHERE telefono = $1`,
        [soloDigitos],
      );
      if (telRes.rows.length > 0) {
        throw new Error(
          `Ya existe un cliente registrado con el teléfono ${soloDigitos}.`,
        );
      }
      dto.telefono = soloDigitos;
    }

    //Resolver id_tipo_cliente desde el nombre recibido del frontend
    const id_tipo_cliente = await this.resolverIdTipoCliente(
      this.pool,
      dto.tipo_cliente,
    );

    const query = `
      INSERT INTO cliente (
        nombre_razon_social, nit, id_tipo_cliente, telefono,
        email, direccion, id_municipio, notas_internas, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
      RETURNING
        id_cliente, nombre_razon_social, nit, telefono,
        email, direccion, id_municipio, notas_internas,
        activo, created_at, updated_at,
        (SELECT nombre FROM tipo_cliente WHERE id_tipo_cliente = $3) AS tipo_cliente;
    `;

    const values = [
      dto.nombre_razon_social,
      dto.nit || "CF",
      id_tipo_cliente,
      dto.telefono || null,
      dto.email || null,
      dto.direccion || null,
      dto.id_municipio || null,
      dto.notas_internas || null,
    ];

    try {
      const result = await this.pool.query(query, values);
      return result.rows[0];
    } catch (error) {
      throw new Error(`Error al crear cliente: ${(error as Error).message}`);
    }
  }

  async buscarClientes(criterio: string) {
    if (!criterio || criterio.trim().length < 2) {
      throw new Error(
        "El criterio de búsqueda debe tener al menos 2 caracteres.",
      );
    }

    const query = `
      SELECT
        c.id_cliente, c.nombre_razon_social, c.nit,
        c.telefono, c.email, c.direccion, c.id_municipio,
        c.notas_internas, c.activo, c.created_at, c.updated_at,
        tc.nombre AS tipo_cliente
      FROM cliente c
      JOIN tipo_cliente tc ON c.id_tipo_cliente = tc.id_tipo_cliente
      WHERE c.nombre_razon_social ILIKE $1
         OR c.nit   ILIKE $1
         OR c.telefono ILIKE $1
      ORDER BY c.nombre_razon_social ASC
      LIMIT 20;
    `;
    const result = await this.pool.query(query, [`%${criterio.trim()}%`]);
    return result.rows;
  }

  async buscarPorNit(nit: string) {
    const query = `
      SELECT
        c.id_cliente, c.nombre_razon_social, c.nit,
        c.telefono, c.email, c.direccion, c.id_municipio,
        c.notas_internas, c.activo, c.created_at, c.updated_at,
        tc.nombre AS tipo_cliente
      FROM cliente c
      JOIN tipo_cliente tc ON c.id_tipo_cliente = tc.id_tipo_cliente
      WHERE c.nit = $1
    `;
    const result = await this.pool.query(query, [nit]);
    return result.rows.length ? result.rows[0] : null;
  }
}
