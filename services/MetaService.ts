// services/MetaService.ts
import { MetaRepository } from "../repositories/MetaRepository";
import { AsignarMetaDTO } from "../dtos/MetaDTO";

export class MetaService {
  constructor(private readonly metaRepository: MetaRepository) {}

  async asignarMetaMensual(dto: AsignarMetaDTO) {
    // Regla de Negocio: Un vendedor solo puede tener una meta por mes
    const metaExistente = await this.metaRepository.obtenerMetaVendedor(
      dto.id_empleado,
      dto.anio,
      dto.mes,
    );
    if (metaExistente) {
      throw new Error(
        `El empleado ID ${dto.id_empleado} ya tiene una meta asignada para el ${dto.mes}/${dto.anio}.`,
      );
    }

    return await this.metaRepository.asignarMeta(dto);
  }

  async calcularRendimientoYComision(
    id_empleado: number,
    anio: number,
    mes: number,
  ) {
    // 1. Buscamos las condiciones del contrato (la meta asignada)
    const meta = await this.metaRepository.obtenerMetaVendedor(
      id_empleado,
      anio,
      mes,
    );
    if (!meta) {
      throw new Error(
        `No se encontró una meta asignada para el empleado ID ${id_empleado} en el ${mes}/${anio}.`,
      );
    }

    // 2. Buscamos el rendimiento real (cuánto vendió efectivamente)
    const totalVendido = await this.metaRepository.obtenerTotalVendido(
      id_empleado,
      anio,
      mes,
    );

    // 3. Matemáticas de la comisión
    const montoMeta = Number(meta.monto_meta);
    const pctBase = Number(meta.comision_base_pct) / 100;
    const pctExcedente = Number(meta.comision_excedente_pct) / 100;

    let comisionCalculada = 0;
    let llegoALaMeta = false;

    if (totalVendido < montoMeta) {
      // No llegó a la meta. Se le paga el porcentaje base sobre lo que logró vender.
      comisionCalculada = totalVendido * pctBase;
    } else {
      // Llegó y/o superó la meta.
      // Se paga % base sobre el monto de la meta + % excedente sobre lo que sobrepasó.
      llegoALaMeta = true;
      const excedente = totalVendido - montoMeta;
      const pagoBase = montoMeta * pctBase;
      const pagoExcedente = excedente * pctExcedente;
      comisionCalculada = pagoBase + pagoExcedente;
    }

    // Retornamos un reporte detallado para el gerente
    return {
      id_empleado,
      periodo: `${mes}/${anio}`,
      meta_asignada: montoMeta,
      total_vendido: totalVendido,
      llego_a_meta: llegoALaMeta,
      porcentajes_aplicados: {
        base: `${meta.comision_base_pct}%`,
        excedente: `${meta.comision_excedente_pct}%`,
      },
      comision_total_ganada: Number(comisionCalculada.toFixed(2)),
    };
  }

  async obtenerRendimientoMensual() {
    return await this.metaRepository.obtenerRendimientoMensual();
  }
}
