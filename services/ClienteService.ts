// services/ClienteService.ts
import { ClienteRepository } from "../repositories/ClienteRepository";
import { CrearClienteDTO } from "../dtos/ClienteDTO";

export class ClienteService {
  constructor(private readonly clienteRepository: ClienteRepository) {}

  async registrarCliente(dto: CrearClienteDTO) {
    // Regla de Negocio (CU-16): Evitar duplicados por NIT
    // Omitimos la validación si el NIT es 'CF' porque pueden haber infinitos Consumidores Finales.
    if (dto.nit && dto.nit.toUpperCase() !== "CF") {
      const duplicados = await this.clienteRepository.buscarCliente(dto.nit);

      // Verificamos coincidencia exacta de NIT
      const nitExiste = duplicados.some((c) => c.nit === dto.nit);
      if (nitExiste) {
        throw new Error(
          `El cliente con NIT ${dto.nit} ya se encuentra registrado.`,
        );
      }
    }

    return await this.clienteRepository.crearCliente(dto);
  }

  async buscarClientes(criterio: string) {
    if (!criterio || criterio.trim().length < 2) {
      throw new Error(
        "El criterio de búsqueda debe tener al menos 2 caracteres.",
      );
    }

    const clientes = await this.clienteRepository.buscarCliente(
      criterio.trim(),
    );
    return clientes;
  }
}
