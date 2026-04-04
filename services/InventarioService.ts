// services/InventarioService.ts
import { InventarioRepository } from "../repositories/InventarioRepository";

export class InventarioService {
  constructor(private readonly inventarioRepository: InventarioRepository) {}

  async consultarStockCentralizado(criterio: string) {
    if (!criterio || criterio.trim().length < 3) {
      throw new Error(
        "El criterio de búsqueda debe tener al menos 3 caracteres para no saturar la base de datos.",
      );
    }

    const resultados = await this.inventarioRepository.buscarStockGlobal(
      criterio.trim(),
    );

    if (resultados.length === 0) {
      return {
        mensaje: "No se encontraron productos con los criterios ingresados",
        data: [],
      };
    }

    return { mensaje: "Stock consultado exitosamente", data: resultados };
  }
}
