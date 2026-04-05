// dtos/GarantiaDTO.ts
import { EstadoGarantia } from "../types/garantia.types";

export interface SolicitarGarantiaDTO {
  id_detalle_venta: number;
  motivo_reclamo: string;
}

export interface ResolverGarantiaDTO {
  //id_supervisor_aprueba: number;
  estado: EstadoGarantia.APROBADA | EstadoGarantia.RECHAZADA;
  resolucion: string;
}
