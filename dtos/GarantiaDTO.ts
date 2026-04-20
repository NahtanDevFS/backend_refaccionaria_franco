// dtos/GarantiaDTO.ts

export interface CrearGarantiaDTO {
  id_detalle_venta: number;
  cantidad: number;
  motivo_reclamo: string;
}

export interface ResolverGarantiaDTO {
  id_garantia: number;
  id_supervisor: number;
  aprobado: boolean;
  resolucion: string;
  // Solo requeridos cuando aprobado = true
  condicion_recibido?: string;
  notas_inspeccion?: string;
}
