// services/ClienteService.ts
import { Pool } from "pg";
import { CrearClienteDTO } from "../dtos/ClienteDTO";

export class ClienteService {
  constructor(private readonly pool: Pool) {}

  async registrarCliente(dto: CrearClienteDTO) {
    if (dto.nit && dto.nit.toUpperCase() !== "CF") {
      const queryBusqueda = `SELECT nit FROM cliente WHERE nit = $1`;
      const resultBusqueda = await this.pool.query(queryBusqueda, [dto.nit]);

      if (resultBusqueda.rows.length > 0) {
        throw new Error(
          `El cliente con NIT ${dto.nit} ya se encuentra registrado.`,
        );
      }
    }

    if (dto.telefono && dto.telefono.trim() !== "") {
      // Solo dígitos, exactamente 8
      const soloDigitos = dto.telefono.replace(/\D/g, "");
      if (soloDigitos.length !== 8) {
        throw new Error("El teléfono debe tener exactamente 8 dígitos.");
      }

      //no puede existir otro cliente con el mismo teléfono
      const telRes = await this.pool.query(
        `SELECT id_cliente FROM cliente WHERE telefono = $1`,
        [soloDigitos],
      );
      if (telRes.rows.length > 0) {
        throw new Error(
          `Ya existe un cliente registrado con el teléfono ${soloDigitos}.`,
        );
      }

      // Guardamos siempre el teléfono como 8 dígitos limpios
      dto.telefono = soloDigitos;
    }

    const query = `
      INSERT INTO cliente (
        nombre_razon_social, nit, tipo_cliente, telefono,
        email, direccion, id_municipio, notas_internas, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
      RETURNING *;
    `;

    const values = [
      dto.nombre_razon_social,
      dto.nit || "CF",
      dto.tipo_cliente,
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
      SELECT * FROM cliente 
      WHERE nombre_razon_social ILIKE $1 OR nit ILIKE $1 OR telefono ILIKE $1
      ORDER BY nombre_razon_social ASC
      LIMIT 20;
    `;
    const result = await this.pool.query(query, [`%${criterio.trim()}%`]);
    return result.rows;
  }

  async buscarPorNit(nit: string) {
    const query = `SELECT * FROM cliente WHERE nit = $1`;
    const result = await this.pool.query(query, [nit]);
    return result.rows.length ? result.rows[0] : null;
  }
}
