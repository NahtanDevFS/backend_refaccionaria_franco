// services/ArqueoService.ts
import { ArqueoRepository } from "../repositories/ArqueoRepository";
import { GenerarArqueoDTO } from "../dtos/ArqueoDTO";
import { EstadoArqueo } from "../types/arqueo.types";

export class ArqueoService {
  constructor(private readonly arqueoRepository: ArqueoRepository) {}

  async procesarCierreDeCaja(dto: GenerarArqueoDTO) {
    // 1. Consultar cuánto dinero debería haber en la caja según el sistema
    const efectivoSistema =
      await this.arqueoRepository.obtenerEfectivoDelDiaPorCajero(dto.id_cajero);

    // 2. Calcular la diferencia (Efectivo Físico - Efectivo Sistema)
    // Si la diferencia es negativa, falta dinero. Si es positiva, sobra dinero.
    const diferencia = dto.efectivo_contado - efectivoSistema;

    // 3. Determinar el estado
    let estado = EstadoArqueo.CUADRADO;
    if (diferencia !== 0) {
      estado = EstadoArqueo.CON_DIFERENCIA;
    }

    // 4. Guardar la evidencia de la auditoría en la base de datos
    const arqueoRegistrado = await this.arqueoRepository.guardarArqueo(
      dto,
      efectivoSistema,
      diferencia,
      estado,
    );

    return {
      exito: true,
      mensaje:
        estado === EstadoArqueo.CUADRADO
          ? "Arqueo cuadrado perfectamente."
          : `Arqueo con diferencia detectada de Q${diferencia.toFixed(2)}.`,
      data: arqueoRegistrado,
    };
  }
}
